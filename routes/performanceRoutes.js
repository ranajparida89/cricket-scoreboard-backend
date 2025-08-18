// ✅ routes/playerRoutes.js — fixed POST with clear validation & coercion
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ---------- Add /player-performance ----------
router.post("/player-performance", async (req, res) => {
  try {
    const b = req.body || {};
    console.log("→ /player-performance body:", b);

    // Validate required fields with helpful message
    const required = ["match_name", "player_id", "team_name", "match_type", "against_team"];
    for (const k of required) {
      if (b[k] === undefined || b[k] === null || String(b[k]).trim() === "") {
        return res.status(400).json({ message: `⚠️ Missing required field: ${k}` });
      }
    }

    // Coercions
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

    if (!Number.isInteger(player_id)) {
      return res.status(400).json({ message: "⚠️ player_id must be a number." });
    }

    // Player existence check
    const playerCheck = await pool.query("SELECT id FROM players WHERE id = $1", [player_id]);
    if (playerCheck.rowCount === 0) {
      return res.status(404).json({ message: "❌ Player not found." });
    }

    // Insert
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

// ---------- GET all player performance records ----------
router.get("/player-performance", async (req, res) => {
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
