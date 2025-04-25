// ✅ routes/rankingRoutes.js
// ✅ [Ranaj Parida - 2025-04-17] Team Rankings for Chart with NRR & Match Type

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Route: /api/team-rankings
router.get("/team-rankings", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.name AS team_name,
        SUM(t.matches_played) AS matches,
        SUM(t.points) AS points,
        ROUND(SUM(t.points)::decimal / NULLIF(SUM(t.matches_played), 0), 2) AS rating,
        ROUND(
          (SUM(t.total_runs)::decimal / NULLIF(SUM(t.total_overs), 0)) - 
          (SUM(t.total_runs_conceded)::decimal / NULLIF(SUM(t.total_overs_bowled), 0)), 2
        ) AS nrr,
        m.match_type
      FROM teams t
      JOIN matches m ON m.id = t.match_id
      GROUP BY m.match_type, t.name
      ORDER BY m.match_type, rating DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching team rankings:", err.message);
    res.status(500).json({ error: "Failed to fetch team rankings" });
  }
});

module.exports = router;
