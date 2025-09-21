// routes/teamMatchStats.js
// Compute per-team summary for a user across ODI/T20 (match_history) and Test (test_match_results)

const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/team-match-stats?user_id=..&team_name=..&match_type=All|ODI|T20|Test
router.get('/', async (req, res) => {
  try {
    const userId = Number.parseInt(req.query.user_id, 10);
    const rawTeam = (req.query.team_name || '').trim();
    const matchType = (req.query.match_type || 'All').trim();

    if (!userId || Number.isNaN(userId) || !rawTeam) {
      return res.status(400).json({ error: 'Missing or invalid user_id/team_name' });
    }

    const teamName = rawTeam.toLowerCase();
    const VALID = new Set(['ODI', 'T20', 'Test', 'All']);
    if (!VALID.has(matchType)) {
      return res.status(400).json({ error: 'Invalid match_type' });
    }

    // ---------- ODI/T20 (match_history) ----------
    let statsOdiT20 = {
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      matches_draw: 0,
      total_runs: 0,
      total_wickets: 0,
    };

    if (matchType === 'All' || matchType === 'ODI' || matchType === 'T20') {
      let sql = `
        SELECT
          COUNT(*) AS matches_played,
          SUM(
            CASE
              WHEN LOWER(TRIM(winner)) = $1
                   OR LOWER(TRIM(winner)) = $1 || ' won the match!'
                   OR LOWER(TRIM(winner)) LIKE $1 || ' won the match%'
              THEN 1 ELSE 0
            END
          ) AS matches_won,
          SUM(
            CASE
              WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw', 'match drawn', 'tie')
              THEN 1 ELSE 0
            END
          ) AS matches_draw,
          SUM(
            CASE
              WHEN winner IS NOT NULL AND TRIM(winner) <> ''
                AND LOWER(TRIM(winner)) NOT IN (
                  $1, $1 || ' won the match!', 'draw','match draw','match drawn','tie'
                )
              THEN 1 ELSE 0
            END
          ) AS matches_lost,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $1 THEN COALESCE(runs1,0)
              WHEN LOWER(TRIM(team2)) = $1 THEN COALESCE(runs2,0)
              ELSE 0
            END
          ) AS total_runs,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $1 THEN COALESCE(wickets1,0)
              WHEN LOWER(TRIM(team2)) = $1 THEN COALESCE(wickets2,0)
              ELSE 0
            END
          ) AS total_wickets
        FROM match_history
        WHERE (LOWER(TRIM(team1)) = $1 OR LOWER(TRIM(team2)) = $1)
          AND user_id = $2
      `;
      const params = [teamName, userId];

      if (matchType !== 'All') {
        sql += ' AND match_type = $3';
        params.push(matchType);
      }

      const r = await pool.query(sql, params);
      if (r.rows.length) {
        const row = r.rows[0];
        statsOdiT20 = {
          matches_played: Number(row.matches_played) || 0,
          matches_won: Number(row.matches_won) || 0,
          matches_lost: Number(row.matches_lost) || 0,
          matches_draw: Number(row.matches_draw) || 0,
          total_runs: Number(row.total_runs) || 0,
          total_wickets: Number(row.total_wickets) || 0,
        };
      }
    }

    // ---------- Test (test_match_results) ----------
    let statsTest = {
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      matches_draw: 0,
      total_runs: 0,
      total_wickets: 0,
    };

    if (matchType === 'All' || matchType === 'Test') {
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
                WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw', 'match drawn', 'tie') THEN 'draw'
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
                WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw', 'match drawn', 'tie') THEN 'draw'
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
          SUM(CASE WHEN outcome = 'win'  THEN 1 ELSE 0 END) AS matches_won,
          SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) AS matches_lost,
          SUM(CASE WHEN outcome = 'draw' THEN 1 ELSE 0 END) AS matches_draw,
          SUM(runs_scored)  AS total_runs,
          SUM(wickets_taken) AS total_wickets
        FROM all_appearances;
      `;
      const params = [userId, teamName];

      const r = await pool.query(sql, params);
      if (r.rows.length) {
        const row = r.rows[0];
        statsTest = {
          matches_played: Number(row.matches_played) || 0,
          matches_won: Number(row.matches_won) || 0,
          matches_lost: Number(row.matches_lost) || 0,
          matches_draw: Number(row.matches_draw) || 0,
          total_runs: Number(row.total_runs) || 0,
          total_wickets: Number(row.total_wickets) || 0,
        };
      }
    }

    // ---------- Combine ----------
    let out;
    if (matchType === 'All') {
      out = {
        matches_played: (statsOdiT20.matches_played || 0) + (statsTest.matches_played || 0),
        matches_won:    (statsOdiT20.matches_won    || 0) + (statsTest.matches_won    || 0),
        matches_lost:   (statsOdiT20.matches_lost   || 0) + (statsTest.matches_lost   || 0),
        matches_draw:   (statsOdiT20.matches_draw   || 0) + (statsTest.matches_draw   || 0),
        total_runs:     (statsOdiT20.total_runs     || 0) + (statsTest.total_runs     || 0),
        total_wickets:  (statsOdiT20.total_wickets  || 0) + (statsTest.total_wickets  || 0),
      };
    } else if (matchType === 'Test') {
      out = statsTest;
    } else {
      out = statsOdiT20;
    }

    // Always return numbers
    res.json({
      matches_played: Number(out.matches_played) || 0,
      matches_won:    Number(out.matches_won)    || 0,
      matches_lost:   Number(out.matches_lost)   || 0,
      matches_draw:   Number(out.matches_draw)   || 0,
      total_runs:     Number(out.total_runs)     || 0,
      total_wickets:  Number(out.total_wickets)  || 0,
    });
  } catch (err) {
    console.error('TEAM MATCH STATS ERROR', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
