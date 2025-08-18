// src/routes/playerRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// helpers
const toInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const normType = (t) => {
  const x = String(t || "").toUpperCase();
  if (x === "TEST" || x === "ODI" || x === "T20") return x;
  // allow "Test"
  if (String(t || "") === "Test") return "TEST";
  return "ODI";
};

/**
 * POST /api/player-performance
 * - Derives user_id from the selected player row; if NULL, falls back to another
 *   row with the same player_name that has a non-null user_id.
 * - Inserts into player_performance (match_name, ... , dismissed, user_id).
 */
router.post("/player-performance", async (req, res) => {
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
    // 1) validate basic required fields
    if (!match_name || !player_id || !team_name || !match_type || !against_team) {
      return res.status(400).json({ message: "⚠️ Missing required fields." });
    }

    // 2) load the player row
    const pRes = await pool.query(
      `SELECT id, player_name, user_id
         FROM players
        WHERE id = $1`,
      [player_id]
    );
    if (pRes.rows.length === 0) {
      return res.status(404).json({ message: "❌ Player not found." });
    }
    const playerRow = pRes.rows[0];

    // 3) find user_id (prefer the selected row; if null, fall back by name)
    let userId = playerRow.user_id;

    if (userId == null) {
      const fb = await pool.query(
        `SELECT user_id
           FROM players
          WHERE player_name = $1
            AND user_id IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [playerRow.player_name]
      );
      if (fb.rows.length) {
        userId = fb.rows[0].user_id;
      }
    }

    if (userId == null) {
      return res
        .status(404)
        .json({ message: "User ID not found for this player." });
    }

    // 4) verify that user actually exists
    const uRes = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    if (uRes.rows.length === 0) {
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

    // 6) insert (use correct column names; include user_id)
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
router.get("/player-performance", async (_req, res) => {
  try {
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
  } catch (err) {
    console.error("❌ Error fetching performance stats:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
