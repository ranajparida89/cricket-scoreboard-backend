// 08-AUG-2025 — CrickEdge Board Analytics (schema-aligned)
// Matches your DDL exactly and validates inputs thoroughly.

const express = require("express");
const router = express.Router();
const { Pool } = require("pg");

// Reuse your existing PG setup if you have one; else this is safe.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- Helpers ----------
const isInt = (v) => /^\d+$/.test(String(v));
const isISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const toIntArray = (csv) =>
  (csv || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => (isInt(s) ? Number(s) : NaN))
    .filter(n => Number.isInteger(n));

function pointsForFormat(fmt, outcome) {
  const f = String(fmt || "").toUpperCase();
  if (f === "ODI") {
    if (outcome === "win") return 8;
    if (outcome === "draw") return 2;
    return 0;
  }
  if (f === "T20") {
    if (outcome === "win") return 5;
    if (outcome === "draw") return 2;
    return 0;
  }
  if (f === "TEST") {
    if (outcome === "win") return 12;
    if (outcome === "draw") return 4;
    if (outcome === "loss") return 6; // special Test rule
    return 0;
  }
  return 0;
}

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

// ---------- GET /boards (for dropdowns) ----------
router.get("/boards", async (req, res) => {
  try {
    const q = `
      SELECT id AS board_id, registration_id, board_name
      FROM board_registration
      ORDER BY board_name;
    `;
    const { rows } = await pool.query(q);
    res.json({ boards: rows });
  } catch (err) {
    console.error("analytics/boards:", err);
    res.status(500).json({ error: "Failed to fetch boards" });
  }
});

// ---------- GET /summary ----------
/**
 * Query:
 *   /summary?board_ids=1,2,3&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Computes, per board:
 * - matches, wins, draws, losses (ODI/T20 from match_history, Test from test_match_results)
 * - points by your rules
 * - win %
 * - highest/lowest score (by single-innings score available)
 * - avg run margin (ODI/T20: |runs1 - runs2|; Test: |(team1 total) - (team2 total)|)
 *
 * Rules:
 * - A board "participates" if any of its teams equals team1 or team2 (case-insensitive).
 * - A board "wins" if winner equals one of its team names (case-insensitive).
 * - Draw: winner ILIKE 'draw'
 * - Status must be 'approved'.
 */
