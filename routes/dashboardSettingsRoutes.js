// routes/dashboardSettingsRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET settings for the logged-in user
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    const result = await pool.query(
      "SELECT * FROM user_dashboard_settings WHERE user_id = $1 LIMIT 1",
      [userId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: "Failed to load dashboard settings" });
  }
});

// UPDATE or CREATE settings for the logged-in user
router.post("/", async (req, res) => {
  try {
    const { userId, theme_preference, receive_notifications, show_favorites_first, default_dashboard_tab } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Check if settings already exist
    const existing = await pool.query(
      "SELECT id FROM user_dashboard_settings WHERE user_id = $1",
      [userId]
    );
    let result;
    if (existing.rowCount > 0) {
      // Update
      result = await pool.query(
        `UPDATE user_dashboard_settings 
         SET theme_preference = $2,
             receive_notifications = $3,
             show_favorites_first = $4,
             default_dashboard_tab = $5,
             updated_at = NOW()
         WHERE user_id = $1
         RETURNING *`,
        [userId, theme_preference, receive_notifications, show_favorites_first, default_dashboard_tab]
      );
    } else {
      // Insert
      result = await pool.query(
        `INSERT INTO user_dashboard_settings 
         (user_id, theme_preference, receive_notifications, show_favorites_first, default_dashboard_tab)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, theme_preference, receive_notifications, show_favorites_first, default_dashboard_tab]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to update dashboard settings" });
  }
});

module.exports = router;
