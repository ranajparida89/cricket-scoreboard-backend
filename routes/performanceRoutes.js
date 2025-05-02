// ✅ src/routes/playerRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Add Advanced Player Performance API (Updated with Ball Faced column)
router.post("/player-performance", async (req, res) => {
  const {
    player_id,
    team_name,
    match_type,
    against_team,
    run_scored,
    ball_faced,       // ⬅️ NEW FIELD added 02-May-2025
    wickets_taken,
    runs_given,
    fifties,
    hundreds
  } = req.body;

  try {
    // ✅ Validate Input Mandatory Fields
    if (!player_id || !team_name || !match_type || !against_team) {
      return res.status(400).json({ message: "⚠️ Missing required fields." });
    }

    // ✅ Check if Player Exists
    const playerCheck = await pool.query(
      `SELECT * FROM players WHERE id = $1`,
      [player_id]
    );
    if (playerCheck.rows.length === 0) {
      return res.status(404).json({ message: "❌ Player not found." });
    }

    // ✅ Insert New Player Performance Entry (including ball_faced)
    const insertResult = await pool.query(
      `INSERT INTO player_performance
      (player_id, team_name, match_type, against_team, run_scored, ball_faced, wickets_taken, runs_given, fifties, hundreds)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        player_id,
        team_name,
        match_type,
        against_team,
        run_scored,
        ball_faced,    // ⬅️ Pass ball_faced value to DB
        wickets_taken,
        runs_given,
        fifties,
        hundreds
      ]
    );

    res.status(201).json({
      message: "✅ Player performance saved successfully.",
      data: insertResult.rows[0] // Returning inserted performance
    });

  } catch (err) {
    console.error("❌ Server error while saving performance:", err);
    res.status(500).json({ message: "❌ Server error occurred." });
  }
});

module.exports = router;