router.get("/summary", async (req, res) => {
  try {
    // ---- Validate inputs ----
    const boardIds = toIntArray(req.query.board_ids);
    if (!boardIds.length) {
      return res.status(400).json({ error: "board_ids (comma-separated integers) is required" });
    }
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    if (from && !isISODate(from)) return res.status(400).json({ error: "from must be YYYY-MM-DD" });
    if (to && !isISODate(to)) return res.status(400).json({ error: "to must be YYYY-MM-DD" });
    if (from && to && new Date(from) > new Date(to)) {
      return res.status(400).json({ error: "from must be <= to" });
    }

    // ---- Pull board & team maps upfront ----
    const boardsQ = `
      SELECT b.id AS board_id, b.board_name
      FROM board_registration b
      WHERE b.id = ANY($1::int[])
    `;
    const { rows: boardRows } = await pool.query(boardsQ, [boardIds]);
    if (!boardRows.length) {
      return res.status(404).json({ error: "No matching boards found" });
    }
    const nameMap = new Map(boardRows.map(r => [r.board_id, r.board_name]));

    const teamsQ = `
      SELECT bt.board_id, LOWER(TRIM(bt.team_name)) AS team_name
      FROM board_teams bt
      WHERE bt.board_id = ANY($1::int[])
    `;
    const { rows: teamRows } = await pool.query(teamsQ, [boardIds]);
    const boardTeams = new Map(); // board_id -> Set(team_name_lower)
    teamRows.forEach(r => {
      if (!boardTeams.has(r.board_id)) boardTeams.set(r.board_id, new Set());
      boardTeams.get(r.board_id).add(r.team_name);
    });

    // If any board has no teams, still include it with zeros
    boardIds.forEach(id => {
      if (!boardTeams.has(id)) boardTeams.set(id, new Set());
    });

    // ---- Build ODI/T20 aggregates (match_history) ----
    const mhRange = addDateRange("mh.match_time::date", from, to);
    // We’ll select matches once and aggregate per board in JS to avoid insane SQL gymnastics.
    const mhQ = `
      SELECT
        mh.id,
        mh.match_type,
        LOWER(TRIM(mh.team1)) AS team1,
        mh.runs1,
        mh.wickets1,
        mh.runs1_2,
        mh.wickets1_2,
        LOWER(TRIM(mh.team2)) AS team2,
        mh.runs2,
        mh.wickets2,
        mh.runs2_2,
        mh.wickets2_2,
        LOWER(TRIM(mh.winner)) AS winner,
        mh.match_time::date AS d
      FROM match_history mh
      WHERE mh.status = 'approved'
        AND (UPPER(mh.match_type) = 'ODI' OR UPPER(mh.match_type) = 'T20')
        ${mhRange.sql}
    `;
    const { rows: mhRows } = await pool.query(mhQ, mhRange.params);

    // ---- Build Test aggregates (test_match_results) ----
    const tRange = addDateRange("tm.created_at::date", from, to);
    const tQ = `
      SELECT
        tm.id,
        LOWER(TRIM(tm.team1)) AS team1,
        tm.runs1, tm.runs1_2,
        LOWER(TRIM(tm.team2)) AS team2,
        tm.runs2, tm.runs2_2,
        LOWER(TRIM(tm.winner)) AS winner,
        tm.created_at::date AS d
      FROM test_match_results tm
      WHERE tm.status = 'approved'
        ${tRange.sql}
    `;
    const { rows: testRows } = await pool.query(tQ, tRange.params);

    // ---- In-memory aggregation per board ----
    const byBoard = {};
    const ensureBoard = (id) => {
      if (!byBoard[id]) {
        byBoard[id] = {
          board_id: id,
          board_name: nameMap.get(id) || String(id),
          formats: {}, // ODI, T20, TEST
          totals: { matches: 0, wins: 0, draws: 0, losses: 0, points: 0 }
        };
      }
      return byBoard[id];
    };

    function bumpFormat(b, fmt, patch) {
      const F = fmt.toUpperCase();
      if (!b.formats[F]) {
        b.formats[F] = {
          matches: 0, wins: 0, draws: 0, losses: 0,
          win_pct: 0, points: 0,
          avg_run_margin_acc: 0, avg_run_margin_n: 0,
          highest_score: null, lowest_score: null,
          total_runs_all_teams: 0
        };
      }
      Object.keys(patch).forEach(k => {
        if (k === "avg_run_margin_add") {
          b.formats[F].avg_run_margin_acc += patch[k];
          b.formats[F].avg_run_margin_n += 1;
        } else if (k === "maybe_highest" && patch[k] != null) {
          const cur = b.formats[F].highest_score;
          b.formats[F].highest_score = (cur == null) ? patch[k] : Math.max(cur, patch[k]);
        } else if (k === "maybe_lowest" && patch[k] != null) {
          const cur = b.formats[F].lowest_score;
          b.formats[F].lowest_score = (cur == null) ? patch[k] : Math.min(cur, patch[k]);
        } else if (k === "add_total_runs") {
          b.formats[F].total_runs_all_teams += patch[k];
        } else if (Object.prototype.hasOwnProperty.call(b.formats[F], k)) {
          b.formats[F][k] += patch[k];
        }
      });
    }

    // Utility: update totals & points after per-format increments
    function finalizeBoard(b) {
      Object.entries(b.formats).forEach(([fmt, f]) => {
        // points already included when we incremented outcomes at the format level
        f.win_pct = f.matches ? Number(((f.wins / f.matches) * 100).toFixed(2)) : 0;
        // avg margin
        f.avg_run_margin = f.avg_run_margin_n ? Number((f.avg_run_margin_acc / f.avg_run_margin_n).toFixed(2)) : 0;

        // roll-up to totals
        b.totals.matches += f.matches;
        b.totals.wins += f.wins;
        b.totals.draws += f.draws;
        b.totals.losses += f.losses;
        b.totals.points += f.points;
      });
      b.totals.win_pct = b.totals.matches ? Number(((b.totals.wins / b.totals.matches) * 100).toFixed(2)) : 0;
    }

    // ---- Process match_history rows into boards (ODI/T20) ----
    // For each match, determine which boards participated (by team membership).
    mhRows.forEach(m => {
      const fmt = String(m.match_type || "").toUpperCase();
      const t1 = m.team1 || "";
      const t2 = m.team2 || "";
      const w = m.winner || "";

      // Collect participating boards for t1/t2
      const participants = [];
      boardIds.forEach(bid => {
        const set = boardTeams.get(bid);
        const t1In = set.has(t1);
        const t2In = set.has(t2);
        if (t1In || t2In) {
          participants.push({ board_id: bid, t1In, t2In });
        }
      });

      // Single-innings highest/lowest we can derive from runs1/runs2
      const hiCandidate = Math.max(
        Number.isFinite(m.runs1) ? m.runs1 : -Infinity,
        Number.isFinite(m.runs2) ? m.runs2 : -Infinity
      );
      const loCandidate = Math.min(
        Number.isFinite(m.runs1) ? m.runs1 : Infinity,
        Number.isFinite(m.runs2) ? m.runs2 : Infinity
      );

      const runMargin = (Number.isFinite(m.runs1) && Number.isFinite(m.runs2))
        ? Math.abs(m.runs1 - m.runs2)
        : 0;

      const totalRunsAll = (Number(m.runs1) || 0) + (Number(m.runs2) || 0);

      participants.forEach(p => {
        const b = ensureBoard(p.board_id);
        // Count match once per board even if both teams belong to that board
        bumpFormat(b, fmt, { matches: 1, maybe_highest: isFinite(hiCandidate) ? hiCandidate : null, maybe_lowest: isFinite(loCandidate) ? loCandidate : null, add_total_runs: totalRunsAll, avg_run_margin_add: runMargin });

        const set = boardTeams.get(p.board_id);
        const boardHasWinner = w && set.has(w);
        const isDraw = w === "draw";

        if (isDraw) {
          bumpFormat(b, fmt, { draws: 1, points: pointsForFormat(fmt, "draw") });
        } else if (boardHasWinner) {
          bumpFormat(b, fmt, { wins: 1, points: pointsForFormat(fmt, "win") });
        } else if (w) {
          // non-empty winner but not ours => loss
          bumpFormat(b, fmt, { losses: 1, points: pointsForFormat(fmt, "loss") });
        }
      });
    });

    // ---- Process test_match_results rows (TEST) ----
    testRows.forEach(m => {
      const fmt = "TEST";
      const t1 = m.team1 || "";
      const t2 = m.team2 || "";
      const w = m.winner || "";

      const participants = [];
      boardIds.forEach(bid => {
        const set = boardTeams.get(bid);
        const t1In = set.has(t1);
        const t2In = set.has(t2);
        if (t1In || t2In) {
          participants.push({ board_id: bid, t1In, t2In });
        }
      });

      // Test total runs by side (two innings possibly)
      const t1Total = (Number(m.runs1) || 0) + (Number(m.runs1_2) || 0);
      const t2Total = (Number(m.runs2) || 0) + (Number(m.runs2_2) || 0);
      const hiCandidate = Math.max(
        Number(m.runs1) || 0, Number(m.runs1_2) || 0,
        Number(m.runs2) || 0, Number(m.runs2_2) || 0
      );
      // For lowest, ignore zeros that mean "did not bat"
      const safeVals = [m.runs1, m.runs1_2, m.runs2, m.runs2_2]
        .map(v => Number(v))
        .filter(v => Number.isFinite(v) && v > 0);
      const loCandidate = safeVals.length ? Math.min(...safeVals) : null;

      const runMargin = Math.abs(t1Total - t2Total);
      const totalRunsAll = t1Total + t2Total;
      const isDraw = (w === "draw");

      participants.forEach(p => {
        const b = ensureBoard(p.board_id);
        bumpFormat(b, fmt, {
          matches: 1,
          maybe_highest: isFinite(hiCandidate) ? hiCandidate : null,
          maybe_lowest: (loCandidate != null && isFinite(loCandidate)) ? loCandidate : null,
          add_total_runs: totalRunsAll,
          avg_run_margin_add: runMargin
        });

        const set = boardTeams.get(p.board_id);
        const boardHasWinner = w && set.has(w);

        if (isDraw) {
          bumpFormat(b, fmt, { draws: 1, points: pointsForFormat(fmt, "draw") });
        } else if (boardHasWinner) {
          bumpFormat(b, fmt, { wins: 1, points: pointsForFormat(fmt, "win") });
        } else if (w) {
          bumpFormat(b, fmt, { losses: 1, points: pointsForFormat(fmt, "loss") });
        }
      });
    });

    // ---- Finalize & shape output ----
    const out = Object.values(byBoard).map(b => {
      finalizeBoard(b);
      return b;
    });

    // Determine top board by total points
    let top = null;
    out.forEach(o => { if (!top || o.totals.points > top.totals.points) top = o; });

    // Ensure boards with no matches still appear (zeros)
    boardIds.forEach(bid => {
      if (!byBoard[bid]) {
        out.push({
          board_id: bid,
          board_name: nameMap.get(bid) || String(bid),
          formats: {},
          totals: { matches: 0, wins: 0, draws: 0, losses: 0, points: 0, win_pct: 0 }
        });
      }
    });

    // Sort by points desc for convenience
    out.sort((a,b) => b.totals.points - a.totals.points);

    res.json({ data: out, top_board: top || null });
  } catch (err) {
    console.error("analytics/summary:", err);
    res.status(500).json({ error: "Failed to compute analytics summary" });
  }
});

