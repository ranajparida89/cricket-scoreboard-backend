// routes/userDashboardV2Routes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

// ==============================
// User Dashboard Stats (V2) - Handles ODI, T20, Test (correct logic!)
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

    // 1️⃣ User's teams
    const playerTeamsRes = await pool.query(
      'SELECT DISTINCT LOWER(TRIM(team_name)) AS team_name FROM players WHERE user_id = $1',
      [userId]
    );
    if (playerTeamsRes.rowCount === 0) {
      return res.json({
        matches_played: 0, matches_won: 0, matches_lost: 0, matches_draw: 0,
        total_runs: 0, total_wickets: 0,
        player_total_runs: 0, player_total_wickets: 0
      });
    }
    const teamNames = playerTeamsRes.rows.map(r => r.team_name);

    // 2️⃣ STATS: ODI/T20 (match_history)
    let statsOdiT20 = {
      matches_played: 0, matches_won: 0, matches_lost: 0, matches_draw: 0,
      total_runs: 0, total_wickets: 0
    };

    if (matchType === 'All' || matchType === 'ODI' || matchType === 'T20') {
      let where = `(LOWER(TRIM(team1)) = ANY($1) OR LOWER(TRIM(team2)) = ANY($1))`;
      if (matchType !== 'All') {
        where += ` AND match_type = $2`;
      }
      const params = [teamNames];
      if (matchType !== 'All') params.push(matchType);

      const result = await pool.query(`
        SELECT
          COUNT(*) AS matches_played,
          SUM(CASE WHEN winner IS NOT NULL AND winner <> '' AND winner = ANY($1) THEN 1 ELSE 0 END) AS matches_won,
          SUM(CASE WHEN winner = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
          SUM(CASE WHEN winner IS NOT NULL AND winner <> 'draw' AND winner <> '' AND winner <> ANY($1) THEN 1 ELSE 0 END) AS matches_lost,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = ANY($1) THEN runs1
              WHEN LOWER(TRIM(team2)) = ANY($1) THEN runs2
              ELSE 0
            END
          ) AS total_runs,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = ANY($1) THEN wickets1
              WHEN LOWER(TRIM(team2)) = ANY($1) THEN wickets2
              ELSE 0
            END
          ) AS total_wickets
        FROM match_history
        WHERE ${where}
      `, params);
      statsOdiT20 = result.rows[0];
    }

    // 3️⃣ STATS: Test Matches (test_match_results, sum both innings!)
    let statsTest = {
      matches_played: 0, matches_won: 0, matches_lost: 0, matches_draw: 0,
      total_runs: 0, total_wickets: 0
    };

    if (matchType === 'All' || matchType === 'Test') {
      let where = `(LOWER(TRIM(team1)) = ANY($1) OR LOWER(TRIM(team2)) = ANY($1))`;
      if (matchType === 'Test') {
        where += ` AND match_type = 'Test'`;
      }
      const params = [teamNames];
      // Get all Test match records for the user's teams
      const result = await pool.query(`
        SELECT 
          team1, team2, winner,
          SUM(runs1) AS runs1, SUM(wickets1) AS wickets1,
          SUM(runs2) AS runs2, SUM(wickets2) AS wickets2,
          SUM(runs1_2) AS runs1_2, SUM(wickets1_2) AS wickets1_2,
          SUM(runs2_2) AS runs2_2, SUM(wickets2_2) AS wickets2_2
        FROM test_match_results
        WHERE ${where}
        GROUP BY team1, team2, winner
      `, params);

      // Aggregate for all user's teams
      let played = 0, won = 0, lost = 0, draw = 0, runs = 0, wickets = 0;
      result.rows.forEach(row => {
        const userTeamIsTeam1 = teamNames.includes(row.team1.trim().toLowerCase());
        const userTeamIsTeam2 = teamNames.includes(row.team2.trim().toLowerCase());
        if (userTeamIsTeam1 || userTeamIsTeam2) played += 1;

        if (row.winner && row.winner.trim().toLowerCase() === 'draw') draw += 1;
        else if (row.winner && teamNames.includes(row.winner.trim().toLowerCase())) won += 1;
        else if (row.winner && row.winner !== '' && !teamNames.includes(row.winner.trim().toLowerCase())) lost += 1;

        // Team runs/wickets: always sum for the user's teams only
        if (userTeamIsTeam1) {
          runs += Number(row.runs1 || 0) + Number(row.runs1_2 || 0);
          wickets += Number(row.wickets1 || 0) + Number(row.wickets1_2 || 0);
        }
        if (userTeamIsTeam2) {
          runs += Number(row.runs2 || 0) + Number(row.runs2_2 || 0);
          wickets += Number(row.wickets2 || 0) + Number(row.wickets2_2 || 0);
        }
      });
      statsTest = {
        matches_played: played,
        matches_won: won,
        matches_lost: lost,
        matches_draw: draw,
        total_runs: runs,
        total_wickets: wickets
      };
    }

    // 4️⃣ Combine for 'All', or use single for ODI/T20/Test
    let stats = { matches_played: 0, matches_won: 0, matches_lost: 0, matches_draw: 0, total_runs: 0, total_wickets: 0 };
    if (matchType === 'All') {
      stats = {
        matches_played: Number(statsOdiT20.matches_played || 0) + Number(statsTest.matches_played || 0),
        matches_won: Number(statsOdiT20.matches_won || 0) + Number(statsTest.matches_won || 0),
        matches_lost: Number(statsOdiT20.matches_lost || 0) + Number(statsTest.matches_lost || 0),
        matches_draw: Number(statsOdiT20.matches_draw || 0) + Number(statsTest.matches_draw || 0),
        total_runs: Number(statsOdiT20.total_runs || 0) + Number(statsTest.total_runs || 0),
        total_wickets: Number(statsOdiT20.total_wickets || 0) + Number(statsTest.total_wickets || 0),
      };
    } else if (matchType === 'Test') {
      stats = statsTest;
    } else { // ODI or T20
      stats = statsOdiT20;
    }

    // 5️⃣ Per-player stats (optional/future)
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

    // 6️⃣ Respond (UI code does not need to change)
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
