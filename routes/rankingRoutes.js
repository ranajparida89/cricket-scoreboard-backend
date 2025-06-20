// ✅ routes/rankingRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/team-rankings", async (req, res) => {
  try {
    const result = await pool.query(`
      -- ODI/T20: Include NRR
      SELECT 
        t.name AS team_name,
        SUM(t.matches_played) AS matches,
        SUM(t.points) AS points,
        ROUND(SUM(t.points)::decimal / NULLIF(SUM(t.matches_played),0), 2) AS rating,
        ROUND(
          (SUM(t.total_runs)::decimal / NULLIF(SUM(t.total_overs),0)) -
          (SUM(t.total_runs_conceded)::decimal / NULLIF(SUM(t.total_overs_bowled),0)), 2
        ) AS nrr,
        m.match_type,
        NULL AS wins,
        NULL AS losses,
        NULL AS draws
      FROM teams t
      JOIN matches m ON m.id = t.match_id
      WHERE m.match_type IN ('ODI', 'T20')
      GROUP BY m.match_type, t.name

      UNION ALL

      -- Test: New logic, NO NRR, add win/loss/draw
      SELECT
        team,
        COUNT(*) AS matches,
        SUM(points) AS points,
        ROUND(SUM(points)::decimal / NULLIF(COUNT(*), 0), 2) AS rating,
        NULL AS nrr,
        'Test' AS match_type,
        SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN outcome = 'draw' THEN 1 ELSE 0 END) AS draws
      FROM (
        -- Team1's stats per match
        SELECT
          team1 AS team,
          CASE
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team1)) THEN 12
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team2)) THEN 6
            WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw') THEN 4
            ELSE 0
          END AS points,
          CASE
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team1)) THEN 'win'
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team2)) THEN 'loss'
            WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw') THEN 'draw'
            ELSE NULL
          END AS outcome
        FROM test_match_results

        UNION ALL

        -- Team2's stats per match
        SELECT
          team2 AS team,
          CASE
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team2)) THEN 12
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team1)) THEN 6
            WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw') THEN 4
            ELSE 0
          END AS points,
          CASE
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team2)) THEN 'win'
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team1)) THEN 'loss'
            WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw') THEN 'draw'
            ELSE NULL
          END AS outcome
        FROM test_match_results
      ) AS scored
      GROUP BY team
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching team rankings:", err.message);
    res.status(500).json({ error: "Failed to fetch team rankings" });
  }
});

module.exports = router;
