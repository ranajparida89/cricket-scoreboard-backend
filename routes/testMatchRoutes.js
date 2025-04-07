// routes/testMatchRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // ✅ Step 2: Centralized DB connection

// ✅ Validate overs like 49.5 or 122.3 (but NOT 49.6 or 122.7)
const isValidOverFormat = (over) => {
  const parts = over.toString().split(".");
  return !parts[1] || parseInt(parts[1]) <= 5;
};

// ✅ POST /api/test-match
router.post("/test-match", async (req, res) => {
  try {
    const {
      match_id, match_type, team1, team2, winner, points,
      runs1, overs1, wickets1,
      runs2, overs2, wickets2,
      runs1_2, overs1_2, wickets1_2,
      runs2_2, overs2_2, wickets2_2,
      total_overs_used
    } = req.body;

    // ✅ Validate required fields
    if (!match_id || !team1 || !team2 || winner === undefined || points === undefined) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // ✅ Validate overs format
    const oversFields = [overs1, overs2, overs1_2, overs2_2];
    if (!oversFields.every(isValidOverFormat)) {
      return res.status(400).json({ error: "Invalid over format. Balls must be 0–5 only." });
    }

    // ✅ Insert into test_match_results
    const insertQuery = `
      INSERT INTO test_match_results (
        match_id, match_type, team1, team2, winner, points,
        runs1, overs1, wickets1,
        runs2, overs2, wickets2,
        runs1_2, overs1_2, wickets1_2,
        runs2_2, overs2_2, wickets2_2,
        total_overs_used
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18,
        $19
      )
    `;

    const values = [
      match_id, match_type, team1, team2, winner, points,
      runs1, overs1, wickets1,
      runs2, overs2, wickets2,
      runs1_2, overs1_2, wickets1_2,
      runs2_2, overs2_2, wickets2_2,
      total_overs_used
    ];

    await pool.query(insertQuery, values);

    // ✅ Send proper result response
    const message =
      winner === "Draw"
        ? `🤝 The match ended in a draw!`
        : `✅ ${winner} won the test match!`;

    res.json({ message });
  } catch (err) {
    console.error("❌ Test Match Submission Error:", err.message);
    res.status(500).json({ error: "Server error while submitting test match." });
  }
});

module.exports = router;
