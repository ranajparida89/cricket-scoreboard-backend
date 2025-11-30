// routes/boardAnalyticsRoutes.js
// 10-AUG-2025 — CrickEdge Board Analytics (schema-aligned, membership-aware)
// - Outcome points: ODI/T20 win/draw/loss = 10/5/2; TEST = 18/9/4
// - Championship bonus via Hall of Fame: ODI/T20 +25, TEST +50
// - Uses board_teams.joined_at / left_at so historical points stay with old board

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ---------- Helpers ----------
const isInt = (v) => /^\d+$/.test(String(v));
const isISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const toIntArray = (csv = "") =>
  csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (isInt(s) ? Number(s) : NaN))
    .filter((n) => Number.isInteger(n));

function pointsForFormat(fmt, outcome) {
  const f = String(fmt || "").toUpperCase();
  if (f === "ODI" || f === "T20") {
    return outcome === "win" ? 10 : outcome === "draw" ? 5 : outcome === "loss" ? 2 : 0;
  }
  if (f === "TEST") {
    return outcome === "win" ? 18 : outcome === "draw" ? 9 : outcome === "loss" ? 4 : 0;
  }
  return 0;
}

function championshipBonus(fmt) {
  const f = String(fmt || "").toUpperCase();
  if (f === "TEST") return 50;
  if (f === "ODI" || f === "T20") return 25;
  return 0;
}

// WHERE date helper
function addDateRange(whereCol, from, to) {
  const parts = [];
  const params = [];
  if (from) {
    parts.push(`${whereCol} >= $${params.length + 1}`);
    params.push(from);
  }
  if (to) {
    parts.push(`${whereCol} <= $${params.length + 1}`);
    params.push(to);
  }
  return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
}

function send500(res, req, tag, err, msg) {
  console.error(tag, err);
  if (req.query?.debug === "1") {
    return res
      .status(500)
      .json({ error: err?.message || String(err), stack: err?.stack });
  }
  return res.status(500).json({ error: msg });
}

// Winner parsing helpers
const reEsc = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordHit = (text, needle) => {
  if (!text || !needle) return false;
  const re = new RegExp(`\\b${reEsc(String(needle).trim())}\\b`, "i");
  return re.test(String(text));
};
const isDrawish = (w) =>
  /\b(draw|tie|tied|no\s*result|abandon|abandoned)/i.test(
    String(w || "").trim()
  );

// membership helper: team_name + date ➜ board_ids[]
const buildMembershipIndex = (rows) => {
  // rows: [{ board_id, team_name, joined_at, left_at }]
  const index = new Map(); // team_name -> [{board_id, joined_at, left_at}, ...]
  rows.forEach((r) => {
    const name = String(r.team_name || "").toLowerCase();
    if (!name) return;
    if (!index.has(name)) index.set(name, []);
    index.get(name).push({
      board_id: r.board_id,
      joined_at: r.joined_at ? String(r.joined_at).slice(0, 10) : null,
      left_at: r.left_at ? String(r.left_at).slice(0, 10) : null,
    });
  });
  return index;
};

const dateInside = (dateStr, joined, left) => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  if (joined) {
    const j = new Date(joined);
    if (!Number.isNaN(j.getTime()) && d < j) return false;
  }
  if (left) {
    const l = new Date(left);
    if (!Number.isNaN(l.getTime()) && d > l) return false;
  }
  return true;
};

const boardsForTeamAt = (membershipIndex, teamName, dateStr) => {
  const key = String(teamName || "").toLowerCase();
  const list = membershipIndex.get(key);
  if (!list || !list.length) return [];
  const out = [];
  for (const m of list) {
    if (dateInside(dateStr, m.joined_at, m.left_at)) {
      out.push(m.board_id);
    }
  }
  return out;
};

// ---------- GET /boards ----------

