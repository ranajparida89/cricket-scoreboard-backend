// ✅ /routes/teamMatchStats.js
// ✅ [2024-06-19 | ChatGPT+Ranaj Parida] -- Ownership check REMOVED for correct stats per team & user

const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/team-match-stats?user_id=..&team_name=..&match_type=..
router.get('/', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    const teamName = (req.query.team_name || '').trim().toLowerCase();
    const matchType = (req.query.match_type || 'All').trim();

    if (!userId || !teamName) {
      return res.status(400).json({ error: "Missing or invalid user_id/team_name" });
    }
    const validTypes = ['ODI', 'T20', 'Test', 'All'];
    if (!validTypes.includes(matchType)) {
      return res.status(400).json({ error: "Invalid match_type" });
    }

    // 👇❌ REMOVED: Check for ownership in players table. Now shows stats for ANY team played under this user!
    // const teamRow = await pool.query(
    //   "SELECT 1 FROM players WHERE user_id = $1 AND LOWER(TRIM(team_name)) = $2 LIMIT 1",
    //   [userId, teamName]
    // );
    // if (teamRow.rowCount === 0) {
    //   return res.json({
    //     matches_played: 0,
    //     matches_won: 0,
    //     matches_lost: 0,
    //     matches_draw: 0,
    //     total_runs: 0,
    //     total_wickets: 0
    //   });
    // }

    // ODI/T20 (match_history) - **filtered by user_id**
    let statsOdiT20 = {
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      matches_draw: 0,
      total_runs: 0,
      total_wickets: 0
    };
    if (matchType === 'All' || matchType === 'ODI' || matchType === 'T20') {
      let sql = `
        SELECT
          COUNT(*) AS matches_played,
          SUM(
            CASE
              WHEN LOWER(TRIM(winner)) = $1
                OR LOWER(TRIM(winner)) = $1 || ' won the match!'
              THEN 1 ELSE 0
            END
          ) AS matches_won,
          SUM(
            CASE
              WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw')
                OR LOWER(TRIM(winner)) = 'match draw'
              THEN 1 ELSE 0
            END
          ) AS matches_draw,
          SUM(
            CASE
              WHEN winner IS NOT NULL AND winner <> ''
                AND LOWER(TRIM(winner)) NOT IN ($1, $1 || ' won the match!', 'draw', 'match draw')
              THEN 1 ELSE 0
            END
          ) AS matches_lost,
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
          AND user_id = $2
      `;
      let params = [teamName, userId];
      if (matchType !== 'All') {
        sql += ' AND match_type = $3';
        params.push(matchType);
      }
      const r = await pool.query(sql, params);
      statsOdiT20 = r.rows[0];
    }

    // correct update count for test match 14-june-2025
// Test matches (test_match_results) - **filtered by user_id**
let statsTest = {
  matches_played: 0,
  matches_won: 0,
  matches_lost: 0,
  matches_draw: 0,
  total_runs: 0,
  total_wickets: 0
};
if (matchType === 'All' || matchType === 'Test') {
  // Get all appearances for the team, whether team1 or team2, for this user_id
  const sql = `
    WITH all_appearances AS (
      SELECT
        id,
        user_id,
        team_name,
        outcome,
        runs_scored,
        wickets_taken
      FROM (
        -- Team1 perspective
        SELECT
          id,
          user_id,
          team1 AS team_name,
          CASE
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team1)) THEN 'win'
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team2)) THEN 'loss'
            WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw') THEN 'draw'
            ELSE NULL
          END AS outcome,
          COALESCE(runs1,0) + COALESCE(runs1_2,0) AS runs_scored,
          COALESCE(wickets1,0) + COALESCE(wickets1_2,0) AS wickets_taken
        FROM test_match_results
        WHERE user_id = $1

        UNION ALL

        -- Team2 perspective
        SELECT
          id,
          user_id,
          team2 AS team_name,
          CASE
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team2)) THEN 'win'
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team1)) THEN 'loss'
            WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw') THEN 'draw'
            ELSE NULL
          END AS outcome,
          COALESCE(runs2,0) + COALESCE(runs2_2,0) AS runs_scored,
          COALESCE(wickets2,0) + COALESCE(wickets2_2,0) AS wickets_taken
        FROM test_match_results
        WHERE user_id = $1
      ) all_rows
      WHERE LOWER(TRIM(team_name)) = $2
    )
    SELECT
      COUNT(*) AS matches_played,
      SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS matches_won,
      SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) AS matches_lost,
      SUM(CASE WHEN outcome = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
      SUM(runs_scored) AS total_runs,
      SUM(wickets_taken) AS total_wickets
    FROM all_appearances;
  `;
  const params = [userId, teamName];

  const result = await pool.query(sql, params);
  if (result.rows.length > 0) {
    statsTest = {
      matches_played: Number(result.rows[0].matches_played) || 0,
      matches_won: Number(result.rows[0].matches_won) || 0,
      matches_lost: Number(result.rows[0].matches_lost) || 0,
      matches_draw: Number(result.rows[0].matches_draw) || 0,
      total_runs: Number(result.rows[0].total_runs) || 0,
      total_wickets: Number(result.rows[0].total_wickets) || 0,
    };
  }
}
    // Combine results
    let stats = {
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      matches_draw: 0,
      total_runs: 0,
      total_wickets: 0
    };
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
    } else {
      stats = statsOdiT20;
    }

    // Always send numbers (never null)
    res.json({
      matches_played: Number(stats.matches_played) || 0,
      matches_won: Number(stats.matches_won) || 0,
      matches_lost: Number(stats.matches_lost) || 0,
      matches_draw: Number(stats.matches_draw) || 0,
      total_runs: Number(stats.total_runs) || 0,
      total_wickets: Number(stats.total_wickets) || 0,
    });

  } catch (err) {
    console.error("TEAM MATCH STATS ERROR", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;