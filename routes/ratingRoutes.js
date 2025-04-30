// ✅ Step 5: Create route to serve player rankings
// File: cricket-scoreboard-backend/routes/ratingRoutes.js
// 02-May-2025 | Ranaj Parida

const express = require("express");
const router = express.Router();
const pool = require("../db");
const { calculateRatings, getPlayerRankings } = require("./ratingController");


// Calculate and insert ratings
router.get("/calculate", calculateRatings);

// NEW: Fetch player rankings by type and format
router.get("/players", getPlayerRankings);

router.get("/players", getPlayerRankings);


// ✅ GET /api/rankings/players?type=batting&match_type=ODI
router.get("/players", async (req, res) => {
  try {
    const { type, match_type } = req.query;

    if (!type || !match_type) {
      return res.status(400).json({ error: "Missing query parameters" });
    }

    // Choose the rating column
    let column;
    switch (type.toLowerCase()) {
      case "batting":
        column = "batting_rating";
        break;
      case "bowling":
        column = "bowling_rating";
        break;
      case "allrounder":
      case "all-rounder":
        column = "allrounder_rating";
        break;
      default:
        return res.status(400).json({ error: "Invalid rating type" });
    }

    const result = await pool.query(
      `SELECT r.player_id, p.player_name, p.team_name, r.${column} AS rating
       FROM player_ratings r
       JOIN players p ON r.player_id = p.id
       WHERE r.match_type = $1
       ORDER BY r.${column} DESC`,
      [match_type.toUpperCase()]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("❌ Failed to fetch player rankings:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
