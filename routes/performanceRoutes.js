const express = require("express");
const router = express.Router();
const pool = require("../db");

/**
 * ADD PLAYER PERFORMANCE
 * Only allows adding for user's own player (user_id required!)
 */
router.post("/player-performance", async (req, res) => {
  const {
    match_name,
    player_id,
    team_name,
    match_type,
    against_team,
    run_scored,
    balls_faced,
    wickets_taken,
    runs_given,
    fifties,
    hundreds,
    user_id // REQUIRED! -- Enforce everywhere
  } = req.body;

  try {
    // Validate all input fields
    if (!match_name || !player_id || !team_name || !match_type || !against_team || !user_id) {
      return res.status(400).json({ message: "⚠️ Missing required fields (must include user_id)." });
    }

    // Only allow if player belongs to this user
    const playerCheck = await pool.query(
      "SELECT * FROM players WHERE id = $1 AND user_id = $2",
      [player_id, user_id]
    );
    if (playerCheck.rows.length === 0) {
      return res.status(404).json({ message: "❌ Player not found or does not belong to current user." });
    }

    // Insert new performance record
    const insertResult = await pool.query(
      `INSERT INTO player_performance 
        (match_name, player_id, team_name, match_type, against_team, 
         run_scored, balls_faced, wickets_taken, runs_given, fifties, hundreds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        match_name,
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

/**
 * GET ALL PLAYER PERFORMANCE (Only for current user)
 * Returns all performance stats for all players belonging to this user only!
 * Usage: /api/player-performance?user_id=22
 */
router.get("/player-performance", async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: "User ID is required." });
    }
    const result = await pool.query(`
      SELECT 
        pp.id,
        pp.match_name,
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
      WHERE p.user_id = $1
      ORDER BY pp.id DESC
    `, [user_id]);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching performance stats:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
