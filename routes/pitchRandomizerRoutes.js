// C:\cricket-scoreboard-backend\routes\pitchRandomizerRoutes.js
// [Ranaj Parida - Pitch Randomizer logging API with server-side duplicate detection]

const express = require("express");
const router = express.Router();
const pool = require("../db"); // your existing DB pool

// POST /api/tools/pitch-randomizer/log
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
    // ✅ Step 1: Check for duplicates (same user + match + match_type within 60 sec)
    const dupCheckQuery = `
      SELECT created_at 
      FROM pitch_randomizer_logs
      WHERE user_name = $1 AND match_name = $2 AND match_type = $3
      ORDER BY created_at DESC LIMIT 1
    `;
    const dupRes = await pool.query(dupCheckQuery, [
      user_name,
      match_name,
      match_type,
    ]);

    let is_duplicate_final = is_duplicate === true;

    if (dupRes.rows.length > 0) {
      const lastTime = new Date(dupRes.rows[0].created_at).getTime();
      const diffSec = (Date.now() - lastTime) / 1000;
      if (diffSec <= 60) {
        is_duplicate_final = true;
      }
    }

    // ✅ Step 2: Insert new log with server-confirmed duplicate flag
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
      is_duplicate_final,
      browser_fingerprint || null,
    ];
    const result = await pool.query(insertQuery, values);

    return res.json({
      success: true,
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      is_duplicate: is_duplicate_final, // ✅ new field
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
router.get("/history", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);

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
