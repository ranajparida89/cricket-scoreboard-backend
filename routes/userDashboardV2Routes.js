// routes/userDashboardV2Routes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

// ==============================
// User Dashboard Stats (V2)
// Combines ODI, T20 from match_history + Test from test_match_results
// Supports team-level and per-player stats (see JSON response)
// [Updated by Ranaj Parida & ChatGPT | 14-June-2025]
// ==============================

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

    // 1️⃣ GET all teams for this user (lowercase for matching)
    const playerTeamsRes = await pool.query(
      'SELECT DISTINCT LOWER(TRIM(team_name)) AS team_name FROM players WHERE user_id = $1',
      [userId]
    );
    if (playerTeamsRes.rowCount === 0) {
      // New user: return empty stats
      return res.json({
        matches_played: 0, matches_won: 0, matches_lost: 0, matches_draw: 0,
        total_runs: 0, total_wickets: 0,
        player_total_runs: 0, player_total_wickets: 0
      });
    }
    const teamNames = playerTeamsRes.rows.map(r => r.team_name);

    // 2️⃣ Create a single dataset: ODI+T20 from match_history, Test from test_match_results
    // This part dynamically filters by match_type!
    let unionQuery = `
      SELECT
        match_type,
        LOWER(TRIM(team1)) AS team1,
        LOWER(TRIM(team2)) AS team2,
        LOWER(TRIM(winner)) AS winner,
        runs1, wickets1, runs2, wickets2, match_name, id as match_id
      FROM match_history
      WHERE (LOWER(TRIM(team1)) = ANY($1) OR LOWER(TRIM(team2)) = ANY($1))
      ${matchType !== 'All' && matchType !== 'Test' ? 'AND match_type = $2' : ''}

      UNION ALL

      SELECT
        match_type,
        LOWER(TRIM(team1)) AS team1,
        LOWER(TRIM(team2)) AS team2,
        LOWER(TRIM(winner)) AS winner,
        runs1, wickets1, runs2, wickets2, match_name, match_id
      FROM test_match_results
      WHERE (LOWER(TRIM(team1)) = ANY($1) OR LOWER(TRIM(team2)) = ANY($1))
      ${matchType !== 'All' && matchType === 'Test' ? 'AND match_type = $2' : ''}
    `;

    // Params
    let unionParams = [teamNames];
    if (matchType !== 'All') unionParams.push(matchType);

    // 3️⃣ AGGREGATE: Team-level stats for matches where user's teams participated
    const statsRes = await pool.query(`
      WITH all_matches AS (
        ${unionQuery}
      )
      SELECT
        COUNT(*) AS matches_played,
        SUM(CASE WHEN winner IS NOT NULL AND winner = ANY($1) THEN 1 ELSE 0 END) AS matches_won,
        SUM(CASE WHEN winner = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
        SUM(CASE WHEN winner IS NOT NULL AND winner <> 'draw' AND winner <> '' AND winner <> ANY($1) THEN 1 ELSE 0 END) AS matches_lost,
        SUM(
          CASE
            WHEN team1 = ANY($1) THEN runs1
            WHEN team2 = ANY($1) THEN runs2
            ELSE 0
          END
        ) AS total_runs,
        SUM(
          CASE
            WHEN team1 = ANY($1) THEN wickets1
            WHEN team2 = ANY($1) THEN wickets2
            ELSE 0
          END
        ) AS total_wickets
      FROM all_matches
    `, unionParams);

    const stats = statsRes.rows[0];

    // 4️⃣ OPTIONAL: Per-player stats (for future use)
    // This aggregates total runs & wickets for *all* players belonging to this user
    const playerIdsRes = await pool.query(
      'SELECT id FROM players WHERE user_id = $1',
      [userId]
    );
    const playerIds = playerIdsRes.rows.map(r => r.id);

    let playerStatsQuery = `
      SELECT
        COALESCE(SUM(run_scored), 0) AS player_total_runs,
        COALESCE(SUM(wickets_taken), 0) AS player_total_wickets
      FROM player_performance
      WHERE player_id = ANY($1)
    `;
    let playerStatsParams = [playerIds];
    if (matchType !== 'All') {
      playerStatsQuery += ' AND match_type = $2';
      playerStatsParams.push(matchType);
    }
    const playerStatsRes = await pool.query(playerStatsQuery, playerStatsParams);
    const playerStats = playerStatsRes.rows[0];

    // 5️⃣ Respond: Team stats (for dashboard) + per-player stats (for future, optional UI)
    res.json({
      matches_played: parseInt(stats.matches_played, 10) || 0,
      matches_won: parseInt(stats.matches_won, 10) || 0,
      matches_lost: parseInt(stats.matches_lost, 10) || 0,
      matches_draw: parseInt(stats.matches_draw, 10) || 0,
      total_runs: parseInt(stats.total_runs, 10) || 0,
      total_wickets: parseInt(stats.total_wickets, 10) || 0,
      // --- For optional UI use, these are "per-player" stats, not team stats! ---
      player_total_runs: parseInt(playerStats.player_total_runs, 10) || 0,
      player_total_wickets: parseInt(playerStats.player_total_wickets, 10) || 0,
    });
  } catch (err) {
    console.error("❌ User dashboard stats v2 error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
