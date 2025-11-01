// C:\cricket-scoreboard-backend\routes\pitchRandomizerRoutes.js
// [Ranaj Parida - Pitch Randomizer logging API with server-side duplicate detection + auto-trim to 10]

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
    // ✅ Step 1: duplicate check (same user + same match + same match_type within 60 seconds)
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

    // ✅ Step 2: insert
    const insertQuery = `
      INSERT INTO pitch_randomizer_logs
        (match_type, user_name, match_name, pitch_type, pitch_hardness, pitch_crack, pitch_age, is_duplicate, browser_fingerprint)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, created_at
    `;
    const insertValues = [
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
    const insertResult = await pool.query(insertQuery, insertValues);

    const insertedId = insertResult.rows[0].id;
    const insertedAt = insertResult.rows[0].created_at;

    // ✅ Step 3: keep only 10 rows in DB
    // logic: if total > 10 → delete everything except the latest inserted row
    let historyCleared = false;
    const countRes = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM pitch_randomizer_logs"
    );
    const total = countRes.rows[0].cnt;

    if (total > 10) {
      // remove all other rows, keep only this one
      await pool.query(
        "DELETE FROM pitch_randomizer_logs WHERE id <> $1",
        [insertedId]
      );
      historyCleared = true;
    }

    return res.json({
      success: true,
      id: insertedId,
      created_at: insertedAt,
      is_duplicate: is_duplicate_final,
      history_cleared: historyCleared, // 👈 frontend will use this
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
