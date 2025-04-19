// ✅ routes/authRoutes.js
// ✅ [Ranaj Parida - 2025-04-22] Full Authentication Route: Signup, OTP, Login, Reset Password

const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

// ✅ Mail Transporter (Use your SMTP or testing account)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ✅ Helper: Generate OTP
const generateOtp = () => Math.floor(100000 + Math.random() * 900000);

// ✅ Route: Create New User (Signup)
router.post("/signup", async (req, res) => {
  const { first_name, last_name, email, password } = req.body;

  try {
    const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userCheck.rows.length > 0) return res.status(400).json({ error: "Email already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4)",
      [first_name, last_name, email, hashedPassword]
    );

    const otp = generateOtp();
const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

            await pool.query(
                "INSERT INTO email_otps (email, otp, expires_at) VALUES ($1, $2, $3)",
                    [email, otp, expiresAt]
                );


    await transporter.sendMail({
      to: email,
      subject: "Your CrickEdge OTP",
      html: `<h3>CrickEdge Verification</h3><p>Your OTP is <b>${otp}</b>. Valid for 5 mins.</p>`
    });

    res.json({ message: "User created. OTP sent to email." });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Route: Verify OTP
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    const result = await pool.query("SELECT * FROM email_otps WHERE email = $1 ORDER BY created_at DESC LIMIT 1", [email]);
    if (result.rows.length === 0 || result.rows[0].otp !== otp) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }
    res.json({ message: "OTP verified. Happy Cricket!" });
  } catch (err) {
    console.error("OTP verification error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Route: Resend OTP
router.post("/resend-otp", async (req, res) => {
  const { email } = req.body;
  try {
    const otp = generateOtp();
    await pool.query("INSERT INTO email_otps (email, otp) VALUES ($1, $2)", [email, otp]);

    await transporter.sendMail({
      to: email,
      subject: "CrickEdge OTP Resend",
      html: `<h3>OTP Resend</h3><p>Your new OTP is <b>${otp}</b></p>`
    });

    res.json({ message: "OTP resent to email." });
  } catch (err) {
    console.error("Resend OTP error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Route: Sign In
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const userRes = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = userRes.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ user_id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1d" });
    res.json({ message: "Login successful", token, user });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Route: Reset Password Request
router.post("/request-reset", async (req, res) => {
  const { email } = req.body;
  const token = crypto.randomBytes(20).toString("hex");

  try {
    await pool.query("INSERT INTO password_resets (email, token) VALUES ($1, $2)", [email, token]);

    const resetLink = `https://crickedge.in/reset-password?token=${token}`;
    await transporter.sendMail({
      to: email,
      subject: "CrickEdge Password Reset",
      html: `<p>Click to reset: <a href='${resetLink}'>Reset Password</a></p>`
    });

    res.json({ message: "Reset link sent." });
  } catch (err) {
    console.error("Reset request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Route: Complete Password Reset
router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const tokenCheck = await pool.query("SELECT email FROM password_resets WHERE token = $1", [token]);
    const email = tokenCheck.rows[0]?.email;
    if (!email) return res.status(400).json({ error: "Invalid or expired reset token" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password = $1 WHERE email = $2", [hashed, email]);

    res.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("Password reset error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
