// routes/userAchievementsRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../db'); // adjust path as needed

/**
 * GET /api/user-achievements?user_id=22&match_type=ODI
 *  - user_id (required)
 *  - match_type (optional): All, ODI, T20, Test (default: All)
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.query.user_id;
    let matchType = req.query.match_type || 'All';
    if (!userId) return res.status(400).json({ error: "user_id is required" });

    // Player filter: Only include user's players (assume a players table links user/team/player)
    // Team filter: Only include user's teams

    // -- Highest Run Scorer
    let runScorerQuery = `
      SELECT p.id AS player_id, p.name AS player_name, SUM(b.runs) AS runs
      FROM ball_by_ball b
      JOIN players p ON b.batsman_id = p.id
      JOIN teams t ON p.team_id = t.id
      WHERE t.user_id = $1
      ${matchType !== "All" ? "AND b.match_type = $2" : ""}
      GROUP BY p.id, p.name
      ORDER BY runs DESC
      LIMIT 1
    `;
    const { rows: runRows } = await pool.query(
      runScorerQuery, 
      matchType !== "All" ? [userId, matchType] : [userId]
    );
    const highestRunScorer = runRows[0] || null;

    // -- Highest Centuries
    let centuriesQuery = `
      SELECT p.id AS player_id, p.name AS player_name, COUNT(*) AS centuries
      FROM (
        SELECT b.match_id, b.batsman_id, SUM(b.runs) AS runs_in_match
        FROM ball_by_ball b
        JOIN players p ON b.batsman_id = p.id
        JOIN teams t ON p.team_id = t.id
        WHERE t.user_id = $1
        ${matchType !== "All" ? "AND b.match_type = $2" : ""}
        GROUP BY b.match_id, b.batsman_id
        HAVING SUM(b.runs) >= 100
      ) AS cent
      JOIN players p ON cent.batsman_id = p.id
      GROUP BY p.id, p.name
      ORDER BY centuries DESC
      LIMIT 1
    `;
    const { rows: centuryRows } = await pool.query(
      centuriesQuery, 
      matchType !== "All" ? [userId, matchType] : [userId]
    );
    const highestCenturies = centuryRows[0] || null;

    // -- Highest Wicket Taker
    let wicketQuery = `
      SELECT p.id AS player_id, p.name AS player_name, COUNT(*) AS wickets
      FROM ball_by_ball b
      JOIN players p ON b.bowler_id = p.id
      JOIN teams t ON p.team_id = t.id
      WHERE t.user_id = $1
        AND b.wicket IS NOT NULL
        ${matchType !== "All" ? "AND b.match_type = $2" : ""}
      GROUP BY p.id, p.name
      ORDER BY wickets DESC
      LIMIT 1
    `;
    const { rows: wicketRows } = await pool.query(
      wicketQuery, 
      matchType !== "All" ? [userId, matchType] : [userId]
    );
    const highestWicketTaker = wicketRows[0] || null;

    // -- Team with Most Wins
    let teamWinQuery = `
      SELECT t.id AS team_id, t.name AS team_name, COUNT(*) AS wins
      FROM match_history m
      JOIN teams t ON (m.team1 = t.name OR m.team2 = t.name)
      WHERE t.user_id = $1
        AND m.winner = t.name
        ${matchType !== "All" ? "AND m.match_type = $2" : ""}
      GROUP BY t.id, t.name
      ORDER BY wins DESC
      LIMIT 1
    `;
    const { rows: winRows } = await pool.query(
      teamWinQuery, 
      matchType !== "All" ? [userId, matchType] : [userId]
    );
    const teamMostWins = winRows[0] || null;

    // Send final result
    res.json({
      highest_run_scorer: highestRunScorer,
      highest_centuries: highestCenturies,
      highest_wicket_taker: highestWicketTaker,
      team_most_wins: teamMostWins
    });
  } catch (err) {
    console.error("Achievements API Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
