// routes/admin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs'); // added and installed..
const pool = require('../db'); // your Postgres connection

/**
 * POST /api/admin/login
 * Allows admin login with username OR email
 * Expects: { username, password }
 * Returns: { isAdmin: true } or error message
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // 1. Basic validation
  if (!username || !password) {
    return res.status(400).json({ error: "Username/email and password are required." });
  }

  try {
    // 2. Find admin by username or email (case-insensitive)
    const result = await pool.query(
      `SELECT * FROM admins WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1`,
      [username]
    );
    const admin = result.rows[0];
    if (!admin) {
      // Do not leak user existence info
      return res.status(401).json({ error: "Invalid username/email or password." });
    }

    // 3. Check password using bcrypt
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid username/email or password." });
    }

    // 4. (OPTIONAL) Log successful login to admin_audit_log table
    try {
      await pool.query(
        `INSERT INTO admin_audit_log (admin_id, action, action_detail, ip_address, user_agent)
         VALUES ($1, 'login', 'Successful admin login', $2, $3)`,
        [admin.id, req.ip, req.get('user-agent')]
      );
    } catch (e) {
      // Do not block login if log fails; just warn
      console.warn('Admin audit log failed:', e);
    }

    // 5. Respond
    // You may want to issue a session/JWT here instead!
    res.json({
      isAdmin: true,
      admin: {
        id: admin.id,
        username: admin.username,
        full_name: admin.full_name,
        email: admin.email,
        is_super_admin: admin.is_super_admin,
      },
      // token: "TODO: Issue JWT here for full security"
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Server error during admin login." });
  }
});

module.exports = router;
