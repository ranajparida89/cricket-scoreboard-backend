// routes/userDashboardV2Routes.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/user-dashboard-stats-v2?user_id=...&match_type=...&team_name=...
 * Returns dashboard stats for the selected team and match type for the user.
 */
router.get('/user-dashboard-stats-v2', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    const matchType = req.query.match_type || 'All';
    const teamName = (req.query.team_name || '').trim().toLowerCase();

    // Validate input
    if (!userId) return res.status(400).json({ error: "Missing or invalid user_id" });
    const validTypes = ['ODI', 'T20', 'Test', 'All'];
    if (!validTypes.includes(matchType)) return res.status(400).json({ error: "Invalid match_type" });
    if (!teamName) return res.status(400).json({ error: "Missing team_name" });

    // Get user's valid teams (case-insensitive match)
    const playerTeamsRes = await pool.query(
      'SELECT DISTINCT LOWER(TRIM(team_name)) AS team_name FROM players WHERE user_id = $1',
      [userId]
    );
    const validTeams = playerTeamsRes.rows.map(r => r.team_name);
    if (!validTeams.includes(teamName)) {
      // Not user's team!
      return res.json({
        matches_played: 0, matches_won: 0, matches_lost: 0, matches_draw: 0,
        total_runs: 0, total_wickets: 0, player_total_runs: 0, player_total_wickets: 0
      });
    }

    // Helper for test match calculation
    const getTestStats = async () => {
      const sql = `
        SELECT
          -- Played: any match where team appears
          COUNT(*) AS matches_played,
          -- Won: winner = team
          SUM(CASE WHEN LOWER(TRIM(winner)) = $1 THEN 1 ELSE 0 END) AS matches_won,
          -- Lost: winner != team and winner != draw/''
          SUM(CASE WHEN LOWER(TRIM(winner)) NOT IN ($1, 'draw', '') THEN 1 ELSE 0 END) AS matches_lost,
          -- Draw: winner = draw
          SUM(CASE WHEN LOWER(TRIM(winner)) = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
          -- Runs
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $1 THEN COALESCE(runs1,0) + COALESCE(runs1_2,0)
              WHEN LOWER(TRIM(team2)) = $1 THEN COALESCE(runs2,0) + COALESCE(runs2_2,0)
              ELSE 0
            END
          ) AS total_runs,
          -- Wickets
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $1 THEN COALESCE(wickets1,0) + COALESCE(wickets1_2,0)
              WHEN LOWER(TRIM(team2)) = $1 THEN COALESCE(wickets2,0) + COALESCE(wickets2_2,0)
              ELSE 0
            END
          ) AS total_wickets
        FROM test_match_results
        WHERE LOWER(TRIM(team1)) = $1 OR LOWER(TRIM(team2)) = $1
      `;
      const { rows } = await pool.query(sql, [teamName]);
      return rows[0];
    };

    // Helper for ODI/T20
    const getOdiT20Stats = async (type) => {
      const whereType = type === 'All' ? '' : 'AND match_type = $2';
      const params = type === 'All' ? [teamName] : [teamName, type];
      const sql = `
        SELECT
          COUNT(*) AS matches_played,
          SUM(CASE WHEN LOWER(TRIM(winner)) = $1 THEN 1 ELSE 0 END) AS matches_won,
          SUM(CASE WHEN LOWER(TRIM(winner)) NOT IN ($1, 'draw', '') THEN 1 ELSE 0 END) AS matches_lost,
          SUM(CASE WHEN LOWER(TRIM(winner)) = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $1 THEN runs1
              WHEN LOWER(TRIM(team2)) = $1 THEN runs2
              ELSE 0
            END
          ) AS total_runs,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $1 THEN wickets1
              WHEN LOWER(TRIM(team2)) = $1 THEN wickets2
              ELSE 0
            END
          ) AS total_wickets
        FROM match_history
        WHERE (LOWER(TRIM(team1)) = $1 OR LOWER(TRIM(team2)) = $1)
        ${whereType}
      `;
      const { rows } = await pool.query(sql, params);
      return rows[0];
    };

    // --- Main logic: Decide which calculation to use ---
    let stats = {
      matches_played: 0, matches_won: 0, matches_lost: 0, matches_draw: 0,
      total_runs: 0, total_wickets: 0,
    };

    if (matchType === 'Test') {
      stats = await getTestStats();
    } else if (matchType === 'ODI' || matchType === 'T20') {
      stats = await getOdiT20Stats(matchType);
    } else if (matchType === 'All') {
      // Sum all formats
      const t = await getTestStats();
      const o = await getOdiT20Stats('All');
      stats = {
        matches_played: Number(t.matches_played || 0) + Number(o.matches_played || 0),
        matches_won: Number(t.matches_won || 0) + Number(o.matches_won || 0),
        matches_lost: Number(t.matches_lost || 0) + Number(o.matches_lost || 0),
        matches_draw: Number(t.matches_draw || 0) + Number(o.matches_draw || 0),
        total_runs: Number(t.total_runs || 0) + Number(o.total_runs || 0),
        total_wickets: Number(t.total_wickets || 0) + Number(o.total_wickets || 0),
      };
    }

    // Per-player stats for that team (optional)
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

    // Final response: cast all numbers
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
