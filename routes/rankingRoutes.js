// ✅ routes/rankingRoutes.js
// ✅ [Ranaj Parida - 27 May 2025] Aggregates Test stats from test_match_results using correct columns

const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/team-rankings", async (req, res) => {
  try {
    // Ranaj Parida 27 May 2025: Test chart from test_match_results with correct columns!
    const result = await pool.query(`
      -- ODI/T20 from regular tables
      SELECT 
        t.name AS team_name,
        SUM(t.matches_played) AS matches,
        SUM(t.points) AS points,
        ROUND(SUM(t.points)::decimal / NULLIF(SUM(t.matches_played),0), 2) AS rating,
        ROUND(
          (SUM(t.total_runs)::decimal / NULLIF(SUM(t.total_overs),0)) -
          (SUM(t.total_runs_conceded)::decimal / NULLIF(SUM(t.total_overs_bowled),0)), 2
        ) AS nrr,
        m.match_type
      FROM teams t
      JOIN matches m ON m.id = t.match_id
      WHERE m.match_type IN ('ODI', 'T20')
      GROUP BY m.match_type, t.name

      UNION ALL

      -- Test stats from test_match_results, correct columns
      SELECT 
        team AS team_name,
        COUNT(*) AS matches,
        SUM(points) AS points,
        ROUND(SUM(points)::decimal / NULLIF(COUNT(*), 0), 2) AS rating,
        ROUND(
          (SUM(runs_scored)::decimal / NULLIF(SUM(overs_used), 0)) -
          (SUM(runs_conceded)::decimal / NULLIF(SUM(overs_bowled), 0)),
          2
        ) AS nrr,
        'Test' AS match_type
      FROM (
        -- team1 as main team, team2 as opponent
        SELECT
          team1 AS team,
          points,
          runs1 + runs1_2 AS runs_scored,
          overs1 + overs1_2 AS overs_used,
          runs2 + runs2_2 AS runs_conceded,
          overs2 + overs2_2 AS overs_bowled
        FROM test_match_results
        UNION ALL
        -- team2 as main team, team1 as opponent
        SELECT
          team2 AS team,
          points,
          runs2 + runs2_2 AS runs_scored,
          overs2 + overs2_2 AS overs_used,
          runs1 + runs1_2 AS runs_conceded,
          overs1 + overs1_2 AS overs_bowled
        FROM test_match_results
      ) AS exploded
      GROUP BY team
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching team rankings:", err.message);
    res.status(500).json({ error: "Failed to fetch team rankings" });
  }
});

module.exports = router;
