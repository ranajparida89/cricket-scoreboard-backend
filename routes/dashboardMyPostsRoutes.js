// routes/dashboardMyPostsRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // adjust path if needed

// GET /api/dashboard/myposts?userId=...
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Fetch recent matches posted by the user
    const result = await pool.query(
      `SELECT
        id,
        match_name,
        match_type,
        team1,
        team2,
        winner,
        match_time,
        created_at
      FROM match_history
      WHERE user_id = $1
      ORDER BY match_time DESC
      LIMIT 10`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch your match posts" });
  }
});

module.exports = router;
