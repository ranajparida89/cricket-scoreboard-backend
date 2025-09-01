// src/routes/performanceRoutes.js
// Adds: GET /api/tournaments (distinct), and tournament_name + season_year
// autocapture/validation in POST /api/player-performance

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
  if (up === "TEST" || raw === "Test") return "Test";
  return "ODI";
};
const getUserIdFromReq = (req) => {
  const h = req.header("x-user-id") || req.header("X-User-Id");
  if (h && /^\d+$/.test(String(h))) return parseInt(h, 10);
  const b = req.body?.user_id;
  if (b && /^\d+$/.test(String(b))) return parseInt(b, 10);
  return null;
};
function deriveMilestones(score) {
  const s = Number.isFinite(score) ? score : 0;
  if (s >= 50 && s < 100) return { fifties: 1, hundreds: 0 };
  if (s >= 100 && s < 200) return { fifties: 0, hundreds: 1 };
  if (s >= 200 && s < 300) return { fifties: 0, hundreds: 2 };
  if (s >= 300)           return { fifties: 0, hundreds: Math.floor(s / 100) };
  return { fifties: 0, hundreds: 0 };
}
const YEAR_RE = /(19|20)\d{2}/;
const extractYear = (s = "") => {
  const m = String(s).match(YEAR_RE);
  return m ? Number(m[0]) : null;
};

async function lookupTournamentByMatch(client, { match_id, match_name }) {
  // 1) by match_id (if ever provided by clients)
  if (match_id) {
    const r = await client.query(
      `
      SELECT tournament_name FROM match_history WHERE match_id = $1 AND tournament_name IS NOT NULL LIMIT 1
      UNION ALL
      SELECT tournament_name FROM test_match_results WHERE match_id = $1 AND tournament_name IS NOT NULL LIMIT 1
      LIMIT 1
    `,
      [match_id]
    );
    if (r.rows[0]?.tournament_name) return r.rows[0].tournament_name;
  }
  // 2) by match_name (exact)
  if (match_name) {
    const r2 = await client.query(
      `
      SELECT tournament_name FROM match_history WHERE match_name = $1 AND tournament_name IS NOT NULL LIMIT 1
      UNION ALL
      SELECT tournament_name FROM test_match_results WHERE match_name = $1 AND tournament_name IS NOT NULL LIMIT 1
      LIMIT 1
    `,
      [match_name]
    );
    if (r2.rows[0]?.tournament_name) return r2.rows[0].tournament_name;
  }
  return null;
}

async function getDistinctTournaments(client) {
  const sql = `
    SELECT DISTINCT tournament_name
    FROM match_history
    WHERE tournament_name IS NOT NULL AND tournament_name <> ''
    UNION
    SELECT DISTINCT tournament_name
    FROM test_match_results
    WHERE tournament_name IS NOT NULL AND tournament_name <> ''
    ORDER BY 1
  `;
  const { rows } = await client.query(sql);
  return rows.map((r) => r.tournament_name);
}

// ===== NEW: tournaments dropdown =====
router.get("/tournaments", async (req, res) => {
  try {
    const list = await getDistinctTournaments(pool);
    res.json(list);
  } catch (e) {
    console.error("GET /tournaments failed:", e);
    res.status(500).json({ message: "Failed to load tournaments." });
  }
});

/**
 * POST /api/player-performance
 * Keeps all your current logic + adds tournament_name & season_year handling.
 */
router.post("/player-performance", async (req, res) => {
  res.set("X-Handler", "performanceRoutes");
  const {
    match_name,
    match_id,            // optional, not used by client now
    player_id,
    team_name,
    match_type,
    against_team,
    run_scored,
    balls_faced,
    wickets_taken,
    runs_given,
    dismissed,           // "Out" | "Not Out"
    tournament_name,     // NEW (optional — server can resolve)
    season_year,         // NEW (optional — server can resolve)
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
      if (fb.rows.length) userId = fb.rows[0].user_id;
    }
    if (userId == null) {
      const hdrUserId = getUserIdFromReq(req);
      if (hdrUserId != null) {
        const uRes = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [hdrUserId]);
        if (uRes.rows.length) {
          const upd = await pool.query(
            `UPDATE players
                SET user_id = $1
              WHERE id = $2
                AND user_id IS NULL
            RETURNING user_id`,
            [hdrUserId, playerRow.id]
          );
          if (upd.rows.length) userId = upd.rows[0].user_id;
        }
      }
    }
    if (userId == null) {
      return res.status(404).json({ message: "User ID not found for this player." });
    }
    const uRes2 = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    if (uRes2.rows.length === 0) {
      return res.status(404).json({ message: "Linked user does not exist." });
    }

    // 4) normalize payload
    const payload = {
      match_name: String(match_name).trim(),
      match_id: match_id ? toInt(match_id) : null,
      player_id: toInt(player_id),
      team_name: String(team_name).trim(),
      match_type: normType(match_type),
      against_team: String(against_team).trim(),
      run_scored: toInt(run_scored),
      balls_faced: toInt(balls_faced),
      wickets_taken: toInt(wickets_taken),
      runs_given: toInt(runs_given),
      fifties: 0,
      hundreds: 0,
      dismissed: (dismissed && String(dismissed).trim()) || "Out",
      user_id: toInt(userId),
      tournament_name: (tournament_name && String(tournament_name).trim()) || null,
      season_year: season_year ? toInt(season_year) : null,
    };

    // 5) derive milestones
    const derived = deriveMilestones(payload.run_scored);
    payload.fifties = derived.fifties;
    payload.hundreds = derived.hundreds;

    // 6) resolve tournament + year if missing
    if (!payload.tournament_name) {
      payload.tournament_name = await lookupTournamentByMatch(pool, {
        match_id: payload.match_id,
        match_name: payload.match_name,
      });
    }
    if (!payload.season_year) {
      payload.season_year =
        extractYear(payload.tournament_name) ??
        extractYear(payload.match_name) ??
        null;
    }

    // 7) insert — includes new columns (tournament_name, season_year)
    const insert = await pool.query(
      `INSERT INTO player_performance
        (match_name, player_id, team_name, match_type, against_team,
         run_scored, balls_faced, wickets_taken, runs_given, fifties, hundreds,
         dismissed, user_id, tournament_name, season_year)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
        payload.tournament_name,
        payload.season_year,
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
      pp.user_id,
      pp.tournament_name,     -- NEW
      pp.season_year          -- NEW
    FROM player_performance pp
    JOIN players p ON p.id = pp.player_id
    ORDER BY pp.id DESC
  `);
  res.json(result.rows);
});

module.exports = router;
