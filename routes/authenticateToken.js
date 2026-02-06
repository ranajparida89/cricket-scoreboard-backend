const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Invalid token" });
    }

    // ✅ IMPORTANT: decoded.user_id is UUID
    req.user = {
      user_id: decoded.user_id,
      email: decoded.email
    };

    // 🔍 TEMP DEBUG (keep for now)
    console.log("AUTH DECODED:", req.user);

    next();
  });
};
