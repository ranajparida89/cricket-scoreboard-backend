// ✅ src/routes/playerRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// helpers
const toInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
// DB allows 'ODI' | 'T20' | 'Test'  ← keep "Test" Cased
const normType = (t) => {
  const x = String(t || "").toUpperCase();
  if (x === "ODI" || x === "T20") return x;
  if (x === "TEST") return "Test";
  if (x === "TEST MATCH") return "Test";
  return "ODI";
};
// Try to discover user_id from request (optional)
const pickUserId = (req) => {
  // 1) middleware (if you have one)
  if (req.user?.id) return toInt(req.user.id, null);
  // 2) x-user-id header
  const headerId = req.headers["x-user-id"];
  if (headerId) return toInt(headerId, null);
  // 3) body
  if (req.body?.user_id != null) return toInt(req.body.user_id, null);
  // 4) JWT in Authorization (optional)
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ") && auth.split(".").length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(auth.split(".")[1], "base64url").toString("utf8"));
      return toInt(payload.id || payload.user_id || payload.sub, null);
    } catch {}
  }
  return null;
};

// ✅ Add/Save Player Performance
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
    // Required fields
    if (!match_name || !player_id || !team_name || !match_type || !against_team) {
      return res.status(400).json({ message: "⚠️ Missing required fields." });
    }

    // Player exists?
    const playerCheck = await pool.query("SELECT 1 FROM players WHERE id = $1", [player_id]);
    if (playerCheck.rowCount === 0) {
      return res.status(404).json({ message: "❌ Player not found." });
    }

    // Optional current user
    const user_id = pickUserId(req);
    if (user_id != null) {
      // Validate user exists
      const userCheck = await pool.query("SELECT 1 FROM users WHERE id = $1", [user_id]);
      if (userCheck.rowCount === 0) {
        return res.status(400).json({ message: "❌ Invalid user_id." });
      }
    }

    // Coerce + normalize
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
      dismissed: (dismissed && String(dismissed).trim()) || "Out", // <- column name is 'dismissed'
      user_id: user_id, // may be null
    };

    // Insert: add user_id only when available
    let insert;
    if (payload.user_id != null) {
      insert = await pool.query(
        `INSERT INTO player_performance
         (match_name, player_id, team_name, match_type, against_team,
          run_scored, balls_faced, wickets_taken, runs_given, fifties, hundreds, dismissed, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          payload.match_name, payload.player_id, payload.team_name, payload.match_type,
          payload.against_team, payload.run_scored, payload.balls_faced, payload.wickets_taken,
          payload.runs_given, payload.fifties, payload.hundreds, payload.dismissed, payload.user_id
        ]
      );
    } else {
      insert = await pool.query(
        `INSERT INTO player_performance
         (match_name, player_id, team_name, match_type, against_team,
          run_scored, balls_faced, wickets_taken, runs_given, fifties, hundreds, dismissed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          payload.match_name, payload.player_id, payload.team_name, payload.match_type,
          payload.against_team, payload.run_scored, payload.balls_faced, payload.wickets_taken,
          payload.runs_given, payload.fifties, payload.hundreds, payload.dismissed
        ]
      );
    }

    res.status(201).json({
      message: "✅ Player performance saved successfully.",
      data: insert.rows[0],
    });
  } catch (err) {
    console.error("❌ Server error while saving performance:", err);
    res.status(500).json({ message: "❌ Server error occurred." });
  }
});

// ✅ GET all player performance records for UI tables
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
        pp.dismissed,          -- <- real column name
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
