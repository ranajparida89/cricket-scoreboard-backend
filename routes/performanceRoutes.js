// ✅ src/routes/playerRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Add Advanced Player Performance API
router.post("/player-performance", async (req, res) => {
  const {
    player_id,
    team_name,
    match_type,
    against_team,
    run_scored,
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

    // ✅ Check Player Exists
    const playerCheck = await pool.query(
      `SELECT * FROM players WHERE id = $1`,
      [player_id]
    );
    if (playerCheck.rows.length === 0) {
      return res.status(404).json({ message: "❌ Player not found." });
    }

    // ✅ Optional: Prevent Duplicate Insert (Same player, same match_type, same against_team)
    const duplicateCheck = await pool.query(
      `SELECT * FROM player_performance WHERE player_id = $1 AND match_type = $2 AND against_team = $3`,
      [player_id, match_type, against_team]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ message: "⚠️ Performance already recorded for this player in same match." });
    }

    // ✅ Insert into player_performance
    const insertResult = await pool.query(
      `INSERT INTO player_performance
      (player_id, team_name, match_type, against_team, run_scored, wickets_taken, runs_given, fifties, hundreds)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        player_id,
        team_name,
        match_type,
        against_team,
        run_scored,
        wickets_taken,
        runs_given,
        fifties,
        hundreds
      ]
    );

    res.status(201).json({
      message: "✅ Player performance saved successfully.",
      data: insertResult.rows[0] // returning inserted performance
    });

  } catch (err) {
    console.error("❌ Server error while saving performance:", err);
    res.status(500).json({ message: "❌ Server error occurred." });
  }
});

module.exports = router;
