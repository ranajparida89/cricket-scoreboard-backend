// ✅ src/routes/ratingRoutes.js
// Cleaned & merged with MoM bonus + optional MoM-only filter
// Author: Ranaj Parida | Updated: 15-Nov-2025

const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ============================================================
   1) CALCULATE BASE RATINGS FROM player_performance
   ============================================================ */

// ✅ GET: Calculate player ratings (batting, bowling, all-rounder)
router.get("/calculate", async (req, res) => {
  try {
    console.log("🟢 Starting player rating calculation");

    const result = await pool.query("SELECT * FROM player_performance");
    const data = result.rows;

    if (!data || data.length === 0) {
      return res
        .status(200)
        .json({ message: "No data found in player_performance" });
    }

    const ratingsMap = new Map();

    // aggregate per (player_id, match_type)
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

    // write into player_ratings
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

      console.log(
        `➡️ Upserting rating for player ${player_id} in ${match_type}`
      );

      await pool.query(
        `INSERT INTO player_ratings (
            player_id,
            match_type,
            batting_rating,
            bowling_rating,
            allrounder_rating
         )
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (player_id, match_type)
         DO UPDATE SET 
           batting_rating     = EXCLUDED.batting_rating,
           bowling_rating     = EXCLUDED.bowling_rating,
           allrounder_rating  = EXCLUDED.allrounder_rating;`,
        [player_id, match_type, battingRating, bowlingRating, allRounderRating]
      );
    }

    res.status(200).json({ message: "✅ Ratings calculated and updated." });
  } catch (err) {
    console.error("❌ calculateRatings failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ============================================================
   2) FETCH RANKINGS WITH MoM BONUS
   ============================================================ */

// ✅ GET: Fetch player rankings by type and match format
// Example: /api/rankings/players?type=batting&match_type=ODI&mom_only=true
router.get("/players", async (req, res) => {
  try {
    const { type, match_type, mom_only } = req.query;

    if (!type || !match_type) {
      return res.status(400).json({ error: "Missing query parameters" });
    }

    const typeRaw = String(type || "").toLowerCase();
    const matchTypeRaw = String(match_type || "").toLowerCase();

    // which rating column to use
    let column;
    switch (typeRaw) {
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

    // 🔎 Skill-type filter
    let skillFilter = "";
    if (typeRaw === "batting") {
      skillFilter =
        "AND (LOWER(p.skill_type) = 'batsman' OR LOWER(p.skill_type) = 'wicketkeeper/batsman')";
    } else if (typeRaw === "bowling") {
      skillFilter = "AND LOWER(p.skill_type) = 'bowler'";
    } else if (typeRaw === "allrounder" || typeRaw === "all-rounder") {
      skillFilter = "AND LOWER(p.skill_type) = 'all rounder'";
    }

    // 1) Base ratings from player_ratings
    const ratingResult = await pool.query(
      `SELECT r.player_id,
              p.player_name,
              p.team_name,
              r.${column} AS rating
       FROM player_ratings r
       JOIN players p ON r.player_id = p.id
       WHERE LOWER(r.match_type) = LOWER($1)
       ${skillFilter}
       ORDER BY r.${column} DESC`,
      [matchTypeRaw]
    );

    // if no ratings, return empty cleanly
    if (!ratingResult.rows || ratingResult.rows.length === 0) {
      return res.status(200).json([]);
    }

    // 2) MoM aggregation from view mom_awards_per_player
    const momResult = await pool.query(
      `SELECT player_id, match_type, mom_count
       FROM mom_awards_per_player
       WHERE LOWER(match_type) = LOWER($1)`,
      [matchTypeRaw]
    );

    const momMap = new Map();
    for (const row of momResult.rows) {
      momMap.set(Number(row.player_id), Number(row.mom_count || 0));
    }

    // 3) Decide bonus per MoM for this format + category
    const getMomBonusPerAward = (mt, cat) => {
      const mtUpper = String(mt || "").toUpperCase();
      const catLower = String(cat || "").toLowerCase();

      let base; // base per MoM for batting & bowling
      if (mtUpper === "TEST") base = 40;
      else if (mtUpper === "ODI") base = 30;
      else base = 20; // T20 / others

      // All-rounders get 1.5x impact
      if (catLower === "allrounder" || catLower === "all-rounder") {
        return Math.round(base * 1.5); // TEST:60, ODI:45, T20:30
      }
      return base; // batting/bowling
    };

    const perAward = getMomBonusPerAward(match_type, typeRaw);

    // 4) Merge MoM bonus into final rating
    const enriched = ratingResult.rows.map((row) => {
      const baseRating = Number(row.rating || 0);
      const playerId = Number(row.player_id);
      const momAwards = momMap.get(playerId) || 0;
      const momBonus = momAwards * perAward;
      const finalRating = baseRating + momBonus;

      return {
        ...row,
        base_rating: baseRating,
        mom_awards: momAwards,
        mom_bonus: momBonus,
        rating: finalRating,          // 👈 UI uses this
        has_mom: momAwards > 0,       // handy for UI / filters
      };
    });

    // 5) Optional: filter only MoM players if requested
    const momOnlyFlag =
      String(mom_only || "").toLowerCase() === "true" ||
      mom_only === "1" ||
      String(mom_only || "").toLowerCase() === "yes";

    let finalList = enriched;
    if (momOnlyFlag) {
      finalList = enriched.filter((p) => Number(p.mom_awards || 0) > 0);
    }

    // Sort by final (base + MoM bonus)
    finalList.sort((a, b) => Number(b.rating) - Number(a.rating));

    res.status(200).json(finalList);
  } catch (err) {
    console.error("❌ Failed to fetch player rankings:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
