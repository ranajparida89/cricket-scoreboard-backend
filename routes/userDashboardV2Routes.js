// routes/userDashboardV2Routes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/user-dashboard-stats-v2?user_id=...&match_type=...&team_name=...
 * Returns dashboard stats for the selected team, match type, and user.
 */
router.get('/user-dashboard-stats-v2', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    let matchType = req.query.match_type || 'All';
    let teamName = (req.query.team_name || '').trim().toLowerCase();

    if (!userId) return res.status(400).json({ error: "Missing or invalid user_id" });
    const validTypes = ['ODI', 'T20', 'Test', 'All'];
    if (!validTypes.includes(matchType)) return res.status(400).json({ error: "Invalid match_type" });
    if (!teamName) return res.status(400).json({ error: "Missing team_name" });

    // Only fetch user's teams (can also be used to verify)
    const playerTeamsRes = await pool.query(
      'SELECT DISTINCT LOWER(TRIM(team_name)) AS team_name FROM players WHERE user_id = $1',
      [userId]
    );
    const validTeams = playerTeamsRes.rows.map(r => r.team_name);
    if (!validTeams.includes(teamName)) {
      return res.json({
        matches_played: 0, matches_won: 0, matches_lost: 0, matches_draw: 0,
        total_runs: 0, total_wickets: 0,
        player_total_runs: 0, player_total_wickets: 0
      });
    }

    let stats = {
      matches_played: 0, matches_won: 0, matches_lost: 0, matches_draw: 0,
      total_runs: 0, total_wickets: 0
    };

    // ========== TEST MATCH LOGIC ==========
    if (matchType === 'Test') {
      // For test matches, sum for both team1 and team2 (selected team)
      const sql = `
        SELECT
          COUNT(*) AS matches_played,
          SUM(CASE WHEN LOWER(TRIM(winner)) = $2 THEN 1 ELSE 0 END) AS matches_won,
          SUM(CASE WHEN LOWER(TRIM(winner)) <> $2 AND LOWER(TRIM(winner)) NOT IN ('draw','') THEN 1 ELSE 0 END) AS matches_lost,
          SUM(CASE WHEN LOWER(TRIM(winner)) = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $2 THEN runs1 + COALESCE(runs1_2,0)
              WHEN LOWER(TRIM(team2)) = $2 THEN runs2 + COALESCE(runs2_2,0)
              ELSE 0
            END
          ) AS total_runs,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $2 THEN wickets1 + COALESCE(wickets1_2,0)
              WHEN LOWER(TRIM(team2)) = $2 THEN wickets2 + COALESCE(wickets2_2,0)
              ELSE 0
            END
          ) AS total_wickets
        FROM test_match_results
        WHERE (LOWER(TRIM(team1)) = $2 OR LOWER(TRIM(team2)) = $2)
      `;
      const { rows } = await pool.query(sql, [userId, teamName]);
      stats = rows[0];
    }

    // ========== ODI/T20 LOGIC ==========
    else if (matchType === 'ODI' || matchType === 'T20') {
      // For ODI/T20, data is in match_history
      const sql = `
        SELECT
          COUNT(*) AS matches_played,
          SUM(CASE WHEN LOWER(TRIM(winner)) = $2 THEN 1 ELSE 0 END) AS matches_won,
          SUM(CASE WHEN LOWER(TRIM(winner)) <> $2 AND LOWER(TRIM(winner)) NOT IN ('draw','') THEN 1 ELSE 0 END) AS matches_lost,
          SUM(CASE WHEN LOWER(TRIM(winner)) = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $2 THEN runs1
              WHEN LOWER(TRIM(team2)) = $2 THEN runs2
              ELSE 0
            END
          ) AS total_runs,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $2 THEN wickets1
              WHEN LOWER(TRIM(team2)) = $2 THEN wickets2
              ELSE 0
            END
          ) AS total_wickets
        FROM match_history
        WHERE (LOWER(TRIM(team1)) = $2 OR LOWER(TRIM(team2)) = $2)
          AND match_type = $3
      `;
      const { rows } = await pool.query(sql, [userId, teamName, matchType]);
      stats = rows[0];
    }

    // ========== ALL (Sum all match types for selected team) ==========
    else if (matchType === 'All') {
      // Run Test first
      const testSql = `
        SELECT
          COUNT(*) AS matches_played,
          SUM(CASE WHEN LOWER(TRIM(winner)) = $2 THEN 1 ELSE 0 END) AS matches_won,
          SUM(CASE WHEN LOWER(TRIM(winner)) <> $2 AND LOWER(TRIM(winner)) NOT IN ('draw','') THEN 1 ELSE 0 END) AS matches_lost,
          SUM(CASE WHEN LOWER(TRIM(winner)) = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $2 THEN runs1 + COALESCE(runs1_2,0)
              WHEN LOWER(TRIM(team2)) = $2 THEN runs2 + COALESCE(runs2_2,0)
              ELSE 0
            END
          ) AS total_runs,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $2 THEN wickets1 + COALESCE(wickets1_2,0)
              WHEN LOWER(TRIM(team2)) = $2 THEN wickets2 + COALESCE(wickets2_2,0)
              ELSE 0
            END
          ) AS total_wickets
        FROM test_match_results
        WHERE (LOWER(TRIM(team1)) = $2 OR LOWER(TRIM(team2)) = $2)
      `;
      const testRows = (await pool.query(testSql, [userId, teamName])).rows[0];

      const odiT20Sql = `
        SELECT
          COUNT(*) AS matches_played,
          SUM(CASE WHEN LOWER(TRIM(winner)) = $2 THEN 1 ELSE 0 END) AS matches_won,
          SUM(CASE WHEN LOWER(TRIM(winner)) <> $2 AND LOWER(TRIM(winner)) NOT IN ('draw','') THEN 1 ELSE 0 END) AS matches_lost,
          SUM(CASE WHEN LOWER(TRIM(winner)) = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $2 THEN runs1
              WHEN LOWER(TRIM(team2)) = $2 THEN runs2
              ELSE 0
            END
          ) AS total_runs,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $2 THEN wickets1
              WHEN LOWER(TRIM(team2)) = $2 THEN wickets2
              ELSE 0
            END
          ) AS total_wickets
        FROM match_history
        WHERE (LOWER(TRIM(team1)) = $2 OR LOWER(TRIM(team2)) = $2)
      `;
      const odiT20Rows = (await pool.query(odiT20Sql, [userId, teamName])).rows[0];

      // Add up stats from both tables
      stats = {
        matches_played: (parseInt(testRows.matches_played) || 0) + (parseInt(odiT20Rows.matches_played) || 0),
        matches_won: (parseInt(testRows.matches_won) || 0) + (parseInt(odiT20Rows.matches_won) || 0),
        matches_lost: (parseInt(testRows.matches_lost) || 0) + (parseInt(odiT20Rows.matches_lost) || 0),
        matches_draw: (parseInt(testRows.matches_draw) || 0) + (parseInt(odiT20Rows.matches_draw) || 0),
        total_runs: (parseInt(testRows.total_runs) || 0) + (parseInt(odiT20Rows.total_runs) || 0),
        total_wickets: (parseInt(testRows.total_wickets) || 0) + (parseInt(odiT20Rows.total_wickets) || 0),
      };
    }

    // Per-player stats (optional, does NOT affect your UI)
    const playerIdsRes = await pool.query(
      'SELECT id FROM players WHERE user_id = $1 AND LOWER(TRIM(team_name)) = $2',
      [userId, teamName]
    );
    const playerIds = playerIdsRes.rows.map(r => r.id);
    let playerStats = { player_total_runs: 0, player_total_wickets: 0 };
    if (playerIds.length > 0) {
      let q = `
        SELECT
          COALESCE(SUM(run_scored), 0) AS player_total_runs,
          COALESCE(SUM(wickets_taken), 0) AS player_total_wickets
        FROM player_performance
        WHERE player_id = ANY($1)
      `;
      let qParams = [playerIds];
      if (matchType !== 'All') {
        q += ' AND match_type = $2';
        qParams.push(matchType);
      }
      const r = await pool.query(q, qParams);
      playerStats = r.rows[0];
    }

    // Final response (always send int, never string/null)
    res.json({
      matches_played: parseInt(stats.matches_played) || 0,
      matches_won: parseInt(stats.matches_won) || 0,
      matches_lost: parseInt(stats.matches_lost) || 0,
      matches_draw: parseInt(stats.matches_draw) || 0,
      total_runs: parseInt(stats.total_runs) || 0,
      total_wickets: parseInt(stats.total_wickets) || 0,
      player_total_runs: parseInt(playerStats.player_total_runs) || 0,
      player_total_wickets: parseInt(playerStats.player_total_wickets) || 0,
    });
  } catch (err) {
    console.error("❌ User dashboard stats v2 error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
