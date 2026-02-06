// routes/notificationRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("./authenticateToken");

/**
 * GET user notifications
 * GET /api/notifications
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const result = await pool.query(
      `
      SELECT 
        n.id,
        n.type,
        n.message,
        n.post_id,
        n.is_read,
        n.created_at,
        u.first_name,
        u.last_name,
        u.email AS actor_email
      FROM notifications n
      JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT 20
      `,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch notifications error:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

/**
 * MARK notification as read
 * PUT /api/notifications/:id/read
 */
router.put("/:id/read", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.user_id;

    await pool.query(
      `
      UPDATE notifications
      SET is_read = true
      WHERE id = $1 AND user_id = $2
      `,
      [id, userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Mark notification read error:", err);
    res.status(500).json({ error: "Failed to update notification" });
  }
});

module.exports = router;
