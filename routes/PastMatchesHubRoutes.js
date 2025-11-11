// routes/PastMatchesHubRoutes.js
// Serves past ODI/T20 (from match_history) and Test (from test_match_results)

const express = require("express");
const pool = require("../db");

const router = express.Router();

// ✅ ODI / T20 past matches
router.get("/past-matches/odi-t20", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        match_name,
        match_type,
        team1,
        runs1,
        overs1,
        wickets1,
        team2,
        runs2,
        overs2,
        wickets2,
        winner,
        match_time,
        match_date,
        tournament_name,
        season_year
      FROM match_history
      ORDER BY COALESCE(match_date, match_time) DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching ODI/T20 past matches:", err);
    res.status(500).json({ message: "Error fetching ODI/T20 past matches" });
  }
});

// ✅ Test past matches
router.get("/past-matches/test", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        match_id,
        match_name,
        match_type,
        team1,
        team2,
        winner,
        points,
        runs1,
        overs1,
        wickets1,
        runs2,
        overs2,
        wickets2,
        runs1_2,
        overs1_2,
        wickets1_2,
        runs2_2,
        overs2_2,
        wickets2_2,
        total_overs_used,
        tournament_name,
        season_year,
        match_date,
        created_at
      FROM test_match_results
      ORDER BY COALESCE(match_date, created_at) DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching Test past matches:", err);
    res.status(500).json({ message: "Error fetching Test past matches" });
  }
});

module.exports = router;
