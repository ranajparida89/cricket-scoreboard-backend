// ✅ routes/rankingRoutes.js
// ✅ [Ranaj Parida - 27 May 2025] User-specific team rankings for all match types

const express = require("express");
const router = express.Router();
const pool = require("../db");

/**
 * GET /api/team-rankings?user_id=...
 * Returns user-only team rankings for ODI, T20, and Test
 */
router.get("/team-rankings", async (req, res) => {
  try {
    const user_id = req.query.user_id;
    if (!user_id) return res.status(400).json({ error: "Missing user_id in query params." });

    // -- ODI/T20 RANKINGS: Aggregate only current user's teams/matches
    // -- Test RANKINGS: Aggregate only test matches posted by current user

    const result = await pool.query(`
      -- ODI/T20 from user's teams/matches
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
        AND t.user_id = $1        -- ✅ Only this user's teams!
      GROUP BY m.match_type, t.name

      UNION ALL

      -- Test stats from test_match_results, only current user!
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
        WHERE user_id = $1      -- ✅ Only this user's matches!
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
        WHERE user_id = $1      -- ✅ Only this user's matches!
      ) AS exploded
      GROUP BY team
    `, [user_id]);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching team rankings:", err.message);
    res.status(500).json({ error: "Failed to fetch team rankings" });
  }
});

module.exports = router;
