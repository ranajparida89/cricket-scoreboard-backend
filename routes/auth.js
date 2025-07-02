// middleware/auth.js
// 05-JULY-2025 RANAJ PARIDA -- JWT middleware for admin routes

const jwt = require('jsonwebtoken');

// Use same secret as in routes/admin.js
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

/**
 * Middleware to require valid JWT for admin routes.
 * Sets req.admin if successful.
 */
function requireAdminAuth(req, res, next) {
  // Expect header: Authorization: Bearer <token>
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing admin token (Authorization header required)" });
  }

  try {
    // Verify and decode JWT
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded; // You now have req.admin.id, req.admin.is_super_admin, etc.
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

module.exports = { requireAdminAuth };
