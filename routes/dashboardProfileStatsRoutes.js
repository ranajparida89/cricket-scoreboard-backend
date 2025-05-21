// routes/dashboardProfileStatsRoutes.js 
const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/dashboard/profile?userId=...
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Aggregate profile data
    const [{ rows: [matchStats] }, { rows: [favStats] }, { rows: [achStats] }, { rows: [activityStats] }] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS match_count FROM match_history WHERE user_id = $1`, [userId]),
      pool.query(`SELECT COUNT(*)::int AS favorite_count FROM user_favorites WHERE user_id = $1`, [userId]),
      pool.query(`SELECT COUNT(*)::int AS achievement_count FROM user_achievements WHERE user_id = $1`, [userId]),
      pool.query(`SELECT COUNT(*)::int AS activity_count FROM user_activity WHERE user_id = $1`, [userId])
    ]);

    res.json({
      match_count: matchStats?.match_count || 0,
      favorite_count: favStats?.favorite_count || 0,
      achievement_count: achStats?.achievement_count || 0,
      activity_count: activityStats?.activity_count || 0
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load profile stats" });
  }
});

module.exports = router;
