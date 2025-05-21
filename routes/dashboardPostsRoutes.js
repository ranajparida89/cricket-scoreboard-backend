// routes/dashboardPostsRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // update path if needed

// GET: List all posts (matches) created by the user
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Fetch matches created/submitted by this user
    // This assumes your match_history table has a user_id column!
    const result = await pool.query(`
      SELECT
        id,            -- match id
        match_name,    -- match/tournament title
        match_type,
        team1, team2,
        match_time,
        winner
      FROM match_history
      WHERE user_id = $1
      ORDER BY match_time DESC
      LIMIT 20
    `, [userId]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user's match posts", details: err.message });
  }
});

module.exports = router;
