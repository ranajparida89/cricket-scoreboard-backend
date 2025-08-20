// routes/testMatchRoutes.js
// ✅ Final Fixes for Test Rankings & History shape
// ✅ [Safe updates only: input safety, optional filters, match_time for UI]

const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ----------------- Helpers ----------------- */

// Accepts 49.3 or 122.5; rejects 49.6, 49.9, etc.
const isValidOverFormat = (over) => {
  if (over === null || over === undefined) return false;
  const parts = String(over).split(".");
  const balls = parts[1] ? parseInt(parts[1], 10) : 0;
  return Number.isFinite(balls) && balls >= 0 && balls <= 5;
};

// Convert 49.3 → 49.5 (decimal overs)
const convertOversToDecimal = (overs) => {
  const [fullOvers, balls = "0"] = String(overs).split(".");
  const o = parseInt(fullOvers, 10);
  const b = parseInt(balls, 10) || 0;
  return (Number.isFinite(o) ? o : 0) + b / 6;
};

// Normalize string-ish inputs
const norm = (v) => (v ?? "").toString().trim();

/* ----------------- Routes ----------------- */

// POST /api/test-match
router.post("/test-match", async (req, res) => {
  try {
    const {
      match_id, match_type, team1, team2, winner, points,
      runs1, overs1, wickets1,
      runs2, overs2, wickets2,
      runs1_2, overs1_2, wickets1_2,
      runs2_2, overs2_2, wickets2_2,
      total_overs_used,
      match_name,
      user_id
    } = req.body;

    // ✅ ADD THESE TWO LINES RIGHT AFTER THE MAIN DESTRUCTURE:
    const { tournament_name = null, season_year = null } = req.body;

    if (!match_id || !team1 || !team2 || winner === undefined || points === undefined) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // Validate overs format (all must be provided & valid)
    const oversFields = [overs1, overs2, overs1_2, overs2_2];
    if (!oversFields.every(isValidOverFormat)) {
      return res.status(400).json({ error: "Invalid over format. Balls must be 0–5 only." });
    }

    // 1) Ensure match exists in matches with type Test
    const matchRow = await pool.query("SELECT match_type FROM matches WHERE id = $1", [match_id]);
    if (matchRow.rows.length === 0) {
      await pool.query(
        `INSERT INTO matches (id, match_name, match_type) VALUES ($1, $2, 'Test')`,
        [match_id, norm(match_name).toUpperCase() || "TEST MATCH"]
      );
    } else if (matchRow.rows[0].match_type !== "Test") {
      await pool.query(
        `UPDATE matches SET match_type = 'Test', match_name = $2 WHERE id = $1`,
        [match_id, norm(match_name).toUpperCase() || "TEST MATCH"]
      );
    }

    // 2) (kept) Combine innings (not persisted, but retained for parity/debug)
    const totalRuns1    = (Number(runs1)||0)  + (Number(runs1_2)||0);
    const totalOvers1   = convertOversToDecimal(overs1) + convertOversToDecimal(overs1_2);
    const totalWickets1 = (Number(wickets1)||0) + (Number(wickets1_2)||0);

    const totalRuns2    = (Number(runs2)||0)  + (Number(runs2_2)||0);
    const totalOvers2   = convertOversToDecimal(overs2) + convertOversToDecimal(overs2_2);
    const totalWickets2 = (Number(wickets2)||0) + (Number(wickets2_2)||0);

    // 3) Insert into test_match_results
    if (winner === "Draw") {
      // Insert two symmetric rows with 2 points each
      await pool.query(
        `
        INSERT INTO test_match_results (
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used, match_name, user_id,
          tournament_name, season_year
        ) VALUES
        ($1, $2, $3, $4, $5, 2, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22),
        ($1, $2, $4, $3, $5, 2, $9, $10, $11, $6, $7, $8, $15, $16, $17, $12, $13, $14, $18, $19, $20, $21, $22)
        `,
        [
          match_id, match_type, team1, team2, winner,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used, norm(match_name).toUpperCase(), user_id,
          tournament_name, season_year
        ]
      );
    } else {
      await pool.query(
        `
        INSERT INTO test_match_results (
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used, match_name, user_id,
          tournament_name, season_year
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18,
          $19, $20, $21,
          $22, $23
        )
        `,
        [
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1, runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2, runs2_2, overs2_2, wickets2_2,
          total_overs_used, norm(match_name).toUpperCase(), user_id,
          tournament_name, season_year
        ]
      );
    }

    const message = winner === "Draw"
      ? "🤝 The match ended in a draw!"
      : `✅ ${winner} won the test match!`;

    res.json({ message });
  } catch (err) {
    console.error("❌ Test Match Submission Error:", err.message);
    res.status(500).json({ error: "Server error while submitting test match." });
  }
});

// GET /api/test-matches  (raw dump, unchanged behavior)
router.get("/test-matches", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM test_match_results ORDER BY match_id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching test matches:", err);
    res.status(500).json({ error: "Failed to fetch test matches" });
  }
});

