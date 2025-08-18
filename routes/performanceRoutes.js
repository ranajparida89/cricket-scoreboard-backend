// ✅ src/routes/playerRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Add Advanced Player Performance API (Updated with Match Name & Ball Faced)
router.post("/player-performance", async (req, res) => {
  const {
    match_name,       // ✅ NEW FIELD moved to top - 09-May-2025
    player_id,
    team_name,
    match_type,
    against_team,
    run_scored,
    balls_faced,      // ✅ Previously added
    wickets_taken,
    runs_given,
    fifties,
    hundreds
  } = req.body;

  try {
    // ✅ Validate Input Mandatory Fields
    if (!match_name || !player_id || !team_name || !match_type || !against_team) {
      return res.status(400).json({ message: "⚠️ Missing required fields." });
    }

    // ✅ Check if Player Exists
    const playerCheck = await pool.query(
      "SELECT * FROM players WHERE id = $1",
      [player_id]
    );

    if (playerCheck.rows.length === 0) {
      return res.status(404).json({ message: "❌ Player not found." });
    }

    // ✅ Insert New Player Performance Entry (match_name first in values)
    const insertResult = await pool.query(
      `INSERT INTO player_performance 
      (match_name, player_id, team_name, match_type, against_team, 
       run_scored, balls_faced, wickets_taken, runs_given, fifties, hundreds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        match_name,     // ✅ match_name first in values
        player_id,
        team_name,
        match_type,
        against_team,
        run_scored,
        balls_faced,
        wickets_taken,
        runs_given,
        fifties,
        hundreds
      ]
    );

    res.status(201).json({
      message: "✅ Player performance saved successfully.",
      data: insertResult.rows[0]
    });

  } catch (err) {
    console.error("❌ Server error while saving performance:", err);
    res.status(500).json({ message: "❌ Server error occurred." });
  }
});

// ✅ GET all player performance records (for Player Performance Stats Table)
router.get("/player-performance", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pp.id,
        pp.match_name,              -- ✅ Include match name for UI
        p.player_name,
        pp.team_name,
        pp.match_type,
        pp.against_team,
        pp.run_scored,
        pp.balls_faced,
        pp.wickets_taken,
        pp.runs_given,
        pp.fifties,
        pp.hundreds
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      ORDER BY pp.id DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching performance stats:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
