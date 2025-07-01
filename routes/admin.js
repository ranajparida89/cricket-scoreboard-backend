// routes/admin.js
const express = require('express');
const router = express.Router();
const pool = require('../db'); // Postgres connection

// --- Debug logging for every load
console.log("[ADMIN] admin.js loaded and route file imported.");

// Test endpoint to verify router is active
router.get('/test', (req, res) => {
  console.log("[ADMIN] /test endpoint hit!");
  res.json({ status: "ok" });
});

// --- GET /api/admin/list ---
// Returns all admins (safe fields only) 01-JUNE-2025 RANAJ PARIDA
router.get('/list', async (req, res) => {
  try {
    // TODO: Add authentication middleware (for now, allow all for dev)
    const result = await pool.query(
      `SELECT id, username, email, full_name, is_super_admin, created_at FROM admins ORDER BY id`
    );
    res.json({ admins: result.rows });
  } catch (err) {
    console.error("[ADMIN][GET] /api/admin/list error:", err);
    res.status(500).json({ error: "Failed to fetch admins." });
  }
});

// --- POST /api/admin/create --- 
// Creates a new admin. Only super_admins should be allowed (for now, no auth middleware).
// 01-JUNE-2025 RANAJ PARIDA
router.post('/create', async (req, res) => {
  console.log("[ADMIN][POST] /api/admin/create called. Body:", req.body);

  const { username, email, password, full_name, is_super_admin } = req.body;

  // 1. Basic input validation
  if (
    !username || !email || !password || !full_name ||
    typeof username !== "string" || typeof email !== "string" ||
    typeof password !== "string" || typeof full_name !== "string" ||
    username.trim() === "" || email.trim() === "" ||
    password.trim() === "" || full_name.trim() === ""
  ) {
    console.log("[ADMIN][POST] Missing or invalid fields for create admin");
    return res.status(400).json({ error: "All fields are required (username, email, password, full_name)" });
  }

  // 2. Check if admin with same username/email exists
  try {
    const exists = await pool.query(
      `SELECT id FROM admins WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2) LIMIT 1`,
      [username.trim(), email.trim()]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: "Admin with same username or email already exists" });
    }

    // 3. Create the admin (plain password for now, see phase 2C for hashing)
    const result = await pool.query(
      `INSERT INTO admins (username, email, password_hash, full_name, is_super_admin, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id, username, email, full_name, is_super_admin, created_at`,
      [
        username.trim(),
        email.trim(),
        password.trim(),
        full_name.trim(),
        !!is_super_admin // force boolean
      ]
    );

    console.log("[ADMIN][POST] Admin created:", result.rows[0]);

    res.json({
      success: true,
      admin: result.rows[0]
    });
  } catch (err) {
    console.error("[ADMIN][POST] Admin create error:", err);
    res.status(500).json({ error: "Server error during admin creation." });
  }
});

/**
 * DELETE /api/admin/delete/:id
 * Deletes an admin by ID (Only super_admins, skip middleware for now)
 * 01-JULY-2025 RANAJ PARIDA
 */
router.delete('/delete/:id', async (req, res) => {
  const adminId = parseInt(req.params.id, 10);

  // Basic validation
  if (isNaN(adminId) || adminId <= 0) {
    return res.status(400).json({ error: "Invalid admin ID." });
  }

  try {
    // 1. Check if admin exists
    const result = await pool.query(
      'SELECT * FROM admins WHERE id = $1',
      [adminId]
    );
    const admin = result.rows[0];

    if (!admin) {
      return res.status(404).json({ error: "Admin not found." });
    }

    // 2. Prevent deleting last super admin
    if (admin.is_super_admin) {
      const superAdminCountResult = await pool.query(
        'SELECT COUNT(*) FROM admins WHERE is_super_admin = true'
      );
      if (parseInt(superAdminCountResult.rows[0].count, 10) === 1) {
        return res.status(400).json({ error: "Cannot delete the last super admin." });
      }
    }

    // 3. Prevent self-delete (for now, pass user id via body)
    // In production, get the current admin's id from session/JWT
    if (req.body.current_admin_id && parseInt(req.body.current_admin_id, 10) === adminId) {
      return res.status(400).json({ error: "You cannot delete yourself." });
    }

    // 4. Actually delete the admin
    await pool.query('DELETE FROM admins WHERE id = $1', [adminId]);
    res.json({ success: true, deleted_admin_id: adminId });
  } catch (err) {
    console.error("[ADMIN][DELETE] Error deleting admin:", err);
    res.status(500).json({ error: "Server error during admin delete." });
  }
});


/**
 * POST /api/admin/login
 * Allows admin login with username OR email
 * Uses plain text password comparison (NO HASHING)
 */
router.post('/login', async (req, res) => {
  console.log("[ADMIN][POST] /api/admin/login called. Body:", req.body);

  const { username, password } = req.body;

  // 1. Basic input validation
  if (
    !username ||
    !password ||
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.trim() === "" ||
    password.trim() === ""
  ) {
    console.log("[ADMIN][POST] Missing or invalid username or password");
    return res.status(400).json({ error: "Username/email and password are required." });
  }

  try {
    // 2. Find admin by username or email (case-insensitive)
    const result = await pool.query(
      `SELECT * FROM admins WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1`,
      [username.trim()]
    );
    const admin = result.rows[0];
    if (!admin) {
      console.log("[ADMIN][POST] Invalid username/email.");
      return res.status(401).json({ error: "Invalid username/email or password." });
    }

    // 3. Directly compare plain text password
    if (password !== admin.password_hash) {
      // Note: Still called password_hash in DB for compatibility, but is plain text!
      console.log("[ADMIN][POST] Password did not match for", username);
      return res.status(401).json({ error: "Invalid username/email or password." });
    }

    // 4. Log successful login
    try {
      await pool.query(
        `INSERT INTO admin_audit_log (admin_id, action, action_detail, ip_address, user_agent)
         VALUES ($1, 'login', 'Successful admin login', $2, $3)`,
        [admin.id, req.ip, req.get('user-agent')]
      );
      console.log("[ADMIN][POST] Login audit log inserted.");
    } catch (e) {
      console.warn('[ADMIN][POST] Admin audit log failed:', e);
    }

    // 5. Respond success
    res.json({
      isAdmin: true,
      admin: {
        id: admin.id,
        username: admin.username,
        full_name: admin.full_name,
        email: admin.email,
        is_super_admin: admin.is_super_admin,
      }
    });
    console.log("[ADMIN][POST] Login successful for", username);
  } catch (err) {
    console.error("[ADMIN][POST] Admin login error:", err);
    res.status(500).json({ error: "Server error during admin login." });
  }
});

console.log("[ADMIN] admin.js routes loaded.");
module.exports = router;
