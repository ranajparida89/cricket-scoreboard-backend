// ✅ routes/playerRoutes.js — accepts optional user_id and verifies when available
const express = require("express");
const router = express.Router();
const pool = require("../db");

// POST /api/player-performance
router.post("/player-performance", async (req, res) => {
  try {
    const b = req.body || {};
    console.log("→ /player-performance body:", b);

    const required = ["match_name", "player_id", "team_name", "match_type", "against_team"];
    for (const k of required) {
      if (b[k] === undefined || b[k] === null || String(b[k]).trim() === "") {
        return res.status(400).json({ message: `⚠️ Missing required field: ${k}` });
      }
    }

    // Coerce
    const asInt = (v) => (v === "" || v === null || v === undefined ? 0 : Number(v));
    const match_name    = String(b.match_name).trim();
    const player_id     = Number(b.player_id);
    const team_name     = String(b.team_name).trim();
    const match_type    = String(b.match_type).trim();
    const against_team  = String(b.against_team).trim();
    const run_scored    = asInt(b.run_scored);
    const balls_faced   = asInt(b.balls_faced);
    const wickets_taken = asInt(b.wickets_taken);
    const runs_given    = asInt(b.runs_given);
    const fifties       = asInt(b.fifties);
    const hundreds      = asInt(b.hundreds);
    const user_id       = b.user_id !== undefined && b.user_id !== null && b.user_id !== "" ? Number(b.user_id) : null;

    if (!Number.isInteger(player_id)) {
      return res.status(400).json({ message: "⚠️ player_id must be a number." });
    }

    // Check that player exists (and grab any user_id it might have)
    const pRes = await pool.query("SELECT id, user_id FROM players WHERE id = $1", [player_id]);
    if (pRes.rowCount === 0) {
      return res.status(404).json({ message: "❌ Player not found." });
    }

    const playerRowUserId = pRes.rows[0].user_id ?? null;

    // If client sent user_id and the player has a user_id, enforce match
    if (user_id !== null && playerRowUserId !== null && Number(playerRowUserId) !== Number(user_id)) {
      return res.status(400).json({ message: "User ID not found for this player." });
    }

    // Insert (no user_id column assumed on player_performance;
    // if you have one, add it to the columns + VALUES and pass user_id)
    const insert = await pool.query(
      `INSERT INTO player_performance
       (match_name, player_id, team_name, match_type, against_team,
        run_scored, balls_faced, wickets_taken, runs_given, fifties, hundreds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        match_name, player_id, team_name, match_type, against_team,
        run_scored, balls_faced, wickets_taken, runs_given, fifties, hundreds,
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

// GET /api/player-performance
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
        pp.hundreds
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
