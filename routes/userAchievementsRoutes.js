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

    // Dynamic WHERE clause for match_type
    const matchTypeFilter = matchType !== 'All' ? `AND pp.match_type = $2` : '';
    const params = matchType !== 'All' ? [userId, matchType] : [userId];

    // 1. Highest Run Scorer
   const runScorerQuery = `
  SELECT p.id AS player_id, p.player_name, SUM(pp.run_scored) AS total_runs
  FROM player_performance pp
  JOIN players p ON pp.player_id = p.id
  WHERE p.user_id = $1
    AND pp.match_id IS NOT NULL
    ${matchTypeFilter}
  GROUP BY p.id, p.player_name
  ORDER BY total_runs DESC
  LIMIT 1
`;
    const { rows: runRows } = await pool.query(runScorerQuery, params);
    const highestRunScorer = runRows[0] || null;

    // 2. Highest Centuries
    const centuriesQuery = `
      SELECT p.id AS player_id, p.player_name, SUM(pp.hundreds) AS total_centuries
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE p.user_id = $1
      ${matchTypeFilter}
      GROUP BY p.id, p.player_name
      ORDER BY total_centuries DESC
      LIMIT 1
    `;
    const { rows: centuriesRows } = await pool.query(centuriesQuery, params);
    const highestCenturies = centuriesRows[0] || null;

    // 3. Highest Wickets
    const wicketsQuery = `
      SELECT p.id AS player_id, p.player_name, SUM(pp.wickets_taken) AS total_wickets
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE p.user_id = $1
      ${matchTypeFilter}
      GROUP BY p.id, p.player_name
      ORDER BY total_wickets DESC
      LIMIT 1
    `;
    const { rows: wicketsRows } = await pool.query(wicketsQuery, params);
    const highestWicketTaker = wicketsRows[0] || null;

    // 4. Team with most wins (use ILIKE for substring matching)
   let teamMostWins = null;
if (matchType === 'Test') {
  // For Test, look at test_match_results, count wins by team for this user
  const testMostWinsQuery = `
    SELECT
      team_name,
      COUNT(*) AS wins
    FROM (
      -- Team1 as winner
      SELECT team1 AS team_name
      FROM test_match_results
      WHERE user_id = $1 AND LOWER(TRIM(winner)) = LOWER(TRIM(team1))
      UNION ALL
      -- Team2 as winner
      SELECT team2 AS team_name
      FROM test_match_results
      WHERE user_id = $1 AND LOWER(TRIM(winner)) = LOWER(TRIM(team2))
    ) AS all_wins
    GROUP BY team_name
    ORDER BY wins DESC
    LIMIT 1
  `;
  const { rows: testWinRows } = await pool.query(testMostWinsQuery, [userId]);
  if (testWinRows.length > 0) {
    teamMostWins = {
      team_id: null, // test_match_results doesn't have a team id column; adjust as needed
      team_name: testWinRows[0].team_name,
      wins: Number(testWinRows[0].wins)
    };
  }
} else {
  // ODI, T20, or All: original logic from match_history
  const teamWinFilter = matchType !== 'All' ? `AND m.match_type = $2` : '';
  const winParams = matchType !== 'All' ? [userId, matchType] : [userId];
  const teamWinQuery = `
    SELECT t.id AS team_id, t.name AS team_name, COUNT(*) AS wins
    FROM match_history m
    JOIN teams t ON (m.team1 = t.name OR m.team2 = t.name)
    WHERE t.user_id = $1
      AND m.winner ILIKE '%' || t.name || '%'
      ${teamWinFilter}
    GROUP BY t.id, t.name
    ORDER BY wins DESC
    LIMIT 1
  `;
  const { rows: winRows } = await pool.query(teamWinQuery, winParams);
  teamMostWins = winRows[0] || null;
}


    // 5. Player Ratings (Top 5, all 3 ratings per player)
    // Query all ratings at once for this user and match type
    const ratingFilter = matchType !== 'All' ? `AND pr.match_type = $2` : '';
    const ratingParams = matchType !== 'All' ? [userId, matchType] : [userId];
    const ratingQuery = `
      SELECT p.id AS player_id, p.player_name, p.team_name, pr.match_type, 
             pr.batting_rating, pr.bowling_rating, pr.allrounder_rating
      FROM player_ratings pr
      JOIN players p ON pr.player_id = p.id
      WHERE p.user_id = $1
        ${ratingFilter}
        AND pr.match_type IN ('ODI','T20','Test')
      ORDER BY pr.batting_rating DESC, pr.bowling_rating DESC, pr.allrounder_rating DESC
      LIMIT 5
    `;
    const { rows: ratingsRows } = await pool.query(ratingQuery, ratingParams);

    // Split Top 5 for each rating (batting, bowling, allrounder)
    const topBatting = [...ratingsRows].sort((a, b) => b.batting_rating - a.batting_rating).slice(0, 5);
    const topBowling = [...ratingsRows].sort((a, b) => b.bowling_rating - a.bowling_rating).slice(0, 5);
    const topAllrounder = [...ratingsRows].sort((a, b) => b.allrounder_rating - a.allrounder_rating).slice(0, 5);

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
