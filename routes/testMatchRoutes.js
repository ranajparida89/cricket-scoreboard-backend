// ✅ testMatchRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Validate overs like 49.5 or 122.3 (but NOT 49.6 or 122.7)
const isValidOverFormat = (over) => {
  const parts = over.toString().split(".");
  return !parts[1] || parseInt(parts[1]) <= 5;
};

// ✅ Utility: Convert overs to decimal for summing (e.g., 49.3 → 49.5)
const convertOversToDecimal = (overs) => {
  const [fullOvers, balls = "0"] = overs.toString().split(".");
  return parseInt(fullOvers) + parseInt(balls) / 6;
};

// ✅ POST /api/test-match
router.post("/test-match", async (req, res) => {
  try {
    // ✅ [Ranaj Parida - 2025-04-10 | 10:33 PM] Log request for debugging
    console.log("🛠️ Incoming Test Match Data:", req.body);

    const {
      match_id, match_type, team1, team2, winner, points,
      runs1, overs1, wickets1,
      runs2, overs2, wickets2,
      runs1_2, overs1_2, wickets1_2,
      runs2_2, overs2_2, wickets2_2,
      total_overs_used,
      match_name // ✅ [Ranaj Parida - 2025-04-10 | 10:33 PM] Accept user-input match name
    } = req.body;

    if (!match_id || !team1 || !team2 || winner === undefined || points === undefined) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const oversFields = [overs1, overs2, overs1_2, overs2_2];
    if (!oversFields.every(isValidOverFormat)) {
      return res.status(400).json({ error: "Invalid over format. Balls must be 0–5 only." });
    }

    // ✅ Combine 1st + 2nd innings (runs, overs, wickets)
    const totalRuns1 = runs1 + runs1_2;
    const totalOvers1 = convertOversToDecimal(overs1) + convertOversToDecimal(overs1_2);
    const totalWickets1 = wickets1 + wickets1_2;

    const totalRuns2 = runs2 + runs2_2;
    const totalOvers2 = convertOversToDecimal(overs2) + convertOversToDecimal(overs2_2);
    const totalWickets2 = wickets2 + wickets2_2;

    // ✅ [Ranaj Parida - 2025-04-10 | 10:33 PM] Insert user-provided match name in both branches
    if (winner === "Draw") {
      await pool.query(`
        INSERT INTO test_match_results (
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used,
          match_name -- ✅ Save match title (e.g., "Border Gavaskar") in DB
        ) VALUES
          ($1, $2, $3, $4, $5, 2,
           $6, $7, $8,
           $9, $10, $11,
           $12, $13, $14,
           $15, $16, $17,
           $18, $19),
          ($1, $2, $4, $3, $5, 2,
           $9, $10, $11,
           $6, $7, $8,
           $15, $16, $17,
           $12, $13, $14,
           $18, $19)
      `, [
        match_id, match_type, team1, team2, winner,
        runs1, overs1, wickets1,
        runs2, overs2, wickets2,
        runs1_2, overs1_2, wickets1_2,
        runs2_2, overs2_2, wickets2_2,
        total_overs_used,
        match_name?.toUpperCase()
      ]);
    } else {
      await pool.query(`
        INSERT INTO test_match_results (
          match_id, match_type, team1, team2, winner, points,
          runs1, overs1, wickets1,
          runs2, overs2, wickets2,
          runs1_2, overs1_2, wickets1_2,
          runs2_2, overs2_2, wickets2_2,
          total_overs_used,
          match_name -- ✅ Save match title (e.g., "Ashes Series")
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          $10, $11, $12,
          $13, $14, $15,
          $16, $17, $18,
          $19, $20
        )
      `, [
        match_id, match_type, team1, team2, winner, points,
        runs1, overs1, wickets1,
        runs2, overs2, wickets2,
        runs1_2, overs1_2, wickets1_2,
        runs2_2, overs2_2, wickets2_2,
        total_overs_used,
        match_name?.toUpperCase()
      ]);
    }

    // ✅ Save into `match_history` for match records
    await pool.query(`
      INSERT INTO match_history (
        match_name, match_type, team1, runs1, overs1, wickets1,
        team2, runs2, overs2, wickets2, winner,
        runs1_2, overs1_2, wickets1_2,
        runs2_2, overs2_2, wickets2_2,
        match_time
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17,
        $18
      )
    `, [
      match_name?.toUpperCase(), "Test", team1, totalRuns1, totalOvers1.toFixed(1), totalWickets1,
      team2, totalRuns2, totalOvers2.toFixed(1), totalWickets2, winner,
      runs1_2, overs1_2, wickets1_2,
      runs2_2, overs2_2, wickets2_2,
      new Date()
    ]);

    const message = winner === "Draw"
      ? `🤝 The match ended in a draw!`
      : `✅ ${winner} won the test match!`;

    res.json({ message });
  } catch (err) {
    console.error("❌ Test Match Submission Error:", err);
    res.status(500).json({ error: "Server error while submitting test match." });
  }
});

// ✅ GET /api/test-matches
router.get("/test-matches", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM test_match_results ORDER BY match_id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching test matches:", err);
    res.status(500).json({ error: "Failed to fetch test matches" });
  }
});

// ✅ [Ranaj - 2025-04-09] GET: Fetch Test Match History for TestMatchHistory.js
router.get("/test-match-history", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM test_match_results ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("[Ranaj - 2025-04-09] Error fetching Test match history:", error);
    res.status(500).json({ error: "Failed to fetch Test match history" });
  }
});

module.exports = router;
