// ✅ routes/enhancedTeamStats.js
// ✅ [Ranaj Parida - 2025-04-13 | 12:55 PM]
// Provides team-level stats for tooltips and chart usage – joined with NRR from `teams`

const express = require("express");
const router = express.Router();
const pool = require("../db"); // ✅ Centralized DB connection

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        stats.team_name,
        stats.match_type,
        stats.total_matches,
        stats.wins,
        stats.losses,
        stats.recent_outcomes,
        COALESCE(t.nrr, 0) AS nrr
      FROM (
        SELECT
          team_name,
          match_type,
          COUNT(*) AS total_matches,
          SUM(CASE WHEN winner = team_name THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN winner != team_name AND winner IS NOT NULL THEN 1 ELSE 0 END) AS losses,
          ARRAY_AGG(
            CASE
              WHEN winner = team_name THEN 'W'
              WHEN winner IS NULL THEN 'D'
              ELSE 'L'
            END ORDER BY match_time DESC
          ) AS recent_outcomes
        FROM (
          SELECT team1 AS team_name, match_type, winner, match_time FROM match_history
          UNION ALL
          SELECT team2 AS team_name, match_type, winner, match_time FROM match_history
        ) AS combined
        GROUP BY team_name, match_type
      ) AS stats
      LEFT JOIN teams t
        ON LOWER(t.name) = LOWER(stats.team_name);
    `);

    // ✅ Attach last_3 outcomes to each row
    const data = result.rows.map((row) => ({
      ...row,
      last_3: row.recent_outcomes?.slice(0, 3) || [],
    }));

    res.json(data);
  } catch (err) {
    console.error("❌ Error in /enhanced-team-stats:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
