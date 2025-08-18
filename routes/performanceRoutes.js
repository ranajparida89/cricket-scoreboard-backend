// src/routes/performanceRoutes.js
// FINAL — Robust user_id resolution for player performance inserts
//
// FIXES:
// [UID-1] Resolve user_id from selected player row; if NULL, fallback by (player_name + team_name).
// [UID-2] If still NULL, read X-User-Id header and BACKFILL players.user_id (only when currently NULL), then use it.
// [TYPE-1] Normalize match_type to exactly: 'ODI' | 'T20' | 'Test' (matches DB constraint).
// [DBG-1] Add X-Handler response header so you can confirm which router handled the request.
//
// IMPORTANT: Ensure there is only ONE POST /api/player-performance route registered.

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ---- helpers ----
const toInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

// DB constraint expects: 'ODI' | 'T20' | 'Test'
const normType = (t) => {
  const raw = String(t || "");
  const up = raw.toUpperCase();
  if (up === "ODI") return "ODI";
  if (up === "T20") return "T20";
  // accept "TEST" or "Test" and normalize to "Test"
  if (up === "TEST" || raw === "Test") return "Test";
  return "ODI";
};

// read user id from header or (less preferred) body
const getUserIdFromReq = (req) => {
  const h = req.header("x-user-id") || req.header("X-User-Id");
  if (h && /^\d+$/.test(String(h))) return parseInt(h, 10);
  const b = req.body?.user_id;
  if (b && /^\d+$/.test(String(b))) return parseInt(b, 10);
  return null;
};

/**
 * POST /api/player-performance
 * - Finds user_id via:
 *    a) selected player row
 *    b) fallback by (player_name + team_name) with non-null user_id
 *    c) header X-User-Id backfill (for legacy rows with NULL user_id)
 * - Inserts into player_performance with user_id.
 */
router.post("/player-performance", async (req, res) => {
  // [DBG-1] mark which file handled the request
  res.set("X-Handler", "performanceRoutes");
  console.log("[performanceRoutes] handling POST /player-performance");

  const {
    match_name,
    player_id,
    team_name,
    match_type,
    against_team,
    run_scored,
    balls_faced,
    wickets_taken,
    runs_given,
    fifties,
    hundreds,
    dismissed, // "Out" | "Not Out"
  } = req.body;

  try {
    // 1) validate basics
    if (!match_name || !player_id || !team_name || !match_type || !against_team) {
      return res.status(400).json({ message: "⚠️ Missing required fields." });
    }

    // 2) load selected player row
    const pRes = await pool.query(
      `SELECT id, player_name, team_name, user_id
         FROM players
        WHERE id = $1`,
      [player_id]
    );
    if (pRes.rows.length === 0) {
      return res.status(404).json({ message: "❌ Player not found." });
    }
    const playerRow = pRes.rows[0];

    // 3) resolve user_id
    let userId = playerRow.user_id;

    // 3a) fallback by (name + team) to avoid cross-team same-name collisions
    if (userId == null) {
      const fb = await pool.query(
        `SELECT user_id
           FROM players
          WHERE lower(player_name) = lower($1)
            AND team_name = $2
            AND user_id IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [playerRow.player_name, playerRow.team_name]
      );
      if (fb.rows.length) {
        userId = fb.rows[0].user_id;
      }
    }

    // 3b) final fallback: X-User-Id header backfill (legacy rows that were created with NULL user_id)
    if (userId == null) {
      const hdrUserId = getUserIdFromReq(req);
      if (hdrUserId != null) {
        // verify that user exists
        const uRes = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [hdrUserId]);
        if (uRes.rows.length) {
          // backfill only if currently NULL
          const upd = await pool.query(
            `UPDATE players
                SET user_id = $1
              WHERE id = $2
                AND user_id IS NULL
            RETURNING user_id`,
            [hdrUserId, playerRow.id]
          );
          if (upd.rows.length) {
            userId = upd.rows[0].user_id;
            console.log(`[performanceRoutes] Backfilled players.user_id=${userId} for player id=${playerRow.id}`);
          }
        }
      }
    }

    if (userId == null) {
      // still not found—older player created without user_id and no header/body user provided
      return res.status(404).json({ message: "User ID not found for this player." });
    }

    // 4) verify that user actually exists (defense in depth)
    const uRes2 = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    if (uRes2.rows.length === 0) {
      return res.status(404).json({ message: "Linked user does not exist." });
    }

    // 5) normalize payload
    const payload = {
      match_name: String(match_name).trim(),
      player_id: toInt(player_id),
      team_name: String(team_name).trim(),
      match_type: normType(match_type),
      against_team: String(against_team).trim(),
      run_scored: toInt(run_scored),
      balls_faced: toInt(balls_faced),
      wickets_taken: toInt(wickets_taken),
      runs_given: toInt(runs_given),
      fifties: toInt(fifties),
      hundreds: toInt(hundreds),
      dismissed: (dismissed && String(dismissed).trim()) || "Out",
      user_id: toInt(userId),
    };

    // 6) insert (column "dismissed" matches your DDL; include user_id)
    const insert = await pool.query(
      `INSERT INTO player_performance
        (match_name, player_id, team_name, match_type, against_team,
         run_scored, balls_faced, wickets_taken, runs_given, fifties, hundreds,
         dismissed, user_id)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        payload.match_name,
        payload.player_id,
        payload.team_name,
        payload.match_type,
        payload.against_team,
        payload.run_scored,
        payload.balls_faced,
        payload.wickets_taken,
        payload.runs_given,
        payload.fifties,
        payload.hundreds,
        payload.dismissed,
        payload.user_id,
      ]
    );

    return res.status(201).json({
      message: "✅ Player performance saved successfully.",
      data: insert.rows[0],
    });
  } catch (err) {
    console.error("❌ Server error while saving performance:", err);
    return res.status(500).json({ message: "❌ Server error occurred." });
  }
});

/**
 * GET /api/player-performance
 */
router.get("/player-performance", async (req, res) => {
  // optional: mark GET handler too
  res.set("X-Handler", "performanceRoutes");
  const result = await pool.query(`
    SELECT
      pp.id,
      pp.match_name,
      p.player_name,
      pp.team_name,
      pp.match_type,
      pp.against_team,
      pp.run_scored,
      pp.balls_faced,
      pp.wickets_taken,
      pp.runs_given,
      pp.fifties,
      pp.hundreds,
      pp.dismissed,
      pp.user_id
    FROM player_performance pp
    JOIN players p ON p.id = pp.player_id
    ORDER BY pp.id DESC
  `);
  res.json(result.rows);
});

module.exports = router;
