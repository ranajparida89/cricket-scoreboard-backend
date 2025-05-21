// routes/dashboardActivityRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // adjust as needed

// Get recent activity for a user
router.get("/", async (req, res) => {
  try {
    const { userId, limit = 10 } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    const q = `
      SELECT id, activity_type, ref_id, message, created_at
      FROM user_activity
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await pool.query(q, [userId, limit]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

// (Optional: You may add POST for logging new activities from frontend or other services.)

module.exports = router;
