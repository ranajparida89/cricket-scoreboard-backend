// routes/boardAnalyticsRoutes.js
// 08-AUG-2025 — CrickEdge Board Analytics (schema-aligned, updated rules + parsing)

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ---------- Helpers ----------
const isInt = (v) => /^\d+$/.test(String(v));
const isISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const toIntArray = (csv) =>
  (csv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (isInt(s) ? Number(s) : NaN))
    .filter((n) => Number.isInteger(n));

// 🔁 New points as per your rule
// ODI/T20: Win=10, Draw=5, Loss=2
// TEST:    Win=18, Draw=9, Loss=4
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

// date range helper
function addDateRange(whereCol, from, to) {
  const parts = [], params = [];
  if (from) { parts.push(`${whereCol} >= $${params.length + 1}`); params.push(from); }
  if (to)   { parts.push(`${whereCol} <= $${params.length + 1}`); params.push(to); }
  return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
}

function send500(res, req, tag, err, msg) {
  console.error(tag, err);
  if (req.query.debug === "1") return res.status(500).json({ error: err?.message || String(err) });
  return res.status(500).json({ error: msg });
}

// Winner parsing helpers
const reEsc = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordHit = (text, needle) => {
  if (!text || !needle) return false;
  const re = new RegExp(`\\b${reEsc(String(needle).trim())}\\b`, "i");
  return re.test(String(text));
};
const isDrawish = (w) => /\b(draw|tie|tied|no\s*result|abandon)/i.test(String(w || "").trim());

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
    const boardIds = toIntArray(req.query.board_ids);
    if (!boardIds.length) {
      return res.status(400).json({ error: "board_ids (comma-separated integers) is required" });
    }
    const from = req.query.from ? String(req.query.from) : null;
    const to   = req.query.to   ? String(req.query.to)   : null;

    if (from && !isISODate(from)) return res.status(400).json({ error: "from must be YYYY-MM-DD" });
    if (to && !isISODate(to))     return res.status(400).json({ error: "to must be YYYY-MM-DD" });
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
    if (!boardRows.length) return res.status(404).json({ error: "No matching boards found" });
    const nameMap = new Map(boardRows.map(r => [r.board_id, r.board_name]));

    // Teams per board (lowercased)
    const teamsQ = `
      SELECT bt.board_id, LOWER(TRIM(bt.team_name)) AS team_name
      FROM public.board_teams bt
      WHERE bt.board_id = ANY($1::int[])
    `;
    const { rows: teamRows } = await pool.query(teamsQ, [boardIds]);
    const boardTeams = new Map();
    teamRows.forEach(r => {
      if (!boardTeams.has(r.board_id)) boardTeams.set(r.board_id, new Set());
      boardTeams.get(r.board_id).add(r.team_name);
    });
    boardIds.forEach(id => { if (!boardTeams.has(id)) boardTeams.set(id, new Set()); });

    // ODI/T20 matches (date-safe)
    const mhRange = addDateRange("COALESCE(mh.match_date, mh.match_time::date)", from, to);
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
    const tRange = addDateRange("COALESCE(tm.match_date, tm.created_at::date)", from, to);
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

    // Aggregate
    const byBoard = {};
    const ensureBoard = (id) => {
      if (!byBoard[id]) {
        byBoard[id] = {
          board_id: id,
          board_name: nameMap.get(id) || String(id),
          formats: {},
          totals: { matches: 0, wins: 0, draws: 0, losses: 0, points: 0 }
        };
      }
      return byBoard[id];
    };

    function bumpFormat(b, fmt, patch) {
      const F = String(fmt || "").toUpperCase();
      if (!b.formats[F]) {
        b.formats[F] = {
          matches: 0, wins: 0, draws: 0, losses: 0, win_pct: 0, points: 0,
          avg_run_margin_acc: 0, avg_run_margin_n: 0,
          highest_score: null, lowest_score: null, total_runs_all_teams: 0
        };
      }
      Object.keys(patch).forEach(k => {
        if (k === "avg_run_margin_add") {
          b.formats[F].avg_run_margin_acc += patch[k];
          b.formats[F].avg_run_margin_n += 1;
        } else if (k === "maybe_highest" && patch[k] != null) {
          b.formats[F].highest_score = b.formats[F].highest_score == null
            ? patch[k] : Math.max(b.formats[F].highest_score, patch[k]);
        } else if (k === "maybe_lowest" && patch[k] != null) {
          b.formats[F].lowest_score = b.formats[F].lowest_score == null
            ? patch[k] : Math.min(b.formats[F].lowest_score, patch[k]);
        } else if (k === "add_total_runs") {
          b.formats[F].total_runs_all_teams += patch[k];
        } else if (Object.prototype.hasOwnProperty.call(b.formats[F], k)) {
          b.formats[F][k] += patch[k];
        }
      });
    }

    function finalizeBoard(b) {
      Object.entries(b.formats).forEach(([, f]) => {
        f.win_pct = f.matches ? Number(((f.wins / f.matches) * 100).toFixed(2)) : 0;
        f.avg_run_margin = f.avg_run_margin_n
          ? Number((f.avg_run_margin_acc / f.avg_run_margin_n).toFixed(2)) : 0;

        b.totals.matches += f.matches;
        b.totals.wins += f.wins;
        b.totals.draws += f.draws;
        b.totals.losses += f.losses;
        b.totals.points += f.points;
      });
      b.totals.win_pct = b.totals.matches
        ? Number(((b.totals.wins / b.totals.matches) * 100).toFixed(2)) : 0;
    }

    // ---------- ODI/T20 aggregation with robust winner parsing ----------
    mhRows.forEach(m => {
      const fmt = m.match_type;
      const t1 = m.team1 || "", t2 = m.team2 || "", w = m.winner || "";

      const participants = [];
      boardIds.forEach(bid => {
        const set = boardTeams.get(bid);
        if (set.has(t1) || set.has(t2)) participants.push(bid);
      });

      const hi = Math.max(Number.isFinite(m.runs1) ? m.runs1 : -Infinity, Number.isFinite(m.runs2) ? m.runs2 : -Infinity);
      const lo = Math.min(Number.isFinite(m.runs1) ? m.runs1 : Infinity,   Number.isFinite(m.runs2) ? m.runs2 : Infinity);
      const margin = (Number.isFinite(m.runs1) && Number.isFinite(m.runs2)) ? Math.abs(m.runs1 - m.runs2) : 0;
      const totalRuns = (Number(m.runs1) || 0) + (Number(m.runs2) || 0);

      const isDraw = isDrawish(w);
      const winnerIsT1 = wordHit(w, t1);
      const winnerIsT2 = wordHit(w, t2);

      participants.forEach(bid => {
        const b = ensureBoard(bid);
        bumpFormat(b, fmt, {
          matches: 1,
          maybe_highest: isFinite(hi) ? hi : null,
          maybe_lowest:  isFinite(lo) ? lo : null,
          add_total_runs: totalRuns,
          avg_run_margin_add: margin
        });

        const set = boardTeams.get(bid);
        const weWon =
          (winnerIsT1 && set.has(t1)) ||
          (winnerIsT2 && set.has(t2));

        if (isDraw)       bumpFormat(b, fmt, { draws: 1,  points: pointsForFormat(fmt, "draw") });
        else if (weWon)   bumpFormat(b, fmt, { wins: 1,   points: pointsForFormat(fmt, "win") });
        else if (w)       bumpFormat(b, fmt, { losses: 1, points: pointsForFormat(fmt, "loss") });
      });
    });

    // ---------- Test aggregation ----------
    testRows.forEach(m => {
      const fmt = "TEST";
      const t1 = m.team1 || "", t2 = m.team2 || "", w = m.winner || "";

      const participants = [];
      boardIds.forEach(bid => {
        const set = boardTeams.get(bid);
        if (set.has(t1) || set.has(t2)) participants.push(bid);
      });

      const t1Total = (Number(m.runs1) || 0) + (Number(m.runs1_2) || 0);
      const t2Total = (Number(m.runs2) || 0) + (Number(m.runs2_2) || 0);
      const hi = Math.max(Number(m.runs1)||0, Number(m.runs1_2)||0, Number(m.runs2)||0, Number(m.runs2_2)||0);
      const safeVals = [m.runs1, m.runs1_2, m.runs2, m.runs2_2].map(Number).filter(v => Number.isFinite(v) && v > 0);
      const lo = safeVals.length ? Math.min(...safeVals) : null;
      const margin = Math.abs(t1Total - t2Total);
      const totalRuns = t1Total + t2Total;

      const isDraw = isDrawish(w);          // in TEST table, winner is plain team or 'draw'
      const winnerIsT1 = wordHit(w, t1);
      const winnerIsT2 = wordHit(w, t2);

      participants.forEach(bid => {
        const b = ensureBoard(bid);
        bumpFormat(b, fmt, {
          matches: 1,
          maybe_highest: isFinite(hi) ? hi : null,
          maybe_lowest: (lo != null && isFinite(lo)) ? lo : null,
          add_total_runs: totalRuns,
          avg_run_margin_add: margin
        });

        const set = boardTeams.get(bid);
        const weWon =
          (winnerIsT1 && set.has(t1)) ||
          (winnerIsT2 && set.has(t2));

        if (isDraw)       bumpFormat(b, fmt, { draws: 1,  points: pointsForFormat(fmt, "draw") });
        else if (weWon)   bumpFormat(b, fmt, { wins: 1,   points: pointsForFormat(fmt, "win") });
        else if (w)       bumpFormat(b, fmt, { losses: 1, points: pointsForFormat(fmt, "loss") });
      });
    });

    // finalize
    const out = Object.values(byBoard).map(b => { finalizeBoard(b); return b; });
    let top = null; out.forEach(o => { if (!top || o.totals.points > top.totals.points) top = o; });
    boardIds.forEach(bid => {
      if (!byBoard[bid]) out.push({
        board_id: bid,
        board_name: nameMap.get(bid) || String(bid),
        formats: {},
        totals: { matches:0, wins:0, draws:0, losses:0, points:0, win_pct:0 }
      });
    });
    out.sort((a,b) => b.totals.points - a.totals.points);

    res.json({ data: out, top_board: top || null });
  } catch (err) {
    return send500(res, req, "analytics/summary:", err, "Failed to compute analytics summary");
  }
});

