// routes/admin.js
// 05-JULY-2025 RANAJ PARIDA -- JWT authentication added

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Postgres connection

// JWT requirements
const jwt = require('jsonwebtoken');
const { requireAdminAuth } = require('./auth');

// --- Debug logging for every load
console.log("[ADMIN] admin.js loaded and route file imported.");

// --- JWT secret (store in env for production!)
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

// Test endpoint (no auth)
router.get('/test', (req, res) => {
  console.log("[ADMIN] /test endpoint hit!");
  res.json({ status: "ok" });
});

// --- GET /api/admin/list ---
// Returns all admins (safe fields only) 01-JUNE-2025 RANAJ PARIDA
router.get('/list', requireAdminAuth, async (req, res) => {
  try {
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
// Creates a new admin. Only super_admins allowed (checked in middleware)
router.post('/create', requireAdminAuth, async (req, res) => {
  // Only allow super admins
  if (!req.admin || !req.admin.is_super_admin) {
    return res.status(403).json({ error: "Only super admins can add new admins." });
  }

  const { username, email, password, full_name, is_super_admin } = req.body;
  if (
    !username || !email || !password || !full_name ||
    typeof username !== "string" || typeof email !== "string" ||
    typeof password !== "string" || typeof full_name !== "string" ||
    username.trim() === "" || email.trim() === "" ||
    password.trim() === "" || full_name.trim() === ""
  ) {
    return res.status(400).json({ error: "All fields are required (username, email, password, full_name)" });
  }

  try {
    const exists = await pool.query(
      `SELECT id FROM admins WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2) LIMIT 1`,
      [username.trim(), email.trim()]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: "Admin with same username or email already exists" });
    }

    const result = await pool.query(
      `INSERT INTO admins (username, email, password_hash, full_name, is_super_admin, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id, username, email, full_name, is_super_admin, created_at`,
      [
        username.trim(),
        email.trim(),
        password.trim(),
        full_name.trim(),
        !!is_super_admin
      ]
    );

    res.json({
      success: true,
      admin: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: "Server error during admin creation." });
  }
});

// --- DELETE /api/admin/delete/:id ---
// Only super_admins allowed
router.delete('/delete/:id', requireAdminAuth, async (req, res) => {
  if (!req.admin || !req.admin.is_super_admin) {
    return res.status(403).json({ error: "Only super admins can delete admins." });
  }
  const adminId = parseInt(req.params.id, 10);
  if (isNaN(adminId) || adminId <= 0) {
    return res.status(400).json({ error: "Invalid admin ID." });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM admins WHERE id = $1',
      [adminId]
    );
    const admin = result.rows[0];
    if (!admin) {
      return res.status(404).json({ error: "Admin not found." });
    }
    // Prevent deleting last super admin
    if (admin.is_super_admin) {
      const superAdminCountResult = await pool.query(
        'SELECT COUNT(*) FROM admins WHERE is_super_admin = true'
      );
      if (parseInt(superAdminCountResult.rows[0].count, 10) === 1) {
        return res.status(400).json({ error: "Cannot delete the last super admin." });
      }
    }
    // Prevent self-delete
    if (req.admin && req.admin.id === adminId) {
      return res.status(400).json({ error: "You cannot delete yourself." });
    }

    await pool.query('DELETE FROM admins WHERE id = $1', [adminId]);
    res.json({ success: true, deleted_admin_id: adminId });
  } catch (err) {
    res.status(500).json({ error: "Server error during admin delete." });
  }
});

// --- PUT /api/admin/update/:id ---
// Only super_admins allowed
router.put('/update/:id', requireAdminAuth, async (req, res) => {
  if (!req.admin || !req.admin.is_super_admin) {
    return res.status(403).json({ error: "Only super admins can update admins." });
  }
  const adminId = parseInt(req.params.id, 10);
  const { username, email, password, full_name, is_super_admin } = req.body;
  if (
    !username || !email || !password || !full_name ||
    typeof username !== "string" || typeof email !== "string" ||
    typeof password !== "string" || typeof full_name !== "string" ||
    username.trim() === "" || email.trim() === "" || password.trim() === "" || full_name.trim() === ""
  ) {
    return res.status(400).json({ error: "All fields are required (username, email, password, full_name)" });
  }
  if (isNaN(adminId) || adminId <= 0) {
    return res.status(400).json({ error: "Invalid admin ID" });
  }

  try {
    const exists = await pool.query(
      `SELECT id FROM admins WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)) AND id <> $3`,
      [username.trim(), email.trim(), adminId]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: "Username or email already in use by another admin." });
    }

    const result = await pool.query(
      `UPDATE admins SET
        username = $1,
        email = $2,
        password_hash = $3,
        full_name = $4,
        is_super_admin = $5
      WHERE id = $6
      RETURNING id, username, email, full_name, is_super_admin, created_at`,
      [
        username.trim(),
        email.trim(),
        password.trim(),
        full_name.trim(),
        !!is_super_admin,
        adminId
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Admin not found." });
    }
    res.json({ success: true, admin: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Server error during admin update." });
  }
});

/**
 * POST /api/admin/login
 * Allows admin login with username OR email
 * Now issues JWT on successful login!
 */
router.post('/login', async (req, res) => {
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
      return res.status(401).json({ error: "Invalid username/email or password." });
    }

    // 3. Directly compare plain text password
    if (password !== admin.password_hash) {
      return res.status(401).json({ error: "Invalid username/email or password." });
    }

    // 4. Log successful login
    try {
      await pool.query(
        `INSERT INTO admin_audit_log (admin_id, action, action_detail, ip_address, user_agent)
         VALUES ($1, 'login', 'Successful admin login', $2, $3)`,
        [admin.id, req.ip, req.get('user-agent')]
      );
    } catch (e) {
      console.warn('[ADMIN][POST] Admin audit log failed:', e);
    }

    // 5. Generate JWT and respond
    const token = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        is_super_admin: admin.is_super_admin,
        email: admin.email,
      },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      isAdmin: true,
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        full_name: admin.full_name,
        email: admin.email,
        is_super_admin: admin.is_super_admin,
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Server error during admin login." });
  }
});

console.log("[ADMIN] admin.js routes loaded.");

// 🆕 POST /api/admin/add-team
// Adds new team (Admin Only)
router.post('/add-team', requireAdminAuth, async (req, res) => {
  const { team_name } = req.body;

  if (!team_name || typeof team_name !== "string" || team_name.trim().length < 3) {
    return res.status(400).json({
      success: false,
      error: "Team name must be at least 3 characters."
    });
  }

  const cleanName = team_name.trim().replace(/\s+/g, " ");

  try {
    // Check duplicate (case-insensitive)
    const existing = await pool.query(
      "SELECT 1 FROM teams WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [cleanName]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Team already exists."
      });
    }

    // Insert new team with zero stats
    await pool.query(
      `INSERT INTO teams
       (match_id, name, matches_played, wins, losses, points,
        total_runs, total_overs, total_runs_conceded, total_overs_bowled)
       VALUES
       (NULL, $1, 0, 0, 0, 0, 0, 0, 0, 0)`,
      [cleanName]
    );

    res.json({ success: true, message: "Team added successfully." });

  } catch (err) {
    console.error("Add team error:", err);
    res.status(500).json({
      success: false,
      error: "Server error."
    });
  }
});

module.exports = router;
