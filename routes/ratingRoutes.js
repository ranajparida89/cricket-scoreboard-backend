// ✅ ratingRoutes.js (Cleaned & Merged)
// Author: Ranaj Parida | Date: 02-May-2025
// Purpose: Calculate and serve player rankings

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ GET: Calculate player ratings (batting, bowling, all-rounder)
router.get("/calculate", async (req, res) => {
    try {
      console.log("🟢 Starting player rating calculation");
      await calculateRatings({ query: {} }, { status: () => ({ json: () => {} }) }); // ✅ added test trigger
      const result = await pool.query("SELECT * FROM player_performance");
      const data = result.rows;
  
      if (!data || data.length === 0) {
        return res.status(200).json({ message: "No data found in player_performance" });
      }
  
      const ratingsMap = new Map();
  
      for (const p of data) {
        if (!p.player_id || !p.match_type) continue;
  
        const key = `${p.player_id}-${p.match_type}`;
        if (!ratingsMap.has(key)) {
          ratingsMap.set(key, {
            player_id: p.player_id,
            match_type: p.match_type,
            total_runs: 0,
            total_wickets: 0,
            total_fifties: 0,
            total_hundreds: 0,
          });
        }
  
        const entry = ratingsMap.get(key);
        entry.total_runs += Number(p.run_scored || 0);
        entry.total_wickets += Number(p.wickets_taken || 0);
        entry.total_fifties += Number(p.fifties || 0);
        entry.total_hundreds += Number(p.hundreds || 0);
      }
  
      for (const [, entry] of ratingsMap) {
        const {
          player_id,
          match_type,
          total_runs,
          total_wickets,
          total_fifties,
          total_hundreds,
        } = entry;
  
        const battingRating =
          total_runs * 1.0 + total_fifties * 10 + total_hundreds * 25;
        const bowlingRating = total_wickets * 20;
        const allRounderRating = Math.round((battingRating + bowlingRating) / 2);
  
        console.log(`➡️ Upserting rating for player ${player_id} in ${match_type}`);
  
        await pool.query(
          `INSERT INTO player_ratings (player_id, match_type, batting_rating, bowling_rating, allrounder_rating)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (player_id, match_type)
           DO UPDATE SET 
             batting_rating = EXCLUDED.batting_rating,
             bowling_rating = EXCLUDED.bowling_rating,
             allrounder_rating = EXCLUDED.allrounder_rating;`,
          [player_id, match_type, battingRating, bowlingRating, allRounderRating]
        );
      }
  
      res.status(200).json({ message: "✅ Ratings calculated and updated." });
    } catch (err) {
      console.error("❌ calculateRatings failed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  


// ✅ GET: Fetch player rankings by type and match format
// Example: /api/ratings/players?type=batting&match_type=ODI
router.get("/players", async (req, res) => {
  try {
    const { type, match_type } = req.query;

    if (!type || !match_type) {
      return res.status(400).json({ error: "Missing query parameters" });
    }

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

    let skillFilter = '';
    if (type === 'batting') {
      skillFilter = "AND LOWER(p.skill_type) = 'batsman'";
    } else if (type === 'bowling') {
      skillFilter = "AND LOWER(p.skill_type) = 'bowler'";
    } else if (type === 'allrounder' || type === 'all-rounder') {
      skillFilter = "AND LOWER(p.skill_type) = 'all rounder'";
    }
    
    const result = await pool.query(
      `SELECT r.player_id, p.player_name, p.team_name, r.${column} AS rating
       FROM player_ratings r
       JOIN players p ON r.player_id = p.id
       WHERE LOWER(r.match_type) = LOWER($1)
       ${skillFilter}
       ORDER BY r.${column} DESC`,
      [match_type.toLowerCase()]  // ✅ Ensure lowercase match_type passed
    );
    
    

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("❌ Failed to fetch player rankings:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
