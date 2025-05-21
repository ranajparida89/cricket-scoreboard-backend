// routes/dashboardAchievementsRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // update if needed

// GET: All achievements for the user
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Example: Fetch all unlocked achievements for this user
    const result = await pool.query(`
	   SELECT
        a.id,
        a.label,
        a.icon,
        a.color,
        a.description,
        ua.awarded_at
      FROM user_achievements ua
      JOIN achievements a ON ua.id = a.id
     WHERE ua.user_id = $1
      ORDER BY ua.awarded_at DESC
    `, [userId]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch achievements", details: err.message });
  }
});

module.exports = router;
