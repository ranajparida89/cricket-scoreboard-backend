// ✅ testMatchRoutes.js (Final Fix for Test Rankings)
// ✅ [Ranaj Parida - 2025-04-15 | 11:55 PM] Ensures Test match inserts are visible in `teams` & `/ranking`
// ✅ [2025-08-21 | Tournaments] Persist tournament_name, season_year, match_date into test_match_results
// ✅ [2025-11-04 | MoM] Persist mom_player, mom_reason into test_match_results

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Validate over format like 49.3 or 122.5 but not 49.6 or 49.9
const isValidOverFormat = (over) => {
  const parts = over.toString().split(".");
  return !parts[1] || parseInt(parts[1]) <= 5;
};

// ✅ Convert 49.3 → 49.5
const convertOversToDecimal = (overs) => {
  const [fullOvers, balls = "0"] = overs.toString().split(".");
  return parseInt(fullOvers) + parseInt(balls) / 6;
};

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
      user_id,
      // ✅ [TOURNAMENT] new fields (optional)
      tournament_name = null,
      season_year = null,
      match_date = null,
      // ✅ [MoM] new fields (required from UI)
      mom_player = null,
      mom_reason = null
    } = req.body;

    if (!match_id || !team1 || !team2 || winner === undefined || points === undefined) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // ✅ MoM must be there (your UI makes it mandatory, keep backend strict)
    if (!mom_player || !mom_reason) {
      return res.status(400).json({ error: "Man of the Match and Reason are required." });
    }

    const oversFields = [overs1, overs2, overs1_2, overs2_2];
    if (!oversFields.every(isValidOverFormat)) {
      return res.status(400).json({ error: "Invalid over format. Balls must be 0–5 only." });
    }

    // ✅ 1. Ensure match is stored in matches with correct match_type = Test
    const matchRow = await pool.query("SELECT match_type FROM matches WHERE id = $1", [match_id]);
    if (matchRow.rows.length === 0) {
      await pool.query(`
        INSERT INTO matches (id, match_name, match_type)
        VALUES ($1, $2, 'Test')
      `, [match_id, match_name?.toUpperCase() || "TEST MATCH"]);
    } else if (matchRow.rows[0].match_type !== "Test") {
      await pool.query(`
        UPDATE matches SET match_type = 'Test', match_name = $2
        WHERE id = $1
      `, [match_id, match_name?.toUpperCase() || "TEST MATCH"]);
    }

    // ✅ 2. Combine innings
    const totalRuns1 = runs1 + runs1_2;
    const totalOvers1 = convertOversToDecimal(overs1) + convertOversToDecimal(overs1_2);
    const totalWickets1 = wickets1 + wickets1_2;

    const totalRuns2 = runs2 + runs2_2;
    const totalOvers2 = convertOversToDecimal(overs2) + convertOversToDecimal(overs2_2);
    const totalWickets2 = wickets2 + wickets2_2;

    // ✅ 3. Insert into test_match_results (NOW including tournament fields + MoM)
    const matchDateSafe = match_date || new Date().toISOString().slice(0,10);

    if (winner === "Draw") {
      // draw → 2 rows (for both teams) — keep same pattern, just append MoM
      await pool.query(`
        INSERT INTO test_match_results (
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used, match_name, user_id,
          tournament_name, season_year, match_date,
          mom_player, mom_reason
        ) VALUES
        ($1, $2, $3, $4, $5, 2, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25),
        ($1, $2, $4, $3, $5, 2, $9, $10, $11, $6, $7, $8, $15, $16, $17, $12, $13, $14, $18, $19, $20, $21, $22, $23, $24, $25)
      `, [
        match_id, match_type, team1, team2, winner,
        runs1, overs1, wickets1,
        runs2, overs2, wickets2,
        runs1_2, overs1_2, wickets1_2,
        runs2_2, overs2_2, wickets2_2,
        total_overs_used, match_name?.toUpperCase(), user_id,
        tournament_name, season_year, matchDateSafe,
        mom_player, mom_reason
      ]);
    } else {
      await pool.query(`
        INSERT INTO test_match_results (
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used, match_name, user_id,
          tournament_name, season_year, match_date,
          mom_player, mom_reason
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18,
          $19, $20, $21,
          $22, $23, $24,
          $25, $26
        )
      `, [
        match_id, match_type, team1, team2, winner, points,
        runs1, overs1, wickets1,
        runs2, overs2, wickets2,
        runs1_2, overs1_2, wickets1_2,
        runs2_2, overs2_2, wickets2_2,
        total_overs_used, match_name?.toUpperCase(), user_id,
        tournament_name, season_year, matchDateSafe,
        mom_player, mom_reason
      ]);
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

// ✅ GET: Fetch all test match result records
router.get("/test-matches", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM test_match_results ORDER BY match_id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching test matches:", err);
    res.status(500).json({ error: "Failed to fetch test matches" });
  }
});

// ✅ GET: History of Test Matches (prefer match_date; fallback created_at)
router.get("/test-match-history", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *,
             COALESCE(match_date::timestamp, created_at) AS sort_ts
      FROM test_match_results
      ORDER BY sort_ts DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching Test match history:", error);
    res.status(500).json({ error: "Failed to fetch Test match history" });
  }
});

// ✅ Accurate Test rankings from test_match_results table
router.get("/rankings/test", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        team AS team_name,
        COUNT(*) AS matches,
        SUM(CASE WHEN winner = team THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN winner != team AND winner != 'Draw' THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN winner = 'Draw' THEN 1 ELSE 0 END) AS draws,
        (SUM(CASE WHEN winner = team THEN 1 ELSE 0 END) * 12 +
         SUM(CASE WHEN winner != team AND winner != 'Draw' THEN 1 ELSE 0 END) * 6 +
         SUM(CASE WHEN winner = 'Draw' THEN 1 ELSE 0 END) * 4) AS points,
        ROUND(
          (SUM(CASE WHEN winner = team THEN 1 ELSE 0 END) * 12 +
           SUM(CASE WHEN winner != team AND winner != 'Draw' THEN 1 ELSE 0 END) * 6 +
           SUM(CASE WHEN winner = 'Draw' THEN 1 ELSE 0 END) * 4)::decimal / COUNT(*),
          2
        ) AS rating
      FROM (
        SELECT team1 AS team, winner FROM test_match_results
        UNION ALL
        SELECT team2 AS team, winner FROM test_match_results
      ) AS all_teams
      GROUP BY team
      ORDER BY points DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Failed to fetch test rankings:", err.message);
    res.status(500).json({ error: "Test ranking error" });
  }
});

// ✅ Test leaderboard (dense rank)
router.get("/leaderboard/test", async (req, res) => {
  try {
    const result = await pool.query(`
      WITH TEST_MATCH_LEADERBOARD AS (
        SELECT
          team AS team_name,
          COUNT(*) AS matches,
          SUM(CASE WHEN winner = team THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN winner != team AND winner != 'Draw' THEN 1 ELSE 0 END) AS losses,
          SUM(CASE WHEN winner = 'Draw' THEN 1 ELSE 0 END) AS draws,
          (SUM(CASE WHEN winner = team THEN 1 ELSE 0 END) * 12 +
           SUM(CASE WHEN winner != team AND winner != 'Draw' THEN 1 ELSE 0 END) * 6 +
           SUM(CASE WHEN winner = 'Draw' THEN 1 ELSE 0 END) * 4) AS points
        FROM (
          SELECT team1 AS team, winner FROM test_match_results
          UNION ALL
          SELECT team2 AS team, winner FROM test_match_results
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
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load Test Match Leaderboard" });
  }
});

module.exports = router;