// GET /api/test-match-history
// (UI needs `match_time`; we add a coalesced field without changing your DB)
router.get("/test-match-history", async (req, res) => {
  try {
    const { user_id } = req.query;
    const hasUser = !!user_id;

    const baseSql = `
      SELECT
        tmr.*,
        COALESCE(tmr.match_time, tmr.match_date, tmr.created_at) AS _computed_match_time
      FROM test_match_results tmr
      ${hasUser ? "WHERE tmr.user_id = $1" : ""}
      ORDER BY COALESCE(tmr.match_time, tmr.match_date, tmr.created_at) DESC
    `;
    const result = await pool.query(baseSql, hasUser ? [user_id] : []);
    const rows = result.rows.map(r => ({
      ...r,
      match_time: r._computed_match_time || r.match_time || r.match_date || r.created_at
    }));
    res.json(rows);
  } catch (error) {
    console.error("❌ Error fetching Test match history:", error);
    res.status(500).json({ error: "Failed to fetch Test match history" });
  }
});

// GET /api/rankings/test  (points: Win=12, Loss=6, Draw=4)
// Optional filter: ?user_id=123  (non-breaking)
router.get("/rankings/test", async (req, res) => {
  try {
    const { user_id } = req.query;
    const hasUser = !!user_id;

    const result = await pool.query(
      `
      SELECT
        team AS team_name,
        COUNT(*) AS matches,
        SUM(CASE WHEN winner = team THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN winner <> team AND winner <> 'Draw' THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN winner = 'Draw' THEN 1 ELSE 0 END) AS draws,
        (SUM(CASE WHEN winner = team THEN 1 ELSE 0 END) * 12 +
         SUM(CASE WHEN winner <> team AND winner <> 'Draw' THEN 1 ELSE 0 END) * 6 +
         SUM(CASE WHEN winner = 'Draw' THEN 1 ELSE 0 END) * 4) AS points,
        ROUND(
          (SUM(CASE WHEN winner = team THEN 1 ELSE 0 END) * 12 +
           SUM(CASE WHEN winner <> team AND winner <> 'Draw' THEN 1 ELSE 0 END) * 6 +
           SUM(CASE WHEN winner = 'Draw' THEN 1 ELSE 0 END) * 4)::decimal / COUNT(*),
          2
        ) AS rating
      FROM (
        SELECT team1 AS team, winner ${hasUser ? ", user_id" : ""} FROM test_match_results
        ${hasUser ? "WHERE user_id = $1" : ""}
        UNION ALL
        SELECT team2 AS team, winner ${hasUser ? ", user_id" : ""} FROM test_match_results
        ${hasUser ? "WHERE user_id = $1" : ""}
      ) AS all_teams
      GROUP BY team
      ORDER BY points DESC
      `,
      hasUser ? [user_id] : []
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Failed to fetch test rankings:", err.message);
    res.status(500).json({ error: "Test ranking error" });
  }
});

// GET /api/leaderboard/test (dense rank by points)
// Optional filter: ?user_id=123  (non-breaking)
router.get("/leaderboard/test", async (req, res) => {
  try {
    const { user_id } = req.query;
    const hasUser = !!user_id;

    const result = await pool.query(
      `
      WITH TEST_MATCH_LEADERBOARD AS (
        SELECT
          team AS team_name,
          COUNT(*) AS matches,
          SUM(CASE WHEN winner = team THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN winner <> team AND winner <> 'Draw' THEN 1 ELSE 0 END) AS losses,
          SUM(CASE WHEN winner = 'Draw' THEN 1 ELSE 0 END) AS draws,
          (SUM(CASE WHEN winner = team THEN 1 ELSE 0 END) * 12 +
           SUM(CASE WHEN winner <> team AND winner <> 'Draw' THEN 1 ELSE 0 END) * 6 +
           SUM(CASE WHEN winner = 'Draw' THEN 1 ELSE 0 END) * 4) AS points
        FROM (
          SELECT team1 AS team, winner ${hasUser ? ", user_id" : ""} FROM test_match_results
          ${hasUser ? "WHERE user_id = $1" : ""}
          UNION ALL
          SELECT team2 AS team, winner ${hasUser ? ", user_id" : ""} FROM test_match_results
          ${hasUser ? "WHERE user_id = $1" : ""}
        ) AS all_teams
        GROUP BY team
      )
      SELECT
        DENSE_RANK() OVER(ORDER BY points DESC) AS rank,
        team_name,
        matches,
        wins,
        losses,
        draws,
        points
      FROM TEST_MATCH_LEADERBOARD
      ORDER BY rank ASC;
      `,
      hasUser ? [user_id] : []
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Failed to load Test Match Leaderboard:", err.message);
    res.status(500).json({ error: "Failed to load Test Match Leaderboard" });
  }
});

module.exports = router;
