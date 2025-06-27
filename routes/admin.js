// routes/admin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');

// Add a debug log when file loads
console.log("[ADMIN] admin.js loaded and route file imported.");

// Simple GET to verify route is mounted
router.get('/test', (req, res) => {
  console.log("[ADMIN] GET /api/admin/test called");
  res.json({ ok: true, msg: "Admin test endpoint hit" });
});

/**
 * POST /api/admin/login
 */
router.post('/login', async (req, res) => {
  console.log("[ADMIN] POST /api/admin/login called"); // Debug log on handler call

  const { username, password } = req.body;
  // More logging
  console.log("[ADMIN] Received payload:", { username, password: password ? '****' : undefined });

  // Basic validation
  if (!username || !password) {
    console.log("[ADMIN] Missing username or password.");
    return res.status(400).json({ error: "Username/email and password are required." });
  }

  try {
    // Query for admin user
    const result = await pool.query(
      `SELECT * FROM admins WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1`,
      [username]
    );
    const admin = result.rows[0];
    if (!admin) {
      console.log("[ADMIN] Admin not found for username:", username);
      return res.status(401).json({ error: "Invalid username/email or password." });
    }

    // Password check
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      console.log("[ADMIN] Invalid password for user:", username);
      return res.status(401).json({ error: "Invalid username/email or password." });
    }

    // (Optional) Log login
    try {
      await pool.query(
        `INSERT INTO admin_audit_log (admin_id, action, action_detail, ip_address, user_agent)
         VALUES ($1, 'login', 'Successful admin login', $2, $3)`,
        [admin.id, req.ip, req.get('user-agent')]
      );
      console.log("[ADMIN] Login audit log recorded for user:", username);
    } catch (e) {
      console.warn("[ADMIN] Admin audit log failed:", e);
    }

    // Success
    console.log("[ADMIN] Login success for user:", username);
    res.json({
      isAdmin: true,
      admin: {
        id: admin.id,
        username: admin.username,
        full_name: admin.full_name,
        email: admin.email,
        is_super_admin: admin.is_super_admin,
      },
    });
  } catch (err) {
    console.error("[ADMIN] Admin login error:", err);
    res.status(500).json({ error: "Server error during admin login." });
  }
});

module.exports = router;
