const express = require('express');
const router = express.Router();
const pool = require('../db'); // DB connection

/**
 * GET /api/user-achievements?user_id=22&match_type=ODI
 * - user_id (required)
 * - match_type (optional): All, ODI, T20, Test (default: All)
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.query.user_id;
    const matchType = req.query.match_type || 'All';
    if (!userId) return res.status(400).json({ error: "user_id is required" });

    // Dynamic WHERE clause
    const matchTypeFilter = matchType !== 'All' ? `AND pp.match_type = $2` : '';
    const params = matchType !== 'All' ? [userId, matchType] : [userId];

    // 1. Highest Run Scorer (total runs)
    const runScorerQuery = `
      SELECT p.id AS player_id, p.player_name, SUM(pp.run_scored) AS total_runs
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      JOIN teams t ON p.team_name = t.name
      WHERE t.user_id = $1
      ${matchTypeFilter}
      GROUP BY p.id, p.player_name
      ORDER BY total_runs DESC
      LIMIT 1
    `;
    const { rows: runRows } = await pool.query(runScorerQuery, params);
    const highestRunScorer = runRows[0] || null;

    // 2. Highest Centuries (total hundreds)
    const centuriesQuery = `
      SELECT p.id AS player_id, p.player_name, SUM(pp.hundreds) AS total_centuries
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      JOIN teams t ON p.team_name = t.name
      WHERE t.user_id = $1
      ${matchTypeFilter}
      GROUP BY p.id, p.player_name
      ORDER BY total_centuries DESC
      LIMIT 1
    `;
    const { rows: centuriesRows } = await pool.query(centuriesQuery, params);
    const highestCenturies = centuriesRows[0] || null;

    // 3. Highest Wickets (total wickets)
    const wicketsQuery = `
      SELECT p.id AS player_id, p.player_name, SUM(pp.wickets_taken) AS total_wickets
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      JOIN teams t ON p.team_name = t.name
      WHERE t.user_id = $1
      ${matchTypeFilter}
      GROUP BY p.id, p.player_name
      ORDER BY total_wickets DESC
      LIMIT 1
    `;
    const { rows: wicketsRows } = await pool.query(wicketsQuery, params);
    const highestWicketTaker = wicketsRows[0] || null;

    // 4. Team with most wins
    const teamWinFilter = matchType !== 'All' ? `AND m.match_type = $2` : '';
    const winParams = matchType !== 'All' ? [userId, matchType] : [userId];
    const teamWinQuery = `
      SELECT t.id AS team_id, t.name AS team_name, COUNT(*) AS wins
      FROM match_history m
      JOIN teams t ON (m.team1 = t.name OR m.team2 = t.name)
      WHERE t.user_id = $1
        AND m.winner = t.name
        ${teamWinFilter}
      GROUP BY t.id, t.name
      ORDER BY wins DESC
      LIMIT 1
    `;
    const { rows: winRows } = await pool.query(teamWinQuery, winParams);
    const teamMostWins = winRows[0] || null;

    // 5. Player Ratings (top 5 by batting/bowling/allrounder, per match type)
    // Use player_ratings and players (user filter by team_name -> teams.user_id)
    // We'll build a ratings object for all 3 formats
    async function getTopRatings(dept, matchTypeValue) {
      // dept: batting_rating, bowling_rating, allrounder_rating
      // matchTypeValue: ODI, T20, Test, or All (for all match types)
      const ratingType = dept;
      const mtFilter = matchTypeValue !== 'All' ? `AND pr.match_type = $2` : '';
      const mtParams = matchTypeValue !== 'All' ? [userId, matchTypeValue] : [userId];
      const q = `
        SELECT p.id AS player_id, p.player_name, p.team_name, pr.match_type, pr.${ratingType} AS rating
        FROM player_ratings pr
        JOIN players p ON pr.player_id = p.id
        JOIN teams t ON p.team_name = t.name
        WHERE t.user_id = $1
        ${mtFilter}
        ORDER BY pr.${ratingType} DESC
        LIMIT 5
      `;
      const { rows } = await pool.query(q, mtParams);
      return rows;
    }
    // For the requested matchType
    const topBatting = await getTopRatings("batting_rating", matchType);
    const topBowling = await getTopRatings("bowling_rating", matchType);
    const topAllrounder = await getTopRatings("allrounder_rating", matchType);

    res.json({
      match_type: matchType,
      achievements: {
        highest_run_scorer: highestRunScorer,
        highest_centuries: highestCenturies,
        highest_wicket_taker: highestWicketTaker,
        team_most_wins: teamMostWins
      },
      top_ratings: {
        batting: topBatting,
        bowling: topBowling,
        allrounder: topAllrounder
      }
    });
  } catch (err) {
    console.error("Achievements API Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
