// routes/h2hRoutes.js
// Premium H2H routes – supports TEST table (test_match_results) + ALL union
// Last updated: 2025-08-17

const express = require("express");
const router = express.Router();
const pool = require("../db");

// -------- helpers --------
const titleCase = (s = "") =>
  s
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());

/**
 * GET /api/h2h/summary
 * Params: team1, team2, type (ALL|ODI|T20|TEST)
 * - ODI/T20: reads match_history filtered by match_type
 * - TEST: reads test_match_results
 * - ALL: reads ODI/T20 from match_history UNION ALL with TEST from test_match_results
 */
router.get("/summary", async (req, res) => {
  const { team1, team2, type } = req.query;

  if (!team1 || !team2 || !type || team1.toLowerCase() === team2.toLowerCase()) {
    return res
      .status(400)
      .json({ error: "Please provide two different teams and a match type" });
  }

  try {
    const t1 = team1.trim();
    const t2 = team2.trim();
    const up = String(type).toUpperCase();

    // team pair predicate reused across queries
    const pairWhere = `
      (
        (LOWER(TRIM(team1)) = LOWER($1) AND LOWER(TRIM(team2)) = LOWER($2))
        OR
        (LOWER(TRIM(team1)) = LOWER($2) AND LOWER(TRIM(team2)) = LOWER($1))
      )
    `;

    let queryText = "";
    let queryParams = [t1, t2];

    if (up === "TEST") {
      // Only Test table
      queryText = `
        SELECT id, match_name, winner, 'TEST' AS match_type
        FROM test_match_results
        WHERE ${pairWhere}
      `;
    } else if (up === "ODI" || up === "T20") {
      // Only match_history filtered by match_type
      queryText = `
        SELECT id, match_name, winner, match_type
        FROM match_history
        WHERE ${pairWhere}
          AND LOWER(TRIM(match_type)) = LOWER($3)
      `;
      queryParams.push(type); // keep original casing; comparison is LOWER()ed anyway
    } else {
      // ALL – ODI/T20 from match_history UNION ALL Test table
      queryText = `
        SELECT id, match_name, winner, match_type
        FROM match_history
        WHERE ${pairWhere} AND LOWER(TRIM(match_type)) IN ('odi','t20')
        UNION ALL
        SELECT id, match_name, winner, 'TEST' AS match_type
        FROM test_match_results
        WHERE ${pairWhere}
      `;
      // placeholders used twice for the UNION
      queryParams = [t1, t2, t1, t2];
    }

    const matchResult = await pool.query(queryText, queryParams);
    const matches = matchResult.rows || [];

    const matchIds = matches.map((m) => m.id);
    const matchNames = matches.map((m) => m.match_name).filter(Boolean);

    if (matchIds.length === 0) {
      return res.json({
        total_matches: 0,
        [t1]: 0,
        [t2]: 0,
        draws: 0,
        win_percentage_team1: 0,
        win_percentage_team2: 0,
      });
    }

    // Tally wins/draws (treat null/''/'draw'/'tie' as draw)
    let team1Wins = 0,
      team2Wins = 0,
      draws = 0;

    for (const m of matches) {
      const w = (m.winner || "").trim().toLowerCase();
      if (!w || w.includes("draw") || w.includes("tie")) draws++;
      else if (w.includes(t1.toLowerCase())) team1Wins++;
      else if (w.includes(t2.toLowerCase())) team2Wins++;
    }

    const total = matchIds.length;
    const winPct1 = total ? Math.round((team1Wins / total) * 100) : 0;
    const winPct2 = total ? Math.round((team2Wins / total) * 100) : 0;

    // (Optional) top scorer/bowler queries kept here for future; they’re not returned right now
    // If your player_performance has pp.match_type values like 'Test', the LOWER(...) = LOWER($4) works.
    // We run them best-effort but don’t block the response.
    try {
      const scorerParams = [matchNames, t1, t2];
      const bowlerParams = [matchNames, t1, t2];
      const addType = up !== "ALL" ? " AND LOWER(TRIM(pp.match_type)) = LOWER($4) " : "";
      if (up !== "ALL") {
        scorerParams.push(type);
        bowlerParams.push(type);
      }

      const scorerQueryStr = `
        SELECT p.player_name, SUM(pp.run_scored) AS total_runs
        FROM player_performance pp
        JOIN players p ON pp.player_id = p.id
        WHERE pp.match_name = ANY($1)
          AND (LOWER(TRIM(pp.team_name)) = LOWER($2) OR LOWER(TRIM(pp.team_name)) = LOWER($3))
          ${addType}
        GROUP BY p.player_name
        ORDER BY total_runs DESC
        LIMIT 1
      `;

      const bowlerQueryStr = `
        SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets, SUM(pp.runs_given) AS total_runs_given
        FROM player_performance pp
        JOIN players p ON pp.player_id = p.id
        WHERE pp.match_name = ANY($1)
          AND (LOWER(TRIM(pp.team_name)) = LOWER($2) OR LOWER(TRIM(pp.team_name)) = LOWER($3))
          ${addType}
        GROUP BY p.player_name
        ORDER BY total_wickets DESC, total_runs_given ASC
        LIMIT 1
      `;

      // Execute silently (ignore results for now)
      await Promise.allSettled([
        pool.query(scorerQueryStr, scorerParams),
        pool.query(bowlerQueryStr, bowlerParams),
      ]);
    } catch {
      // ignore optional analytics errors
    }

    return res.json({
      total_matches: total,
      [t1]: team1Wins,
      [t2]: team2Wins,
      draws,
      win_percentage_team1: winPct1,
      win_percentage_team2: winPct2,
    });
  } catch (error) {
    console.error("❌ Error in /api/h2h/summary:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/h2h/teams
 * Returns distinct team names from BOTH match_history and test_match_results
 */
router.get("/teams", async (_req, res) => {
  try {
    const q = `
      SELECT DISTINCT team FROM (
        SELECT LOWER(TRIM(team1)) AS team FROM match_history
        UNION ALL
        SELECT LOWER(TRIM(team2)) AS team FROM match_history
        UNION ALL
        SELECT LOWER(TRIM(team1)) AS team FROM test_match_results
        UNION ALL
        SELECT LOWER(TRIM(team2)) AS team FROM test_match_results
      ) AS all_teams
      WHERE team IS NOT NULL AND team <> ''
      ORDER BY team
    `;
    const result = await pool.query(q);
    // Title-case for display (keeps internal matching using LOWER/TRIM in queries)
    const teamList = [...new Set(result.rows.map((r) => titleCase(r.team)))];
    return res.json(teamList);
  } catch (error) {
    console.error("❌ Error in /api/h2h/teams:", error);
    return res.status(500).json({ error: "Failed to fetch team names" });
  }
});

module.exports = router;
