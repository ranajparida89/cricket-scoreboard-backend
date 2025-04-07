// routes/testMatchRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // ✅ Adjusted correctly for most setups

// ✅ Utility to check valid overs like 88.5 but not 88.6
function isValidOverFormat(over) {
  const parts = over.toString().split(".");
  return !parts[1] || parseInt(parts[1]) <= 5;
}

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
    if (!team1 || !team2 || !winner || !match_id) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // ✅ Validate overs format
    const oversList = [overs1, overs2, overs1_2, overs2_2];
    if (!oversList.every(isValidOverFormat)) {
      return res.status(400).json({ error: "Invalid over format (balls must be 0–5)." });
    }

    // ✅ Insert into test_match_results
    await pool.query(
      `
      INSERT INTO test_match_results (
        match_id, match_type, team1, team2, winner, points,
        runs1, overs1, wickets1,
        runs2, overs2, wickets2,
        runs1_2, overs1_2, wickets1_2,
        runs2_2, overs2_2, wickets2_2,
        total_overs_used
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18,
        $19
      )
      `,
      [
        match_id, match_type, team1, team2, winner, points,
        runs1, overs1, wickets1,
        runs2, overs2, wickets2,
        runs1_2, overs1_2, wickets1_2,
        runs2_2, overs2_2, wickets2_2,
        total_overs_used
      ]
    );

    res.json({ message: `✅ ${winner} won the test match!` });
  } catch (err) {
    console.error("❌ Test match error:", err);
    res.status(500).json({ error: "Server error while submitting test match." });
  }
});

module.exports = router;
