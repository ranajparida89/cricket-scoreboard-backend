const express = require("express");
const router = express.Router();
const pool = require("../db");


// ✅ 1. GET all player names (for dropdowns)
router.get("/list", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT player_name
      FROM players
      ORDER BY player_name ASC
    `);
    const names = result.rows.map(row => row.player_name);
    res.json(names); // return sorted player name list
  } catch (error) {
    console.error("Error in /players/list:", error);
    res.status(500).json({ error: "Unable to fetch players" });
  }
});


// ✅ 2. GET player comparison by player name (accurate via player_id)
router.get("/compare", async (req, res) => {
  const { player1, player2 } = req.query;

  // ❌ Validate query input
  if (!player1 || !player2 || player1.toLowerCase() === player2.toLowerCase()) {
    return res.status(400).json({ error: "Please select two different players" });
  }

  try {
    // ✅ Step 1: Get player IDs from 'players' table
    const idQuery = await pool.query(
      `SELECT id, player_name FROM players WHERE LOWER(player_name) = LOWER($1) OR LOWER(player_name) = LOWER($2)`,
      [player1, player2]
    );

    if (idQuery.rows.length < 2) {
      return res.status(404).json({ error: "One or both players not found in DB" });
    }

    const playerStats = {};

    // ✅ Step 2: Loop through each player and compute performance stats
    for (const row of idQuery.rows) {
      const playerId = row.id;
      const playerName = row.player_name;

      const statsQuery = await pool.query(`
       SELECT 
        SUM(run_scored) AS total_runs,
        SUM(CASE WHEN run_scored >= 100 THEN 1 ELSE 0 END) AS centuries,
        SUM(CASE WHEN run_scored >= 50 AND run_scored < 100 THEN 1 ELSE 0 END) AS fifties,
        ROUND(AVG(run_scored::numeric), 2) AS batting_avg,
        MAX(run_scored) AS highest_score,
        SUM(wickets_taken) AS total_wickets,
        ROUND(AVG(wickets_taken::numeric), 2) AS bowling_avg
        FROM player_performance
        WHERE player_id = $1
      `, [playerId]);

      const data = statsQuery.rows[0];

      // ✅ Step 3: Format results per player
      playerStats[playerName] = {
        runs: Number(data.total_runs || 0),
        centuries: Number(data.centuries || 0),
        fifties: Number(data.fifties || 0),
        batting_avg: parseFloat(data.batting_avg || 0).toFixed(2),
        highest: Number(data.highest_score || 0),
        wickets: Number(data.total_wickets || 0),
        bowling_avg: parseFloat(data.bowling_avg || 0).toFixed(2),
      };
    }

    // ✅ Step 4: Return comparison object
    res.json({
      players: playerStats
    });

  } catch (error) {
    console.error("Error in /players/compare:", error);
    res.status(500).json({ error: "Unable to compare players" });
  }
});

module.exports = router;
