// routes/userDashboardV2Routes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

// User-Isolated Dashboard Stats (V2) - uses robust SQL for "winner" as a sentence!
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

    // Step 1: Get user's teams
    const playerTeamsRes = await pool.query(
      'SELECT DISTINCT team_name FROM players WHERE user_id = $1',
      [userId]
    );
    if (playerTeamsRes.rowCount === 0) {
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
    // Not used below but fetched for completeness
    const teamNames = playerTeamsRes.rows.map(r => r.team_name.trim());

    // Step 2: Main match stats query (LIKE logic for winner sentences!)
    let matchHistoryQuery = `
      WITH user_teams AS (
        SELECT DISTINCT team_name FROM players WHERE user_id = $1
      )
      SELECT 
        COUNT(*) AS matches_played,
        SUM(
          CASE
            WHEN EXISTS (
              SELECT 1 FROM user_teams ut
              WHERE LOWER(TRIM(winner)) LIKE '%' || LOWER(TRIM(ut.team_name)) || '%'
            )
            THEN 1 ELSE 0
          END
        ) AS matches_won,
        SUM(
          CASE WHEN winner IS NULL OR TRIM(winner) = '' THEN 1 ELSE 0 END
        ) AS matches_draw,
        SUM(
          CASE
            WHEN winner IS NOT NULL AND TRIM(winner) <> ''
              AND NOT EXISTS (
                SELECT 1 FROM user_teams ut
                WHERE LOWER(TRIM(winner)) LIKE '%' || LOWER(TRIM(ut.team_name)) || '%'
              )
              AND (
                LOWER(TRIM(team1)) IN (SELECT LOWER(TRIM(team_name)) FROM user_teams)
                OR LOWER(TRIM(team2)) IN (SELECT LOWER(TRIM(team_name)) FROM user_teams)
              )
            THEN 1 ELSE 0
          END
        ) AS matches_lost
      FROM match_history
      WHERE
        (LOWER(TRIM(team1)) IN (SELECT LOWER(TRIM(team_name)) FROM user_teams)
         OR LOWER(TRIM(team2)) IN (SELECT LOWER(TRIM(team_name)) FROM user_teams))
    `;
    let matchHistoryParams = [userId];
    if (matchType !== 'All') {
      matchHistoryQuery += ' AND match_type = $2';
      matchHistoryParams.push(matchType);
    }

    const matchStatsRes = await pool.query(matchHistoryQuery, matchHistoryParams);
    const matchStats = matchStatsRes.rows[0];

    // Step 3: Get all user player IDs for stats
    const playerIdsRes = await pool.query(
      'SELECT id FROM players WHERE user_id = $1',
      [userId]
    );
    const playerIds = playerIdsRes.rows.map(r => r.id);

    // Step 4: Run & wicket stats (with matchType filter)
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

    // Step 5: Respond
    res.json({
      matches_played: parseInt(matchStats.matches_played, 10) || 0,
      matches_won: parseInt(matchStats.matches_won, 10) || 0,
      matches_lost: parseInt(matchStats.matches_lost, 10) || 0,
      matches_draw: parseInt(matchStats.matches_draw, 10) || 0,
      total_runs: parseInt(stats.total_runs, 10) || 0,
      total_wickets: parseInt(stats.total_wickets, 10) || 0,
    });
  } catch (err) {
    console.error("❌ User dashboard stats v2 error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
