// routes/dashboardWidgetsRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/dashboard/widgets?userId=...
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Example widgets: Next upcoming match, your latest prediction, accuracy, total posts
    // You can expand this logic as needed
    const [{ rows: [nextMatch] }, { rows: [lastPrediction] }, { rows: [accuracy] }, { rows: [postCount] }] = await Promise.all([
      pool.query(
        `SELECT 
  um.match_name, 
  um.match_date, 
  t1.name AS team1_name, 
  t2.name AS team2_name
FROM upcoming_matches um
JOIN teams t1 ON um.team1_id = t1.id
JOIN teams t2 ON um.team2_id = t2.id
WHERE (
    um.team1_id = ANY (SELECT ref_id FROM user_favorites WHERE user_id = $1 AND type = 'team')
    OR um.team2_id = ANY (SELECT ref_id FROM user_favorites WHERE user_id = $1 AND type = 'team')
  )
  AND um.match_date > NOW()
ORDER BY um.match_date ASC 
LIMIT 1
`, [userId]
      ),
      pool.query(
        `SELECT prediction, is_correct, created_at FROM user_predictions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      ),
      pool.query(
        `SELECT 
            CASE WHEN COUNT(*) = 0 THEN 0 
            ELSE ROUND(AVG(CASE WHEN is_correct THEN 1 ELSE 0 END)::numeric * 100, 2) END AS accuracy
         FROM user_predictions WHERE user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total_posts FROM match_history WHERE user_id = $1`,
        [userId]
      ),
    ]);

    res.json({
      nextMatch: nextMatch || null,
      lastPrediction: lastPrediction || null,
      accuracy: accuracy?.accuracy || 0,
      totalPosts: postCount?.total_posts || 0
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load widgets" });
  }
});

module.exports = router;
