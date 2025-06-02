// ✅ routes/userDashboardRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/user-dashboard-stats?user_id=...&match_type=...
router.get('/user-dashboard-stats', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    const matchType = req.query.match_type || 'All';

    if (!userId) {
      return res.status(400).json({ error: "Missing or invalid user_id" });
    }
    const validTypes = ['ODI', 'T20', 'Test', 'All'];
    if (!validTypes.includes(matchType)) {
      return res.status(400).json({ error: "Invalid match_type" });
    }

    // 1. Get all player's IDs and teams for this user
    const playerRes = await pool.query(
      'SELECT id, team_name FROM players WHERE user_id = $1',
      [userId]
    );
    if (playerRes.rowCount === 0) {
      return res.json({
        matches_played: 0,
        matches_won: 0,
        matches_lost: 0,
        matches_draw: 0,
        total_runs: 0,
        total_wickets: 0,
      });
    }

    const playerIds = playerRes.rows.map(r => r.id);
    // Ensure team names are lower-cased for robust comparison
    const userTeams = [...new Set(playerRes.rows.map(r => r.team_name.trim().toLowerCase()))];

    // 2. Calculate total runs/wickets (player_performance)
    let statsQuery = `
      SELECT
        COUNT(*) AS matches_played,
        COALESCE(SUM(run_scored), 0) AS total_runs,
        COALESCE(SUM(wickets_taken), 0) AS total_wickets
      FROM player_performance
      WHERE player_id = ANY($1)
    `;
    let statsParams = [playerIds];
    if (matchType !== 'All') {
      statsQuery += ' AND match_type = $2';
      statsParams.push(matchType);
    }
    const statsRes = await pool.query(statsQuery, statsParams);
    const stats = statsRes.rows[0];

    // 3. Unify matches from both match_history and test_match_results
    let matchQuery = '';
    let matchParams = [];
    if (matchType === 'All') {
      matchQuery = `
        SELECT id, winner, team1, team2, match_type FROM match_history
        WHERE (team1 = ANY($1) OR team2 = ANY($1))
        UNION ALL
        SELECT id, winner, team1, team2, match_type FROM test_match_results
        WHERE (team1 = ANY($1) OR team2 = ANY($1))
      `;
      matchParams = [playerRes.rows.map(r => r.team_name)];
    } else if (matchType === 'Test') {
      matchQuery = `
        SELECT id, winner, team1, team2, match_type FROM test_match_results
        WHERE (team1 = ANY($1) OR team2 = ANY($1)) AND match_type = $2
      `;
      matchParams = [playerRes.rows.map(r => r.team_name), matchType];
    } else {
      // ODI or T20
      matchQuery = `
        SELECT id, winner, team1, team2, match_type FROM match_history
        WHERE (team1 = ANY($1) OR team2 = ANY($1)) AND match_type = $2
      `;
      matchParams = [playerRes.rows.map(r => r.team_name), matchType];
    }

    const matchRes = await pool.query(matchQuery, matchParams);

    // 4. Count played/won/lost/draw from unified matches
    let matches_played = matchRes.rowCount;
    let matches_won = 0, matches_lost = 0, matches_draw = 0;

    for (const row of matchRes.rows) {
      // Defensive: normalize possible nulls and extra spaces
      const winnerStr = row.winner ? row.winner.trim().toLowerCase() : '';
      const team1Str = row.team1 ? row.team1.trim().toLowerCase() : '';
      const team2Str = row.team2 ? row.team2.trim().toLowerCase() : '';

      if (!winnerStr) {
        matches_draw++;
      } else {
        // Check for win: winner string contains any of the user's team names
        const winForUser = userTeams.some(team =>
          winnerStr.includes(team)
        );
        if (winForUser) {
          matches_won++;
        } else if (
          userTeams.includes(team1Str) ||
          userTeams.includes(team2Str)
        ) {
          matches_lost++;
        }
      }
    }

    // 5. Return the dashboard stats
    const result = {
      matches_played: matches_played || 0, // Use match count, not player_performance count!
      matches_won,
      matches_lost,
      matches_draw,
      total_runs: parseInt(stats.total_runs, 10) || 0,
      total_wickets: parseInt(stats.total_wickets, 10) || 0,
    };

    // For debugging, uncomment:
    // console.log("Returning dashboard stats for user", userId, "=>", result);

    res.json(result);
  } catch (err) {
    console.error("❌ User dashboard stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
