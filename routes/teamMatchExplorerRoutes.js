// C:\cricket-scoreboard-backend\routes\teamMatchExplorerRoutes.js
// Team Match Explorer API (ODI/T20) — matches the `match_history` schema in your screenshot.

const express = require("express");
const router = express.Router();
const pool = require("../db");

const toInt = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const norm = (s) => (s ?? "").toString().trim();

const RESULT_MAP = new Map([
  ["ALL", null],
  ["W", "W"],
  ["L", "L"],
  ["D", "D"],   // draw / no result
  ["NR", "D"],
]);

/**
 * GET /api/team-match-explorer/by-team
 * Query:
 *   team       (string, required)
 *   format     (All|ODI|T20, default All)
 *   season     (year, optional)
 *   tournament (string, optional)
 *   result     (All|W|L|D|NR, default All)
 *   page       (number, default 1)
 *   pageSize   (number, default 20, max 100)
 */
router.get("/by-team", async (req, res) => {
  try {
    const teamRaw = norm(req.query.team);
    if (!teamRaw) return res.status(400).json({ error: "team is required" });

    const format = norm(req.query.format || "All");
    const season = req.query.season ? toInt(req.query.season, null) : null;
    const tournament = req.query.tournament ? norm(req.query.tournament) : null;
    const resultParam = (req.query.result || "All").toUpperCase();
    const resultFilter = RESULT_MAP.get(resultParam) ?? null;

    const page = Math.max(1, toInt(req.query.page, 1));
    const pageSize = Math.min(100, Math.max(1, toInt(req.query.pageSize, 20)));
    const offset = (page - 1) * pageSize;

    // Build base filter using your column names
    const where = [
      "(LOWER(m.team1) = LOWER($1) OR LOWER(m.team2) = LOWER($1))",
      "($2 = 'All' OR LOWER(m.match_type) = LOWER($2))",
      "($3::int IS NULL OR m.season_year = $3)",
      "($4::text IS NULL OR LOWER(m.tournament_name) = LOWER($4))",
    ].join(" AND ");
    const params = [teamRaw, format, season, tournament];

    // Pull rows once, then map to team perspective (we need to compute W/L/D from `winner`)
    const rows = await pool.query(
      `SELECT
         m.id                                        AS match_id,
         COALESCE(m.match_date::date, NULL)          AS date,
         m.match_type                                AS format,
         m.tournament_name                           AS tournament,
         m.season_year                               AS season_year,
         m.match_name                                 AS match_name,
         m.team1, m.runs1, m.overs1, m.wickets1,
         m.team2, m.runs2, m.overs2, m.wickets2,
         m.winner
       FROM match_history m
       WHERE ${where}
       ORDER BY COALESCE(m.match_date, m.created_at) DESC`,
      params
    );

    const mapped = rows.rows.map((r) => {
      const teamIsT1 = r.team1?.toLowerCase() === teamRaw.toLowerCase();
      const opponent = teamIsT1 ? r.team2 : r.team1;

      // Pull the team/opponent innings (primary set; *_2 exists but we ignore for ODI/T20)
      const team_runs  = teamIsT1 ? r.runs1    : r.runs2;
      const team_wkts  = teamIsT1 ? r.wickets1 : r.wickets2;
      const team_overs = teamIsT1 ? r.overs1   : r.overs2;

      const opp_runs   = teamIsT1 ? r.runs2    : r.runs1;
      const opp_wkts   = teamIsT1 ? r.wickets2 : r.wickets1;
      const opp_overs  = teamIsT1 ? r.overs2   : r.overs1;

      // Compute result from `winner` (string of winning team or null)
      const w = (r.winner ?? "").toString().toLowerCase();
      let result = "L";
      if (!w) result = "D";
      else if (w === teamRaw.toLowerCase()) result = "W";

      // Build a human-readable line (no margin column in schema)
      const result_text =
        result === "W"
          ? `${teamRaw} beat ${opponent}`
          : result === "L"
          ? `${opponent} beat ${teamRaw}`
          : "Draw / No Result";

      return {
        match_id: r.match_id,
        date: r.date,
        format: r.format,
        tournament: r.tournament,
        season_year: r.season_year,
        match_name: r.match_name,
        team: teamRaw,
        opponent,
        team_runs, team_wkts, team_overs,
        opp_runs,  opp_wkts,  opp_overs,
        result,
        result_text,
      };
    });

    // Apply optional result filter (W/L/D)
    const filtered = resultFilter
      ? mapped.filter(m => m.result === resultFilter)
      : mapped;

    // Summary + facets
    const summary = {
      played: filtered.length,
      wins:   filtered.filter(m => m.result === "W").length,
      losses: filtered.filter(m => m.result === "L").length,
      draws:  filtered.filter(m => m.result === "D").length,
      last5:  filtered.slice(0, 5).map(m => m.result),
    };
    const seasons     = [...new Set(mapped.map(m => m.season_year).filter(Boolean))].sort((a,b)=>b-a);
    const tournaments = [...new Set(mapped.map(m => m.tournament).filter(Boolean))].sort();

    // Pagination in JS (safe & simple)
    const total = filtered.length;
    const pageItems = filtered.slice(offset, offset + pageSize);

    return res.json({
      team: teamRaw,
      filters: { format, season, tournament, result: resultFilter ?? "All" },
      facets: { seasons, tournaments },
      summary,
      page, pageSize, total,
      matches: pageItems,
    });
  } catch (err) {
    console.error("teamMatchExplorerRoutes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