router.get("/boards", async (_req, res) => {
  try {
    const q = `
      SELECT b.id AS board_id, b.registration_id, b.board_name
      FROM public.board_registration b
      ORDER BY b.board_name;
    `;
    const { rows } = await pool.query(q);
    res.json({ boards: rows });
  } catch (err) {
    return send500(res, _req, "analytics/boards:", err, "Failed to fetch boards");
  }
});

// ---------- GET /summary ----------

router.get("/summary", async (req, res) => {
  try {
    const boardIds = toIntArray(req.query.board_ids || "");
    if (!boardIds.length) {
      return res
        .status(400)
        .json({ error: "board_ids (comma-separated integers) is required" });
    }

    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    if (from && !isISODate(from))
      return res.status(400).json({ error: "from must be YYYY-MM-DD" });
    if (to && !isISODate(to))
      return res.status(400).json({ error: "to must be YYYY-MM-DD" });
    if (from && to && new Date(from) > new Date(to)) {
      return res.status(400).json({ error: "from must be <= to" });
    }

    // Boards + names
    const boardsQ = `
      SELECT b.id AS board_id, b.board_name
      FROM public.board_registration b
      WHERE b.id = ANY($1::int[])
    `;
    const { rows: boardRows } = await pool.query(boardsQ, [boardIds]);
    if (!boardRows.length)
      return res.status(404).json({ error: "No matching boards found" });
    const nameMap = new Map(boardRows.map((r) => [r.board_id, r.board_name]));

    // Membership history per team
    const teamsQ = `
      SELECT
        bt.board_id,
        LOWER(TRIM(bt.team_name)) AS team_name,
        bt.joined_at::date AS joined_at,
        bt.left_at::date   AS left_at
      FROM public.board_teams bt
      WHERE bt.board_id = ANY($1::int[])
    `;
    const { rows: teamRows } = await pool.query(teamsQ, [boardIds]);
    const membershipIndex = buildMembershipIndex(teamRows);

    // ODI/T20 matches (date-safe)
    const mhRange = addDateRange(
      "COALESCE(mh.match_date, mh.match_time::date)",
      from,
      to
    );
    const mhQ = `
      SELECT
        mh.id,
        UPPER(mh.match_type) AS match_type,
        LOWER(TRIM(mh.team1)) AS team1,
        mh.runs1, mh.wickets1, mh.runs1_2, mh.wickets1_2,
        LOWER(TRIM(mh.team2)) AS team2,
        mh.runs2, mh.wickets2, mh.runs2_2, mh.wickets2_2,
        LOWER(TRIM(mh.winner)) AS winner,
        COALESCE(mh.match_date, mh.match_time::date) AS d
      FROM public.match_history mh
      WHERE mh.status = 'approved'
        AND (UPPER(mh.match_type) = 'ODI' OR UPPER(mh.match_type) = 'T20')
        ${mhRange.sql}
    `;
    const { rows: mhRows } = await pool.query(mhQ, mhRange.params);

    // Test matches (date-safe)
    const tRange = addDateRange(
      "COALESCE(tm.match_date, tm.created_at::date)",
      from,
      to
    );
    const tQ = `
      SELECT
        tm.id,
        LOWER(TRIM(tm.team1)) AS team1,
        tm.runs1, tm.runs1_2,
        LOWER(TRIM(tm.team2)) AS team2,
        tm.runs2, tm.runs2_2,
        LOWER(TRIM(tm.winner)) AS winner,
        COALESCE(tm.match_date, tm.created_at::date) AS d
      FROM public.test_match_results tm
      WHERE tm.status = 'approved'
        ${tRange.sql}
    `;
    const { rows: testRows } = await pool.query(tQ, tRange.params);

    // Aggregate container
    const byBoard = {};
    const ensureBoard = (id) => {
      if (!byBoard[id]) {
        byBoard[id] = {
          board_id: id,
          board_name: nameMap.get(id) || String(id),
          formats: {},
          totals: { matches: 0, wins: 0, draws: 0, losses: 0, points: 0 },
        };
      }
      return byBoard[id];
    };

    function bumpFormat(b, fmt, patch) {
      const F = String(fmt || "").toUpperCase();
      if (!b.formats[F]) {
        b.formats[F] = {
          matches: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          win_pct: 0,
          points: 0,
          avg_run_margin_acc: 0,
          avg_run_margin_n: 0,
          avg_run_margin: 0,
          highest_score: null,
          lowest_score: null,
          total_runs_all_teams: 0,
        };
      }
      Object.keys(patch).forEach((k) => {
        if (k === "avg_run_margin_add") {
          b.formats[F].avg_run_margin_acc += patch[k];
          b.formats[F].avg_run_margin_n += 1;
        } else if (k === "maybe_highest" && patch[k] != null) {
          b.formats[F].highest_score =
            b.formats[F].highest_score == null
              ? patch[k]
              : Math.max(b.formats[F].highest_score, patch[k]);
        } else if (k === "maybe_lowest" && patch[k] != null) {
          b.formats[F].lowest_score =
            b.formats[F].lowest_score == null
              ? patch[k]
              : Math.min(b.formats[F].lowest_score, patch[k]);
        } else if (k === "add_total_runs") {
          b.formats[F].total_runs_all_teams += patch[k];
        } else if (Object.prototype.hasOwnProperty.call(b.formats[F], k)) {
          b.formats[F][k] += patch[k];
        }
      });
    }

    function finalizeBoard(b) {
      Object.entries(b.formats).forEach(([, f]) => {
        f.win_pct = f.matches
          ? Number(((f.wins / f.matches) * 100).toFixed(2))
          : 0;
        f.avg_run_margin = f.avg_run_margin_n
          ? Number((f.avg_run_margin_acc / f.avg_run_margin_n).toFixed(2))
          : 0;

        b.totals.matches += f.matches;
        b.totals.wins += f.wins;
        b.totals.draws += f.draws;
        b.totals.losses += f.losses;
        b.totals.points += f.points;
      });
      b.totals.win_pct = b.totals.matches
        ? Number(((b.totals.wins / b.totals.matches) * 100).toFixed(2))
        : 0;
    }

    // ---------- ODI/T20 aggregation ----------
    mhRows.forEach((m) => {
      const fmt = m.match_type;
      const t1 = m.team1 || "";
      const t2 = m.team2 || "";
      const w = m.winner || "";
      const dateStr = m.d ? String(m.d).slice(0, 10) : null;

      const boardsT1 = boardsForTeamAt(membershipIndex, t1, dateStr);
      const boardsT2 = boardsForTeamAt(membershipIndex, t2, dateStr);
      const participantsSet = new Set([...boardsT1, ...boardsT2]);
      const participants = boardIds.filter((id) => participantsSet.has(id));
      if (!participants.length) return;

      const hi = Math.max(
        Number.isFinite(m.runs1) ? m.runs1 : -Infinity,
        Number.isFinite(m.runs2) ? m.runs2 : -Infinity
      );
      const lo = Math.min(
        Number.isFinite(m.runs1) ? m.runs1 : Infinity,
        Number.isFinite(m.runs2) ? m.runs2 : Infinity
      );
      const margin =
        Number.isFinite(m.runs1) && Number.isFinite(m.runs2)
          ? Math.abs(m.runs1 - m.runs2)
          : 0;
      const totalRuns = (Number(m.runs1) || 0) + (Number(m.runs2) || 0);

      const draw = isDrawish(w);
      const winnerIsT1 = wordHit(w, t1);
      const winnerIsT2 = wordHit(w, t2);

      participants.forEach((bid) => {
        const b = ensureBoard(bid);
        bumpFormat(b, fmt, {
          matches: 1,
          maybe_highest: Number.isFinite(hi) ? hi : null,
          maybe_lowest: Number.isFinite(lo) ? lo : null,
          add_total_runs: totalRuns,
          avg_run_margin_add: margin,
        });

        const ourBoardsT1 = boardsT1.includes(bid);
        const ourBoardsT2 = boardsT2.includes(bid);
        const weWon =
          (winnerIsT1 && ourBoardsT1) || (winnerIsT2 && ourBoardsT2);

        if (draw)
          bumpFormat(b, fmt, {
            draws: 1,
            points: pointsForFormat(fmt, "draw"),
          });
        else if (weWon)
          bumpFormat(b, fmt, {
            wins: 1,
            points: pointsForFormat(fmt, "win"),
          });
        else if (w)
          bumpFormat(b, fmt, {
            losses: 1,
            points: pointsForFormat(fmt, "loss"),
          });
      });
    });

    // ---------- TEST aggregation ----------
    testRows.forEach((m) => {
      const fmt = "TEST";
      const t1 = m.team1 || "";
      const t2 = m.team2 || "";
      const w = m.winner || "";
      const dateStr = m.d ? String(m.d).slice(0, 10) : null;

      const boardsT1 = boardsForTeamAt(membershipIndex, t1, dateStr);
      const boardsT2 = boardsForTeamAt(membershipIndex, t2, dateStr);
      const participantsSet = new Set([...boardsT1, ...boardsT2]);
      const participants = boardIds.filter((id) => participantsSet.has(id));
      if (!participants.length) return;

      const t1Total = (Number(m.runs1) || 0) + (Number(m.runs1_2) || 0);
      const t2Total = (Number(m.runs2) || 0) + (Number(m.runs2_2) || 0);
      const hi = Math.max(
        Number(m.runs1) || 0,
        Number(m.runs1_2) || 0,
        Number(m.runs2) || 0,
        Number(m.runs2_2) || 0
      );
      const safeVals = [m.runs1, m.runs1_2, m.runs2, m.runs2_2]
        .map(Number)
        .filter((v) => Number.isFinite(v) && v > 0);
      const lo = safeVals.length ? Math.min(...safeVals) : null;
      const margin = Math.abs(t1Total - t2Total);
      const totalRuns = t1Total + t2Total;

      const draw = isDrawish(w);
      const winnerIsT1 = wordHit(w, t1);
      const winnerIsT2 = wordHit(w, t2);

      participants.forEach((bid) => {
        const b = ensureBoard(bid);
        bumpFormat(b, fmt, {
          matches: 1,
          maybe_highest: Number.isFinite(hi) ? hi : null,
          maybe_lowest: lo != null && Number.isFinite(lo) ? lo : null,
          add_total_runs: totalRuns,
          avg_run_margin_add: margin,
        });

        const ourBoardsT1 = boardsT1.includes(bid);
        const ourBoardsT2 = boardsT2.includes(bid);
        const weWon =
          (winnerIsT1 && ourBoardsT1) || (winnerIsT2 && ourBoardsT2);

        if (draw)
          bumpFormat(b, fmt, {
            draws: 1,
            points: pointsForFormat(fmt, "draw"),
          });
        else if (weWon)
          bumpFormat(b, fmt, {
            wins: 1,
            points: pointsForFormat(fmt, "win"),
          });
        else if (w)
          bumpFormat(b, fmt, {
            losses: 1,
            points: pointsForFormat(fmt, "loss"),
          });
      });
    });

    // ---------- Championship bonus from Hall of Fame ----------
    const dExpr = `COALESCE(th.final_date, to_date(th.season_year::text||'-12-31','YYYY-MM-DD'))`;
    const wh = [`th.board_id = ANY($1::int[])`];
    const params = [boardIds];
    if (from) {
      wh.push(`${dExpr} >= $${params.length + 1}`);
      params.push(from);
    }
    if (to) {
      wh.push(`${dExpr} <= $${params.length + 1}`);
      params.push(to);
    }

    const hofQ = `
      SELECT th.board_id, UPPER(th.match_type) AS match_type, ${dExpr} AS d
      FROM public.tournament_hall_of_fame th
      WHERE ${wh.join(" AND ")}
    `;
    const { rows: bonusRows } = await pool.query(hofQ, params);

    bonusRows.forEach((r) => {
      const b = ensureBoard(r.board_id);
      const fmt = String(r.match_type || "").toUpperCase();
      const bonus = championshipBonus(fmt);
      if (bonus > 0) bumpFormat(b, fmt, { points: bonus });
    });

    // Optional backward-compat: explicit award table
    try {
      const apWh = [`ap.board_id = ANY($1::int[])`];
      const apParams = [boardIds];
      if (from) {
        apWh.push(`ap.award_date >= $${apParams.length + 1}`);
        apParams.push(from);
      }
      if (to) {
        apWh.push(`ap.award_date <= $${apParams.length + 1}`);
        apParams.push(to);
      }
      const apQ = `
        SELECT ap.board_id, UPPER(ap.match_type) AS match_type, ap.points::int
        FROM public.board_award_points ap
        WHERE ${apWh.join(" AND ")}
      `;
      const { rows: apRows } = await pool.query(apQ, apParams);
      apRows.forEach((r) => {
        const b = ensureBoard(r.board_id);
        bumpFormat(b, r.match_type, { points: Number(r.points) || 0 });
      });
    } catch (_) {
      // ignore if table missing
    }

    // finalize & sort
    const out = Object.values(byBoard).map((b) => {
      finalizeBoard(b);
      return b;
    });

    let top = null;
    out.forEach((o) => {
      if (!top || o.totals.points > top.totals.points) top = o;
    });

    // Ensure boards with zero matches still appear
    boardIds.forEach((bid) => {
      if (!byBoard[bid]) {
        out.push({
          board_id: bid,
          board_name: nameMap.get(bid) || String(bid),
          formats: {},
          totals: {
            matches: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            points: 0,
            win_pct: 0,
          },
        });
      }
    });

    out.sort((a, b) => b.totals.points - a.totals.points);

    res.json({ data: out, top_board: top || null });
  } catch (err) {
    return send500(
      res,
      req,
      "analytics/summary:",
      err,
      "Failed to compute analytics summary"
    );
  }
});

