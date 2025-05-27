// ✅ routes/userDashboardRoutes.js
// ✅ Ranaj Parida | 27-May-2025 | User Dashboard Stats API

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Your DB connection

/**
 * GET /api/user-dashboard-stats
 * Query params: user_id (required), match_type (ODI/T20/Test/All, default All)
 */
router.get('/user-dashboard-stats', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    const matchType = req.query.match_type ? req.query.match_type : 'All';

    if (!userId) {
      return res.status(400).json({ error: "Missing or invalid user_id" });
    }

    // --- Validate match type ---
    const validTypes = ['ODI', 'T20', 'Test', 'All'];
    if (!validTypes.includes(matchType)) {
      return res.status(400).json({ error: "Invalid match_type" });
    }

    // --- Find all player_ids for the user ---
    const playerRes = await pool.query(
      'SELECT id FROM players WHERE id = $1',
      [userId]
    );
    if (playerRes.rowCount === 0) {
      return res.status(404).json({ error: "User/player not found" });
    }
    const playerId = playerRes.rows[0].id;

    // --- Prepare SQL conditions ---
    const matchTypeCond = matchType !== 'All' ? `AND match_type = $3` : '';
    const params = matchType !== 'All' ? [playerId, userId, matchType] : [playerId, userId];

    // --- Query for stats from player_performance ---
    let statsQuery = `
      SELECT
        COUNT(*) AS matches_played,
        SUM(CASE WHEN dismissed = 'Not Out' THEN 1 ELSE 0 END) AS matches_won, -- Placeholder, adjust as needed!
        SUM(CASE WHEN dismissed = 'Out' THEN 1 ELSE 0 END) AS matches_lost, -- Placeholder, adjust as needed!
        SUM(run_scored) AS total_runs,
        SUM(wickets_taken) AS total_wickets
      FROM player_performance
      WHERE player_id = $1
        ${matchTypeCond}
    `;

    // --- Run main stats query ---
    const statsRes = await pool.query(
      statsQuery,
      matchType !== 'All' ? [playerId, matchType] : [playerId]
    );
    const stats = statsRes.rows[0];

    // --- Count draws: needs to check in match_history/test_match_results where winner IS NULL or ''
    let draws = 0;
    if (matchType === 'All' || matchType === 'ODI' || matchType === 'T20') {
      const drawQuery = `
        SELECT COUNT(*) FROM match_history
        WHERE (team1 = (SELECT team_name FROM players WHERE id = $1) OR team2 = (SELECT team_name FROM players WHERE id = $1))
          AND (winner IS NULL OR winner = '')
          ${matchType !== 'All' ? 'AND match_type = $2' : ''}
      `;
      const drawRes = await pool.query(
        drawQuery,
        matchType !== 'All' ? [playerId, matchType] : [playerId]
      );
      draws += parseInt(drawRes.rows[0].count, 10) || 0;
    }
    if (matchType === 'All' || matchType === 'Test') {
      const drawQuery = `
        SELECT COUNT(*) FROM test_match_results
        WHERE (team1 = (SELECT team_name FROM players WHERE id = $1) OR team2 = (SELECT team_name FROM players WHERE id = $1))
          AND (winner IS NULL OR winner = '')
          ${matchType === 'Test' ? 'AND match_type = $2' : ''}
      `;
      const drawRes = await pool.query(
        matchType === 'Test' ? [playerId, matchType] : [playerId]
      );
      draws += parseInt(drawRes.rows[0].count, 10) || 0;
    }

    // --- Return the dashboard stats ---
    return res.json({
      matches_played: parseInt(stats.matches_played, 10) || 0,
      matches_won: parseInt(stats.matches_won, 10) || 0,
      matches_lost: parseInt(stats.matches_lost, 10) || 0,
      matches_draw: draws,
      total_runs: parseInt(stats.total_runs, 10) || 0,
      total_wickets: parseInt(stats.total_wickets, 10) || 0,
    });

  } catch (err) {
    console.error("❌ User dashboard stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
