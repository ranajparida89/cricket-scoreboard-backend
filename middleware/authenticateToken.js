// middleware/authenticateToken.js
// User authentication middleware (NOT admin)

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "your_super_secret_jwt_key_here";

module.exports = function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: "User not authenticated. Please login again.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // <-- IMPORTANT (forum uses req.user)
    next();
  } catch (err) {
    return res.status(401).json({
      error: "Invalid or expired token. Please login again.",
    });
  }
};
