// routes/h2hRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ GET /api/h2h/summary - Head-to-Head Summary between two teams
router.get("/summary", async (req, res) => {
  const { team1, team2, type } = req.query;

  if (!team1 || !team2 || !type || team1.toLowerCase() === team2.toLowerCase()) {
    return res.status(400).json({ error: "Please provide two different teams and a match type" });
  }

  try {
    // ✅ Step 1: Get all match IDs where team1 and team2 played against each other
    const matchQuery = await pool.query(`
      SELECT id, winner
      FROM match_history
      WHERE match_type = $1
        AND (
          (LOWER(team1) = LOWER($2) AND LOWER(team2) = LOWER($3)) OR
          (LOWER(team1) = LOWER($3) AND LOWER(team2) = LOWER($2))
        )
    `, [type, team1, team2]);

    const matches = matchQuery.rows;
    const matchIds = matches.map(m => m.id);

    // ✅ If no matches found, return zeroed response
    if (matchIds.length === 0) {
      return res.json({
        total_matches: 0,
        [team1]: 0,
        [team2]: 0,
        draws: 0,
        top_scorer: null,
        top_bowler: null
      });
    }

    // ✅ Step 2: Count wins & draws
    let team1Wins = 0, team2Wins = 0, draws = 0;
    matches.forEach(m => {
      const w = m.winner?.toLowerCase();
      if (!w || w === "draw") draws++;
      else if (w === team1.toLowerCase()) team1Wins++;
      else if (w === team2.toLowerCase()) team2Wins++;
    });

    // ✅ Step 3: Get Top Scorer among all players in those matches
    const scorerQuery = await pool.query(`
      SELECT p.player_name, SUM(pp.runs) AS total_runs
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE match_id = ANY($1)
      GROUP BY p.player_name
      ORDER BY total_runs DESC
      LIMIT 1
    `, [matchIds]);

    const topScorer = scorerQuery.rows[0] || null;

    // ✅ Step 4: Get Top Bowler among all players in those matches
    const bowlerQuery = await pool.query(`
      SELECT p.player_name, SUM(pp.wickets) AS total_wickets
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE match_id = ANY($1)
      GROUP BY p.player_name
      ORDER BY total_wickets DESC
      LIMIT 1
    `, [matchIds]);

    const topBowler = bowlerQuery.rows[0] || null;

    // ✅ Step 5: Return structured H2H data
    res.json({
      total_matches: matchIds.length,
      [team1]: team1Wins,
      [team2]: team2Wins,
      draws,
      top_scorer: topScorer ? `${topScorer.player_name} (${topScorer.total_runs} runs)` : null,
      top_bowler: topBowler ? `${topBowler.player_name} (${topBowler.total_wickets} wickets)` : null
    });

  } catch (error) {
    console.error("❌ Error in /api/h2h/summary:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ GET /api/h2h/teams - Unique team names from match_history table Added on 15 May 2025 Ranaj Parida
router.get("/teams", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT team FROM (
        SELECT LOWER(TRIM(team1)) AS team FROM match_history
        UNION
        SELECT LOWER(TRIM(team2)) AS team FROM match_history
      ) AS all_teams
      ORDER BY team
    `);

    const teamList = result.rows.map(row =>
      row.team.charAt(0).toUpperCase() + row.team.slice(1)
    );

    res.json(teamList);
  } catch (error) {
    console.error("❌ Error in /api/h2h/teams:", error);
    res.status(500).json({ error: "Failed to fetch team names" });
  }
});

module.exports = router;