// ---------- GET /timeline ----------

router.get("/timeline", async (req, res) => {
  try {
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if (from && !isISODate(from))
      return res.status(400).json({ error: "from must be YYYY-MM-DD" });
    if (to && !isISODate(to))
      return res.status(400).json({ error: "to must be YYYY-MM-DD" });
    if (from && to && new Date(from) > new Date(to)) {
      return res.status(400).json({ error: "from must be <= to" });
    }

    const boardIdsFilter = toIntArray(req.query.board_ids || "");

    // membership history for all relevant boards
    const teamQ = `
      SELECT
        bt.board_id,
        LOWER(TRIM(bt.team_name)) AS team_name,
        bt.joined_at::date AS joined_at,
        bt.left_at::date   AS left_at
      FROM public.board_teams bt
      ${boardIdsFilter.length ? `WHERE bt.board_id = ANY($1::int[])` : ""}
    `;
    const { rows: teamMapRows } = await pool.query(
      teamQ,
      boardIdsFilter.length ? [boardIdsFilter] : []
    );
    const membershipIndex = buildMembershipIndex(teamMapRows);

    const mhWhereDate = "COALESCE(mh.match_date, mh.match_time::date)";
    const mhRange = addDateRange(mhWhereDate, from, to);
    const tWhereDate = "COALESCE(tm.match_date, tm.created_at::date)";
    const tRange = addDateRange(tWhereDate, from, to);

    const mhQ = `
      SELECT
        LOWER(TRIM(mh.team1)) AS team1,
        LOWER(TRIM(mh.team2)) AS team2,
        LOWER(TRIM(mh.winner)) AS winner,
        UPPER(mh.match_type) AS fmt,
        to_char(${mhWhereDate}, 'YYYY-MM-DD') AS d
      FROM public.match_history mh
      WHERE mh.status = 'approved'
        AND (UPPER(mh.match_type) = 'ODI' OR UPPER(mh.match_type) = 'T20')
        ${mhRange.sql}
    `;
    const { rows: mhRows } = await pool.query(mhQ, mhRange.params);

    const tQ = `
      SELECT
        LOWER(TRIM(tm.team1)) AS team1,
        LOWER(TRIM(tm.team2)) AS team2,
        LOWER(TRIM(tm.winner)) AS winner,
        'TEST'::text AS fmt,
        to_char(${tWhereDate}, 'YYYY-MM-DD') AS d
      FROM public.test_match_results tm
      WHERE tm.status = 'approved'
        ${tRange.sql}
    `;
    const { rows: tRows } = await pool.query(tQ, tRange.params);

    const daily = new Map(); // date -> Map(boardId->points)
    function addPoints(date, bid, pts) {
      if (!daily.has(date)) daily.set(date, new Map());
      const m = daily.get(date);
      m.set(bid, (m.get(bid) || 0) + pts);
    }

    function processMatch(row) {
      const d = row.d;
      const fmt = String(row.fmt || "").toUpperCase();
      const t1 = row.team1 || "";
      const t2 = row.team2 || "";
      const w = row.winner || "";

      const boardsT1 = boardsForTeamAt(membershipIndex, t1, d);
      const boardsT2 = boardsForTeamAt(membershipIndex, t2, d);
      const involvedSet = new Set([...boardsT1, ...boardsT2]);

      let involved = [...involvedSet];
      if (boardIdsFilter.length) {
        involved = involved.filter((bid) => boardIdsFilter.includes(bid));
      }
      if (!involved.length) return;

      const draw = isDrawish(w);
      const winnerIsT1 = wordHit(w, t1);
      const winnerIsT2 = wordHit(w, t2);

      for (const bid of involved) {
        const ourT1 = boardsT1.includes(bid);
        const ourT2 = boardsT2.includes(bid);
        const won =
          (winnerIsT1 && ourT1) || (winnerIsT2 && ourT2);

        if (draw) addPoints(d, bid, pointsForFormat(fmt, "draw"));
        else if (won) addPoints(d, bid, pointsForFormat(fmt, "win"));
        else if (w) addPoints(d, bid, pointsForFormat(fmt, "loss"));
      }
    }

    mhRows.forEach(processMatch);
    tRows.forEach(processMatch);

    // Championship bonus on award date
    const hofDateExpr = `COALESCE(th.final_date, to_date(th.season_year::text||'-12-31','YYYY-MM-DD'))`;
    const wh = [];
    const params = [];
    if (boardIdsFilter.length) {
      wh.push(`th.board_id = ANY($${params.length + 1}::int[])`);
      params.push(boardIdsFilter);
    }
    if (from) {
      wh.push(`${hofDateExpr} >= $${params.length + 1}`);
      params.push(from);
    }
    if (to) {
      wh.push(`${hofDateExpr} <= $${params.length + 1}`);
      params.push(to);
    }
    const hofQ = `
      SELECT th.board_id,
             UPPER(th.match_type) AS match_type,
             to_char(${hofDateExpr}, 'YYYY-MM-DD') AS d
      FROM public.tournament_hall_of_fame th
      ${wh.length ? `WHERE ${wh.join(" AND ")}` : ""}
    `;
    const { rows: bonusRows } = await pool.query(hofQ, params);
    bonusRows.forEach((r) =>
      addPoints(r.d, r.board_id, championshipBonus(r.match_type))
    );

    // Optional explicit board_award_points
    try {
      const apWh = [];
      const apParams = [];
      if (boardIdsFilter.length) {
        apWh.push(`ap.board_id = ANY($${apParams.length + 1}::int[])`);
        apParams.push(boardIdsFilter);
      }
      if (from) {
        apWh.push(`ap.award_date >= $${apParams.length + 1}`);
        apParams.push(from);
      }
      if (to) {
        apWh.push(`ap.award_date <= $${apParams.length + 1}`);
        apParams.push(to);
      }
      const apQ = `
        SELECT ap.board_id, UPPER(ap.match_type) AS match_type,
               to_char(ap.award_date, 'YYYY-MM-DD') AS d,
               ap.points::int
        FROM public.board_award_points ap
        ${apWh.length ? `WHERE ${apWh.join(" AND ")}` : ""}
      `;
      const { rows: apRows } = await pool.query(apQ, apParams);
      apRows.forEach((r) =>
        addPoints(r.d, r.board_id, Number(r.points) || 0)
      );
    } catch (_) {
      // ignore if table missing
    }

    // Build cumulative timeline
    const dates = [...daily.keys()].sort((a, b) => new Date(a) - new Date(b));
    const boardsSet = new Set();
    daily.forEach((m) => m.forEach((_, bid) => boardsSet.add(bid)));
    const cum = new Map([...boardsSet].map((bid) => [bid, 0]));

    const timeline = [];
    let prevTop = null;
    const switches = {};
    const days_held = {};

    dates.forEach((d) => {
      const m = daily.get(d);
      m.forEach((pts, bid) =>
        cum.set(bid, (cum.get(bid) || 0) + pts)
      );

      let topBid = null;
      let topPts = -Infinity;
      cum.forEach((val, bid) => {
        if (val > topPts) {
          topPts = val;
          topBid = bid;
        }
      });

      if (topBid != null) {
        timeline.push({ date: d, board_id: topBid, points: topPts });
        days_held[topBid] = (days_held[topBid] || 0) + 1;
        if (prevTop == null || prevTop !== topBid) {
          switches[topBid] = (switches[topBid] || 0) + 1;
          prevTop = topBid;
        }
      }
    });

    res.json({ timeline, switches, days_held });
  } catch (err) {
    return send500(
      res,
      req,
      "analytics/timeline:",
      err,
      "Failed to compute crown timeline"
    );
  }
});

