// User Dashboard Stats (V2) [CrickEdge, Ranaj Parida | 15-Jun-2025]
// Handles ODI, T20 from match_history and Test from test_match_results
// Returns correct stats for: matches_played, matches_won, matches_lost, matches_draw, total_runs, total_wickets, player_total_runs, player_total_wickets
const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/user-dashboard-stats-v2', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    let matchType = req.query.match_type || 'All';
    let teamName = (req.query.team_name || '').trim().toLowerCase();

    // --- Input validation ---
    if (!userId) return res.status(400).json({ error: "Missing or invalid user_id" });
    const validTypes = ['ODI', 'T20', 'Test', 'All'];
    if (!validTypes.includes(matchType)) return res.status(400).json({ error: "Invalid match_type" });
    if (!teamName) return res.status(400).json({ error: "Missing team_name" });

    // --- Get valid teams for this user ---
    const playerTeamsRes = await pool.query(
      'SELECT DISTINCT LOWER(TRIM(team_name)) AS team_name FROM players WHERE user_id = $1',
      [userId]
    );
    const validTeams = playerTeamsRes.rows.map(r => r.team_name);
    if (!validTeams.includes(teamName)) {
      // Team not valid for this user, return all zero
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

    // ======== TEST MATCH LOGIC ========
    if (matchType === 'Test') {
      const sql = `
        SELECT
          COUNT(*) AS matches_played,
          SUM(CASE WHEN LOWER(TRIM(winner)) = $1 THEN 1 ELSE 0 END) AS matches_won,
          SUM(CASE WHEN LOWER(TRIM(winner)) NOT IN ($1, 'draw', '') THEN 1 ELSE 0 END) AS matches_lost,
          SUM(CASE WHEN LOWER(TRIM(winner)) = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $1 THEN COALESCE(runs1,0) + COALESCE(runs1_2,0)
              WHEN LOWER(TRIM(team2)) = $1 THEN COALESCE(runs2,0) + COALESCE(runs2_2,0)
              ELSE 0
            END
          ) AS total_runs,
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
      stats = rows[0];
    }

    // ======== ODI/T20 LOGIC ========
    else if (matchType === 'ODI' || matchType === 'T20') {
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
          AND match_type = $2
      `;
      const { rows } = await pool.query(sql, [teamName, matchType]);
      stats = rows[0];
    }

    // ======== ALL (Sum Test + ODI/T20) ========
    else if (matchType === 'All') {
      // Test stats
      const testSql = `
        SELECT
          COUNT(*) AS matches_played,
          SUM(CASE WHEN LOWER(TRIM(winner)) = $1 THEN 1 ELSE 0 END) AS matches_won,
          SUM(CASE WHEN LOWER(TRIM(winner)) NOT IN ($1, 'draw', '') THEN 1 ELSE 0 END) AS matches_lost,
          SUM(CASE WHEN LOWER(TRIM(winner)) = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $1 THEN COALESCE(runs1,0) + COALESCE(runs1_2,0)
              WHEN LOWER(TRIM(team2)) = $1 THEN COALESCE(runs2,0) + COALESCE(runs2_2,0)
              ELSE 0
            END
          ) AS total_runs,
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
      const testRows = (await pool.query(testSql, [teamName])).rows[0];

      // ODI+T20 stats (all match_history for this team)
      const odiT20Sql = `
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
      `;
      const odiT20Rows = (await pool.query(odiT20Sql, [teamName])).rows[0];

      // Sum everything
      stats = {
        matches_played: Number(testRows.matches_played || 0) + Number(odiT20Rows.matches_played || 0),
        matches_won: Number(testRows.matches_won || 0) + Number(odiT20Rows.matches_won || 0),
        matches_lost: Number(testRows.matches_lost || 0) + Number(odiT20Rows.matches_lost || 0),
        matches_draw: Number(testRows.matches_draw || 0) + Number(odiT20Rows.matches_draw || 0),
        total_runs: Number(testRows.total_runs || 0) + Number(odiT20Rows.total_runs || 0),
        total_wickets: Number(testRows.total_wickets || 0) + Number(odiT20Rows.total_wickets || 0),
      };
    }

    // ======== PER-PLAYER STATS (for selected team) ========
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

    // ======== FINAL RESPONSE ========
    res.json({
      matches_played: Number(stats.matches_played) || 0,
      matches_won: Number(stats.matches_won) || 0,
      matches_lost: Number(stats.matches_lost) || 0,
      matches_draw: Number(stats.matches_draw) || 0,
      total_runs: Number(stats.total_runs) || 0,
      total_wickets: Number(stats.total_wickets) || 0,
      player_total_runs: Number(playerStats.player_total_runs) || 0,
      player_total_wickets: Number(playerStats.player_total_wickets) || 0,
    });

  } catch (err) {
    console.error("❌ User dashboard stats v2 error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