// ---------- GET /timeline ----------
router.get("/timeline", async (req, res) => {
  try {
    const from = req.query.from ? String(req.query.from) : null;
    const to   = req.query.to   ? String(req.query.to)   : null;
    if (from && !isISODate(from)) return res.status(400).json({ error: "from must be YYYY-MM-DD" });
    if (to && !isISODate(to))     return res.status(400).json({ error: "to must be YYYY-MM-DD" });
    if (from && to && new Date(from) > new Date(to)) {
      return res.status(400).json({ error: "from must be <= to" });
    }

    const boardIdsFilter = toIntArray(req.query.board_ids || "");

    const teamQ = `
      SELECT bt.board_id, LOWER(TRIM(bt.team_name)) AS team_name
      FROM public.board_teams bt
      ${boardIdsFilter.length ? `WHERE bt.board_id = ANY($1::int[])` : ""}
    `;
    const { rows: teamMapRows } = await pool.query(teamQ, boardIdsFilter.length ? [boardIdsFilter] : []);
    const teamToBoards = new Map();
    teamMapRows.forEach(r => {
      if (!teamToBoards.has(r.team_name)) teamToBoards.set(r.team_name, new Set());
      teamToBoards.get(r.team_name).add(r.board_id);
    });

    const mhRange = addDateRange("COALESCE(mh.match_date, mh.match_time::date)", from, to);
    const tRange  = addDateRange("COALESCE(tm.match_date, tm.created_at::date)", from, to);

    const mhQ = `
      SELECT
        LOWER(TRIM(mh.team1)) AS team1,
        LOWER(TRIM(mh.team2)) AS team2,
        LOWER(TRIM(mh.winner)) AS winner,
        UPPER(mh.match_type) AS fmt,
        COALESCE(mh.match_date, mh.match_time::date) AS d
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
        COALESCE(tm.match_date, tm.created_at::date) AS d
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
      const d = row.d, fmt = String(row.fmt || "").toUpperCase();
      const t1 = row.team1 || "", t2 = row.team2 || "", w = row.winner || "";
      const boardsT1 = teamToBoards.get(t1) || new Set();
      const boardsT2 = teamToBoards.get(t2) || new Set();
      const involved = new Set([...boardsT1, ...boardsT2]);

      if (boardIdsFilter.length) {
        for (const bid of [...involved]) if (!boardIdsFilter.includes(bid)) involved.delete(bid);
      }
      if (!involved.size) return;

      const draw = isDrawish(w);
      const winnerIsT1 = wordHit(w, t1);
      const winnerIsT2 = wordHit(w, t2);

      for (const bid of involved) {
        const won = (winnerIsT1 && boardsT1.has(bid)) || (winnerIsT2 && boardsT2.has(bid));
        if (draw) addPoints(d, bid, pointsForFormat(fmt, "draw"));
        else if (won) addPoints(d, bid, pointsForFormat(fmt, "win"));
        else if (w) addPoints(d, bid, pointsForFormat(fmt, "loss"));
      }
    }

    mhRows.forEach(processMatch);
    tRows.forEach(processMatch);

    const dates = [...daily.keys()].sort((a,b)=> new Date(a)-new Date(b));
    const boardsSet = new Set(); daily.forEach(m => m.forEach((_, bid)=> boardsSet.add(bid)));
    const cum = new Map([...boardsSet].map(bid => [bid, 0]));

    const timeline = []; let prevTop = null;
    const switches = {}, days_held = {};

    dates.forEach(d => {
      const m = daily.get(d);
      m.forEach((pts, bid) => cum.set(bid, (cum.get(bid) || 0) + pts));

      let topBid = null, topPts = -Infinity;
      cum.forEach((val, bid) => { if (val > topPts) { topPts = val; topBid = bid; } });

      if (topBid != null) {
        timeline.push({ date: d, board_id: topBid, points: topPts });
        days_held[topBid] = (days_held[topBid] || 0) + 1;
        if (prevTop == null || prevTop !== topBid) { switches[topBid] = (switches[topBid] || 0) + 1; prevTop = topBid; }
      }
    });

    res.json({ timeline, switches, days_held });
  } catch (err) {
    return send500(res, req, "analytics/timeline:", err, "Failed to compute crown timeline");
  }
});

module.exports = router;
