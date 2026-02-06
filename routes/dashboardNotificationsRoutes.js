// routes/dashboardNotificationsRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET all notifications for a user (newest first)
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    const result = await pool.query(
      `SELECT * FROM  user_notificationsWHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// Mark notification as read
router.post("/read/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE user_notifications SET is_read = TRUE WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Notification not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to update notification" });
  }
});

// Optionally: Mark all as read for a user
router.post("/read-all", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    await pool.query(
      "UPDATE user_notifications SET is_read = TRUE WHERE user_id = $1",
      [userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark all as read" });
  }
});

// Add (send) a notification to a user (e.g., admin, system, or for future features)
router.post("/", async (req, res) => {
  try {
    const { userId, title, message, notification_type, link_url } = req.body;
    if (!userId || !title || !message) return res.status(400).json({ error: "Missing required fields" });
    const result = await pool.query(
      `INSERT INTO user_notifications (user_id, title, message, notification_type, link_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, title, message, notification_type || 'general', link_url || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to create notification" });
  }
});

module.exports = router;
