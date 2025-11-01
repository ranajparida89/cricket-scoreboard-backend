// C:\cricket-scoreboard-backend\routes\pitchRandomizerRoutes.js
// [Ranaj Parida - Pitch Randomizer logging API]

const express = require("express");
const router = express.Router();

// ⬅️ adjust this line if your pool is in a different file
const pool = require("../db"); // <- the same pool you use in other routes

// POST /api/tools/pitch-randomizer/log
// Save one generated pitch
router.post("/log", async (req, res) => {
  const {
    match_type,
    user_name,
    match_name,
    pitch_type,
    pitch_hardness,
    pitch_crack,
    pitch_age,
    is_duplicate,
    browser_fingerprint,
  } = req.body || {};

  // basic validation
  if (
    !match_type ||
    !user_name ||
    !match_name ||
    !pitch_type ||
    !pitch_hardness ||
    !pitch_crack ||
    !pitch_age
  ) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields.",
    });
  }

  try {
    const insertQuery = `
      INSERT INTO pitch_randomizer_logs
        (match_type, user_name, match_name, pitch_type, pitch_hardness, pitch_crack, pitch_age, is_duplicate, browser_fingerprint)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, created_at;
    `;

    const values = [
      match_type,
      user_name,
      match_name,
      pitch_type,
      pitch_hardness,
      pitch_crack,
      pitch_age,
      is_duplicate === true, // force boolean
      browser_fingerprint || null,
    ];

    const result = await pool.query(insertQuery, values);

    return res.json({
      success: true,
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
    });
  } catch (err) {
    console.error("Error inserting pitch log:", err);
    return res.status(500).json({
      success: false,
      message: "DB error while saving pitch log",
    });
  }
});

// GET /api/tools/pitch-randomizer/history?limit=50
// Fetch latest generated pitches (for global/admin view)
router.get("/history", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 200); // cap at 200

  try {
    const q = `
      SELECT id,
             match_type,
             user_name,
             match_name,
             pitch_type,
             pitch_hardness,
             pitch_crack,
             pitch_age,
             is_duplicate,
             created_at
      FROM pitch_randomizer_logs
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const { rows } = await pool.query(q, [limit]);
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching pitch history:", err);
    return res.status(500).json({
      success: false,
      message: "DB error while fetching pitch history",
    });
  }
});

module.exports = router;
