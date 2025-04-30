// ✅ ratingController.js
// Created by GPT | 02-May-2025 | Ranaj Parida

const pool = require("../db"); // database connection

// Rating calculation logic
const calculateRatings = async (req, res) => {
  try {
    // Step 1: Fetch all performances
    const result = await pool.query("SELECT * FROM player_performance");
    const data = result.rows;

    const ratingsMap = new Map();

    for (const p of data) {
      const key = `${p.player_id}-${p.match_type}`;
      if (!ratingsMap.has(key)) {
        ratingsMap.set(key, {
          player_id: p.player_id,
          match_type: p.match_type,
          total_runs: 0,
          total_wickets: 0,
          total_fifties: 0,
          total_hundreds: 0,
          matches: 0,
        });
      }

      const getPlayerRankings = async (req, res) => {
        const { type, match_type } = req.query;
      
        try {
          const result = await pool.query(`
            SELECT pr.player_id, p.player_name, p.team_name, pr.${type}_rating AS rating
            FROM player_ratings pr
            JOIN players p ON pr.player_id = p.id
            WHERE pr.match_type = $1
            ORDER BY pr.${type}_rating DESC
          `, [match_type]);
      
          res.json(result.rows);
        } catch (err) {
          console.error("❌ Failed to fetch rankings:", err);
          res.status(500).json({ error: "Failed to fetch rankings" });
        }
      };
      

      const entry = ratingsMap.get(key);
      entry.total_runs += parseInt(p.run_scored || 0);
      entry.total_wickets += parseInt(p.wickets_taken || 0);
      entry.total_fifties += parseInt(p.fifties || 0);
      entry.total_hundreds += parseInt(p.hundreds || 0);
      entry.matches += 1;
    }

    // Step 2: Loop and calculate rating per player/match_type
    for (const [, entry] of ratingsMap) {
      const {
        player_id,
        match_type,
        total_runs,
        total_wickets,
        total_fifties,
        total_hundreds,
        matches,
      } = entry;

      // Intelligent weights (can vary per match type later)
      const battingRating =
        total_runs * 1.0 +
        total_fifties * 10 +
        total_hundreds * 25;

      const bowlingRating =
        total_wickets * 20;

      const allRounderRating = Math.round((battingRating + bowlingRating) / 2);

      // Upsert logic
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
    console.error("❌ Error calculating ratings:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { calculateRatings, getPlayerRankings };

