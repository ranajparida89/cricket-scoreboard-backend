// routes/dashboardWidgetsRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/dashboard/widgets?userId=...
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // 🔹 Use Promise.all for parallel queries
    const [
      { rows: [nextMatch] },
      { rows: [lastPrediction] },
      { rows: [accuracy] },
      { rows: [postCount] }
    ] = await Promise.all([
      // 🔹 Fetch user's most recent upcoming match from upcoming_match_details
      pool.query(
        `SELECT 
           match_name, 
           match_type, 
           location, 
           match_time, 
           match_date, 
           match_status, 
           team_playing
         FROM upcoming_match_details
         WHERE created_by = 'admin'
         ORDER BY match_date ASC -- show the nearest future match
         LIMIT 1`,
        [userId]
      ),
      // 🔹 Fetch user's latest prediction
      pool.query(
        `SELECT prediction, is_correct, created_at 
         FROM user_predictions 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT 1`,
        [userId]
      ),
      // 🔹 Calculate user's prediction accuracy
      pool.query(
        `SELECT 
            CASE WHEN COUNT(*) = 0 THEN 0 
            ELSE ROUND(AVG(CASE WHEN is_correct THEN 1 ELSE 0 END)::numeric * 100, 2) END AS accuracy
         FROM user_predictions 
         WHERE user_id = $1`,
        [userId]
      ),
      // 🔹 Count user's total posts
      pool.query(
        `SELECT COUNT(*)::int AS total_posts 
         FROM match_history 
         WHERE user_id = $1`,
        [userId]
      ),
    ]);

    // 🔹 Respond with all fetched data
    res.json({
      nextMatch: nextMatch || null,
      lastPrediction: lastPrediction || null,
      accuracy: accuracy?.accuracy || 0,
      totalPosts: postCount?.total_posts || 0
    });

  } catch (err) {
    console.error("Error in /api/dashboard/widgets:", err);
    res.status(500).json({ error: "Failed to load widgets" });
  }
});

module.exports = router;