// ---------- GET /timeline ----------
/**
 * /timeline?from=YYYY-MM-DD&to=YYYY-MM-DD&board_ids=1,2,3 (optional board filter)
 * Produces daily top board by cumulative points.
 * Points awarded per match date:
 *   - ODI/T20: use match_history.match_time::date
 *   - Test:    use test_match_results.created_at::date
 */
router.get("/timeline", async (req, res) => {
  try {
    const from = req.query.from ? String(req.query.from) : null;
    const to   = req.query.to ? String(req.query.to) : null;
    if (from && !isISODate(from)) return res.status(400).json({ error: "from must be YYYY-MM-DD" });
    if (to && !isISODate(to)) return res.status(400).json({ error: "to must be YYYY-MM-DD" });
    if (from && to && new Date(from) > new Date(to)) {
      return res.status(400).json({ error: "from must be <= to" });
    }

    const boardIdsFilter = toIntArray(req.query.board_ids || "");

    // Build a temp mapping of team -> board for all boards (or filtered boards)
    const teamQ = `
      SELECT bt.board_id, LOWER(TRIM(bt.team_name)) AS team_name
      FROM board_teams bt
      ${boardIdsFilter.length ? `WHERE bt.board_id = ANY($1::int[])` : ""}
    `;
    const { rows: teamMapRows } = await pool.query(teamQ, boardIdsFilter.length ? [boardIdsFilter] : []);
    const teamToBoards = new Map(); // team -> Set(board_id)
    teamMapRows.forEach(r => {
      const key = r.team_name;
      if (!teamToBoards.has(key)) teamToBoards.set(key, new Set());
      teamToBoards.get(key).add(r.board_id);
    });

    const mhRange = addDateRange("mh.match_time::date", from, to);
    const tRange  = addDateRange("tm.created_at::date", from, to);

    // Fetch only the minimal fields needed
    const mhQ = `
      SELECT
        LOWER(TRIM(mh.team1)) AS team1,
        LOWER(TRIM(mh.team2)) AS team2,
        LOWER(TRIM(mh.winner)) AS winner,
        UPPER(mh.match_type) AS fmt,
        mh.match_time::date AS d
      FROM match_history mh
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
        tm.created_at::date AS d
      FROM test_match_results tm
      WHERE tm.status = 'approved'
        ${tRange.sql}
    `;
    const { rows: tRows } = await pool.query(tQ, tRange.params);

    // Build daily per-board points
    const daily = new Map(); // date -> board_id -> points
    function addPoints(date, boardId, pts) {
      if (!daily.has(date)) daily.set(date, new Map());
      const m = daily.get(date);
      m.set(boardId, (m.get(boardId) || 0) + pts);
    }

    function processMatch(row) {
      const d = row.d;
      const fmt = String(row.fmt || "").toUpperCase();
      const t1 = row.team1 || "";
      const t2 = row.team2 || "";
      const w  = row.winner || "";

      const boardsT1 = teamToBoards.get(t1) || new Set();
      const boardsT2 = teamToBoards.get(t2) || new Set();
      const involvedBoards = new Set([...boardsT1, ...boardsT2]);

      // Optional filter by board_ids
      if (boardIdsFilter.length) {
        for (const bid of [...involvedBoards]) {
          if (!boardIdsFilter.includes(bid)) involvedBoards.delete(bid);
        }
      }
      if (!involvedBoards.size) return;

      const isDraw = (w === "draw");

      // For each involved board, award points based on whether winner belongs to them
      for (const bid of involvedBoards) {
        const set = new Set();
        (teamToBoards.get(w) || new Set()).forEach(b => set.add(b)); // boards that own the winner team
        const boardHasWinner = w && set.has(bid);

        if (isDraw) {
          addPoints(d, bid, pointsForFormat(fmt, "draw"));
        } else if (boardHasWinner) {
          addPoints(d, bid, pointsForFormat(fmt, "win"));
        } else if (w) {
          addPoints(d, bid, pointsForFormat(fmt, "loss"));
        }
      }
    }

    mhRows.forEach(processMatch);
    tRows.forEach(processMatch);

    // Convert to cumulative timeline & summarize switches/days held
    // Build sorted dates
    const dates = [...daily.keys()].sort((a,b)=> new Date(a)-new Date(b));
    const boardsSet = new Set();
    daily.forEach(map => map.forEach((_, bid) => boardsSet.add(bid)));

    // cumulative per board
    const cum = new Map([...boardsSet].map(bid => [bid, 0]));

    const timeline = [];
    let prevTop = null;
    const switches = {};  // board_id -> count top switches
    const daysHeld = {};  // board_id -> days on top

    dates.forEach(d => {
      const map = daily.get(d);
      map.forEach((pts, bid) => {
        cum.set(bid, (cum.get(bid) || 0) + pts);
      });

      // pick top (max cum points) for the day
      let topBid = null;
      let topPts = -Infinity;
      cum.forEach((val, bid) => {
        if (val > topPts) { topPts = val; topBid = bid; }
      });

      if (topBid != null) {
        timeline.push({ date: d, board_id: topBid, points: topPts });
        daysHeld[topBid] = (daysHeld[topBid] || 0) + 1;
        if (prevTop == null || prevTop !== topBid) {
          switches[topBid] = (switches[topBid] || 0) + 1;
          prevTop = topBid;
        }
      }
    });

    res.json({ timeline, switches, days_held: daysHeld });
  } catch (err) {
    console.error("analytics/timeline:", err);
    res.status(500).json({ error: "Failed to compute crown timeline" });
  }
});

module.exports = router;
