// routes/userDashboardV2Routes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

// User-Isolated Dashboard Stats (V2)
router.get('/user-dashboard-stats-v2', async (req, res) => {
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

    // Only fetch players for this user
    const playerRes = await pool.query(
      'SELECT id, team_name FROM players WHERE user_id = $1',
      [userId]
    );
    if (playerRes.rowCount === 0) {
      // New user: return empty stats
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
    const userTeams = [...new Set(playerRes.rows.map(r => r.team_name.trim().toLowerCase()))];

    // Only matches CREATED BY THIS USER
    let matchQuery = `
      SELECT id, winner, team1, team2, match_type FROM match_history
      WHERE created_by = $1
    `;
    let matchParams = [userId];

    if (matchType !== 'All') {
      matchQuery += ' AND match_type = $2';
      matchParams.push(matchType);
    }

    const matchRes = await pool.query(matchQuery, matchParams);

    let matches_played = matchRes.rowCount;
    let matches_won = 0, matches_lost = 0, matches_draw = 0;

    for (const row of matchRes.rows) {
      const winnerStr = row.winner ? row.winner.trim().toLowerCase() : '';
      if (!winnerStr) {
        matches_draw++;
      } else {
        const winForUser = userTeams.some(team =>
          winnerStr.includes(team)
        );
        if (winForUser) {
          matches_won++;
        } else {
          matches_lost++;
        }
      }
    }

    // Only user’s players' performance
    let statsQuery = `
      SELECT
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

    // Respond with isolated stats
    res.json({
      matches_played: matches_played || 0,
      matches_won,
      matches_lost,
      matches_draw,
      total_runs: parseInt(stats.total_runs, 10) || 0,
      total_wickets: parseInt(stats.total_wickets, 10) || 0,
    });
  } catch (err) {
    console.error("❌ User dashboard stats v2 error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
