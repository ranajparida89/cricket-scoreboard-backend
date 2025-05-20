// ✅ testMatchRoutes.js (Final Fix for Test Rankings)
// ✅ [Ranaj Parida - 2025-04-15 | 11:55 PM] Ensures Test match inserts are visible in `teams` & `/ranking`

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
      match_name
    } = req.body;

    if (!match_id || !team1 || !team2 || winner === undefined || points === undefined) {
      return res.status(400).json({ error: "Missing required fields." });
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

    // ✅ 3. Insert into test_match_results
    if (winner === "Draw") {
      await pool.query(`
        INSERT INTO test_match_results (
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used, match_name
        ) VALUES
        ($1, $2, $3, $4, $5, 2, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19),
        ($1, $2, $4, $3, $5, 2, $9, $10, $11, $6, $7, $8, $15, $16, $17, $12, $13, $14, $18, $19)
      `, [
        match_id, match_type, team1, team2, winner,
        runs1, overs1, wickets1,
        runs2, overs2, wickets2,
        runs1_2, overs1_2, wickets1_2,
        runs2_2, overs2_2, wickets2_2,
        total_overs_used, match_name?.toUpperCase()
      ]);
    } else {
      await pool.query(`
        INSERT INTO test_match_results (
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used, match_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18,
          $19, $20
        )
      `, [
        match_id, match_type, team1, team2, winner, points,
        runs1, overs1, wickets1, runs2, overs2, wickets2,
        runs1_2, overs1_2, wickets1_2, runs2_2, overs2_2, wickets2_2,
        total_overs_used, match_name?.toUpperCase()
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

// ✅ GET: History of Test Matches
router.get("/test-match-history", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM test_match_results ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching Test match history:", error);
    res.status(500).json({ error: "Failed to fetch Test match history" });
  }
});

// ✅ [Added by Ranaj Parida | 20-April-2025] API to return accurate Test rankings
// ✅ GET: Accurate Test rankings from test_match_results table
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


module.exports = router;