// ---------- GET /boards/analytics/home/top-board-insight ----------
// homepage helper: find the board that stayed #1 for the longest continuous stretch (all time)

router.get("/home/top-board-insight", async (req, res) => {
  try {
    // 1) all boards
    const { rows: boardRows } = await pool.query(`
      SELECT id AS board_id, board_name
      FROM public.board_registration
      ORDER BY board_name
    `);
    if (!boardRows.length) {
      return res.json({ ok: true, insight: null });
    }
    const allBoardIds = boardRows.map((b) => b.board_id);

    // 2) membership history for ALL boards
    const { rows: teamRows } = await pool.query(
      `
      SELECT
        bt.board_id,
        LOWER(TRIM(bt.team_name)) AS team_name,
        bt.joined_at::date AS joined_at,
        bt.left_at::date   AS left_at
      FROM public.board_teams bt
      WHERE bt.board_id = ANY($1::int[])
    `,
      [allBoardIds]
    );
    const membershipIndex = buildMembershipIndex(teamRows);

    // 3) get ALL approved ODI/T20 matches
    const { rows: mhRows } = await pool.query(`
      SELECT
        LOWER(TRIM(mh.team1)) AS team1,
        LOWER(TRIM(mh.team2)) AS team2,
        LOWER(TRIM(mh.winner)) AS winner,
        UPPER(mh.match_type) AS fmt,
        to_char(COALESCE(mh.match_date, mh.match_time::date), 'YYYY-MM-DD') AS d
      FROM public.match_history mh
      WHERE mh.status = 'approved'
        AND (UPPER(mh.match_type) = 'ODI' OR UPPER(mh.match_type) = 'T20')
    `);

    // 4) get ALL approved Test matches
    const { rows: tRows } = await pool.query(`
      SELECT
        LOWER(TRIM(tm.team1)) AS team1,
        LOWER(TRIM(tm.team2)) AS team2,
        LOWER(TRIM(tm.winner)) AS winner,
        'TEST'::text AS fmt,
        to_char(COALESCE(tm.match_date, tm.created_at::date), 'YYYY-MM-DD') AS d
      FROM public.test_match_results tm
      WHERE tm.status = 'approved'
    `);

    // 5) daily points collector
    const daily = new Map(); // date -> Map(board_id -> pts)
    const addPoints = (date, bid, pts) => {
      if (!daily.has(date)) daily.set(date, new Map());
      const m = daily.get(date);
      m.set(bid, (m.get(bid) || 0) + pts);
    };

    function handleMatch(row) {
      const d = row.d;
      const fmt = row.fmt;
      const t1 = row.team1 || "";
      const t2 = row.team2 || "";
      const w = row.winner || "";

      const boardsT1 = boardsForTeamAt(membershipIndex, t1, d);
      const boardsT2 = boardsForTeamAt(membershipIndex, t2, d);
      const involvedSet = new Set([...boardsT1, ...boardsT2]);
      const involved = [...involvedSet];
      if (!involved.length) return;

      const draw = isDrawish(w);
      const winnerIsT1 = wordHit(w, t1);
      const winnerIsT2 = wordHit(w, t2);

      for (const bid of involved) {
        const ourT1 = boardsT1.includes(bid);
        const ourT2 = boardsT2.includes(bid);
        const won =
          (winnerIsT1 && ourT1) || (winnerIsT2 && ourT2);

        if (draw) addPoints(d, bid, pointsForFormat(fmt, "draw"));
        else if (won) addPoints(d, bid, pointsForFormat(fmt, "win"));
        else if (w) addPoints(d, bid, pointsForFormat(fmt, "loss"));
      }
    }

    mhRows.forEach(handleMatch);
    tRows.forEach(handleMatch);

    // 6) build cumulative & detect daily leader
    const dates = [...daily.keys()].sort((a, b) => new Date(a) - new Date(b));
    const cum = new Map(allBoardIds.map((id) => [id, 0]));

    const dailyLeaders = []; // {date, board_id}
    dates.forEach((d) => {
      const m = daily.get(d);
      m.forEach((pts, bid) => {
        cum.set(bid, (cum.get(bid) || 0) + pts);
      });

      let topBid = null;
      let topPts = -Infinity;
      cum.forEach((v, bid) => {
        if (v > topPts) {
          topPts = v;
          topBid = bid;
        }
      });

      if (topBid != null) dailyLeaders.push({ date: d, board_id: topBid });
    });

    // 7) longest consecutive streak per board
    const streakMap = new Map();
    let prevBid = null;
    let running = 0;
    dailyLeaders.forEach((entry) => {
      if (entry.board_id === prevBid) {
        running += 1;
      } else {
        running = 1;
        prevBid = entry.board_id;
      }
      const prevBest = streakMap.get(entry.board_id) || 0;
      if (running > prevBest) streakMap.set(entry.board_id, running);
    });

    if (!streakMap.size) {
      return res.json({ ok: true, insight: null });
    }

    // 8) pick the board with biggest streak
    let bestBoardId = null;
    let bestStreak = -1;
    streakMap.forEach((val, bid) => {
      if (val > bestStreak) {
        bestStreak = val;
        bestBoardId = bid;
      }
    });

    const bestBoard = boardRows.find((b) => b.board_id === bestBoardId);
    return res.json({
      ok: true,
      insight: {
        board_id: bestBoardId,
        board_name: bestBoard ? bestBoard.board_name : `Board #${bestBoardId}`,
        days_at_top: bestStreak,
        period_days: null, // all time
      },
    });
  } catch (err) {
    console.error("home/top-board-insight failed:", err);
    res.status(500).json({ error: "Failed to compute home insight" });
  }
});

module.exports = router;
