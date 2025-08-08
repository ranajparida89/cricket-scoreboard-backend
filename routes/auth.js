// middleware/auth.js
// 05-JULY-2025 RANAJ PARIDA -- JWT middleware for admin routes

const jwt = require("jsonwebtoken");

// Use same secret as in routes/admin.js
const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_jwt_key_here";

/**
 * NEW (non-blocking):
 * If an Authorization Bearer token exists, decode it and attach to req.admin.
 * Never rejects the request. Safe to use in front of routers with mixed public/private routes.
 */
function attachAdminIfPresent(req, _res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded; // e.g., { id, username, is_super_admin, ... }
  } catch (_err) {
    // ignore invalid/expired token here; this is a soft attach
  }
  next();
}

/**
 * EXISTING (unchanged):
 * Middleware to require valid JWT for admin-only routes.
 * Sets req.admin if successful; otherwise returns 401.
 */
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res
      .status(401)
      .json({ error: "Missing admin token (Authorization header required)" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded; // You now have req.admin.id, req.admin.is_super_admin, etc.
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

module.exports = { attachAdminIfPresent, requireAdminAuth };
