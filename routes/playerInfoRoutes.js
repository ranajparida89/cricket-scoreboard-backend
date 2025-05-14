const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ 1. GET all player names (distinct, sorted, ready for dropdown)
router.get("/list", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT player_name
      FROM players
      ORDER BY player_name ASC
    `);
    const names = result.rows.map((row) => row.player_name);
    res.json(names);
  } catch (error) {
    console.error("Error in /players/list:", error);
    res.status(500).json({ error: "Unable to fetch players" });
  }
});

// ✅ 2. GET player comparison with stats: /compare?player1=A&player2=B
router.get("/compare", async (req, res) => {
  const { player1, player2 } = req.query;

  if (!player1 || !player2 || player1.toLowerCase() === player2.toLowerCase()) {
    return res.status(400).json({ error: "Please provide two different player names" });
  }

  try {
    const players = [player1, player2];

    // Use parameterized query to avoid SQL injection
    const result = await pool.query(`
      SELECT 
        player_name,
        SUM(runs) AS total_runs,
        SUM(CASE WHEN runs >= 100 THEN 1 ELSE 0 END) AS centuries,
        SUM(CASE WHEN runs >= 50 AND runs < 100 THEN 1 ELSE 0 END) AS half_centuries,
        ROUND(AVG(runs::numeric), 2) AS batting_avg,
        MAX(runs) AS highest_score,
        SUM(wickets) AS total_wickets,
        ROUND(AVG(wickets::numeric), 2) AS bowling_avg
      FROM player_performance
      WHERE LOWER(player_name) = LOWER($1) OR LOWER(player_name) = LOWER($2)
      GROUP BY player_name
    `, players);

    const formatted = result.rows.reduce((acc, row) => {
      acc[row.player_name] = {
        runs: Number(row.total_runs || 0),
        centuries: Number(row.centuries || 0),
        fifties: Number(row.half_centuries || 0),
        batting_avg: parseFloat(row.batting_avg || 0).toFixed(2),
        highest: Number(row.highest_score || 0),
        wickets: Number(row.total_wickets || 0),
        bowling_avg: parseFloat(row.bowling_avg || 0).toFixed(2),
      };
      return acc;
    }, {});

    res.json({
      players: formatted,
    });
  } catch (error) {
    console.error("Error in /players/compare:", error);
    res.status(500).json({ error: "Unable to compare players" });
  }
});

module.exports = router;
