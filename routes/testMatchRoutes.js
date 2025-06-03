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

/**
 * POST /api/test-match
 * Adds a new test match for the current user (requires user_id).
 */
router.post("/test-match", async (req, res) => {
  try {
    const {
      user_id, // 🟢 REQUIRED!
      match_id, match_type, team1, team2, winner, points,
      runs1, overs1, wickets1,
      runs2, overs2, wickets2,
      runs1_2, overs1_2, wickets1_2,
      runs2_2, overs2_2, wickets2_2,
      total_overs_used,
      match_name
    } = req.body;

    // Validate required fields including user_id
    if (!user_id || !match_id || !team1 || !team2 || winner === undefined || points === undefined) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const oversFields = [overs1, overs2, overs1_2, overs2_2];
    if (!oversFields.every(isValidOverFormat)) {
      return res.status(400).json({ error: "Invalid over format. Balls must be 0–5 only." });
    }

    // 1. Ensure match is stored in matches (with user_id, match_type = Test)
    const matchRow = await pool.query(
      "SELECT match_type FROM matches WHERE id = $1 AND user_id = $2",
      [match_id, user_id]
    );
    if (matchRow.rows.length === 0) {
      await pool.query(`
        INSERT INTO matches (id, match_name, match_type, user_id)
        VALUES ($1, $2, 'Test', $3)
      `, [match_id, match_name?.toUpperCase() || "TEST MATCH", user_id]);
    } else if (matchRow.rows[0].match_type !== "Test") {
      await pool.query(`
        UPDATE matches SET match_type = 'Test', match_name = $2
        WHERE id = $1 AND user_id = $3
      `, [match_id, match_name?.toUpperCase() || "TEST MATCH", user_id]);
    }

    // 2. Combine innings for stats (no change)
    const totalRuns1 = runs1 + runs1_2;
    const totalOvers1 = convertOversToDecimal(overs1) + convertOversToDecimal(overs1_2);
    const totalWickets1 = wickets1 + wickets1_2;
    const totalRuns2 = runs2 + runs2_2;
    const totalOvers2 = convertOversToDecimal(overs2) + convertOversToDecimal(overs2_2);
    const totalWickets2 = wickets2 + wickets2_2;

    // 3. Insert into test_match_results (add user_id!)
    if (winner === "Draw") {
      await pool.query(`
        INSERT INTO test_match_results (
          user_id,
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used, match_name
        ) VALUES
        ($1, $2, $3, $4, $5, $6, 2, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20),
        ($1, $2, $3, $5, $4, $6, 2, $10, $11, $12, $7, $8, $9, $16, $17, $18, $13, $14, $15, $19, $20)
      `, [
        user_id,
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
          user_id,
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used, match_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19,
          $20, $21
        )
      `, [
        user_id,
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

/**
 * GET: Fetch all test match result records for current user only
 * GET /api/test-matches?user_id=22
 */
router.get("/test-matches", async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: "User ID is required." });
    const result = await pool.query(
      "SELECT * FROM test_match_results WHERE user_id = $1 ORDER BY match_id DESC",
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching test matches:", err);
    res.status(500).json({ error: "Failed to fetch test matches" });
  }
});

/**
 * GET: History of Test Matches (user only)
 * GET /api/test-match-history?user_id=22
 */
router.get("/test-match-history", async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: "User ID is required." });
    const result = await pool.query(
      "SELECT * FROM test_match_results WHERE user_id = $1 ORDER BY created_at DESC",
      [user_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching Test match history:", error);
    res.status(500).json({ error: "Failed to fetch Test match history" });
  }
});

/**
 * GET: Accurate Test rankings for user only
 * GET /api/rankings/test?user_id=22
 */
router.get("/rankings/test", async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: "User ID is required." });
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
        SELECT team1 AS team, winner FROM test_match_results WHERE user_id = $1
        UNION ALL
        SELECT team2 AS team, winner FROM test_match_results WHERE user_id = $1
      ) AS all_teams
      GROUP BY team
      ORDER BY points DESC
    `, [user_id]);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Failed to fetch test rankings:", err.message);
    res.status(500).json({ error: "Test ranking error" });
  }
});

/**
 * GET: Test Match Leaderboard for user only
 * GET /api/leaderboard/test?user_id=22
 */
router.get("/leaderboard/test", async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: "User ID is required." });
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
          SELECT team1 AS team, winner FROM test_match_results WHERE user_id = $1
          UNION ALL
          SELECT team2 AS team, winner FROM test_match_results WHERE user_id = $1
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
    `, [user_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load Test Match Leaderboard" });
  }
});

module.exports = router;
