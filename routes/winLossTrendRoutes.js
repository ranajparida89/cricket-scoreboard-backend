// routes/winLossTrendRoutes.js
// Returns last 10 results (Win/Loss/Draw/No Result) for a user's team across ODI/T20 (match_history) and Test (test_match_results)

const express = require('express');
const router = express.Router();
const pool = require('../db');

// ---------- Helpers ----------
const norm = (s) => (s ?? '').toString().trim();
const lnorm = (s) => norm(s).toLowerCase();

function parseOdiT20Result(winnerString, teamName, opponentName) {
  const w = lnorm(winnerString);
  if (!w) return 'No Result';
  if (w.includes('draw') || w.includes('match draw') || w.includes('match drawn') || w.includes('tie')) return 'Draw';
  if (w.includes(lnorm(teamName)))   return 'Win';
  if (w.includes(lnorm(opponentName))) return 'Loss';
  return 'No Result';
}

router.get('/', async (req, res) => {
  try {
    const teamName = norm(req.query.team_name);
    const matchType = (req.query.match_type || 'All').trim();
    const userId = Number.parseInt(req.query.user_id, 10);
    const LIMIT = 10;

    if (!teamName) return res.status(400).json({ error: 'team_name is required' });
    if (!userId || Number.isNaN(userId)) return res.status(400).json({ error: 'user_id is required' });

    let allMatches = [];

    if (matchType === 'All') {
      // ---------- ODI/T20 ----------
      const odiT20Sql = `
        SELECT 
          id AS match_id,
          match_type,
          match_name,
          team1,
          team2,
          winner,
          match_time AS match_date
        FROM match_history
        WHERE (LOWER(TRIM(team1)) = LOWER(TRIM($1)) OR LOWER(TRIM(team2)) = LOWER(TRIM($1)))
          AND user_id = $2
        ORDER BY match_time DESC
        LIMIT $3
      `;
      const { rows: odiT20 } = await pool.query(odiT20Sql, [teamName, userId, LIMIT]);
      const odiT20Data = odiT20.map(r => {
        const isT1 = lnorm(r.team1) === lnorm(teamName);
        const opponent = isT1 ? r.team2 : r.team1;
        return {
          match_id: r.match_id,
          match_type: r.match_type,
          match_name: r.match_name,
          opponent,
          result: parseOdiT20Result(r.winner, teamName, opponent),
          match_date: r.match_date
        };
      });

      // ---------- Test ----------
      const testSql = `
        SELECT 
          id AS match_id,
          'Test'::text AS match_type,
          match_name,
          team1,
          team2,
          winner,
          COALESCE(match_date::timestamp, created_at) AS match_date
        FROM test_match_results
        WHERE (LOWER(TRIM(team1)) = LOWER(TRIM($1)) OR LOWER(TRIM(team2)) = LOWER(TRIM($1)))
          AND user_id = $2
        ORDER BY COALESCE(match_date::timestamp, created_at) DESC
        LIMIT $3
      `;
      const { rows: testRows } = await pool.query(testSql, [teamName, userId, LIMIT]);
      const testData = testRows.map(r => {
        const opponent = lnorm(r.team1) === lnorm(teamName) ? r.team2 : r.team1;
        const w = lnorm(r.winner);
        let result = 'No Result';
        if (w) {
          if (w === lnorm(teamName)) result = 'Win';
          else if (w === lnorm(opponent)) result = 'Loss';
          else if (w.includes('draw') || w.includes('match draw') || w.includes('match drawn') || w.includes('tie')) result = 'Draw';
        }
        return {
          match_id: r.match_id,
          match_type: 'Test',
          match_name: r.match_name,
          opponent,
          result,
          match_date: r.match_date
        };
      });

      allMatches = [...odiT20Data, ...testData];
      allMatches.sort((a, b) => new Date(b.match_date) - new Date(a.match_date));
      allMatches = allMatches.slice(0, LIMIT);

    } else if (matchType === 'Test') {
      // ---------- Only Test ----------
      const sql = `
        SELECT 
          id AS match_id,
          match_name,
          team1,
          team2,
          winner,
          COALESCE(match_date::timestamp, created_at) AS match_date
        FROM test_match_results
        WHERE (LOWER(TRIM(team1)) = LOWER(TRIM($1)) OR LOWER(TRIM(team2)) = LOWER(TRIM($1)))
          AND user_id = $2
          AND match_type = 'Test'
        ORDER BY COALESCE(match_date::timestamp, created_at) DESC
        LIMIT $3
      `;
      const { rows } = await pool.query(sql, [teamName, userId, LIMIT]);
      allMatches = rows.map(r => {
        const opponent = lnorm(r.team1) === lnorm(teamName) ? r.team2 : r.team1;
        const w = lnorm(r.winner);
        let result = 'No Result';
        if (w) {
          if (w === lnorm(teamName)) result = 'Win';
          else if (w === lnorm(opponent)) result = 'Loss';
          else if (w.includes('draw') || w.includes('match draw') || w.includes('match drawn') || w.includes('tie')) result = 'Draw';
        }
        return {
          match_id: r.match_id,
          match_type: 'Test',
          match_name: r.match_name,
          opponent,
          result,
          match_date: r.match_date
        };
      });

    } else {
      // ---------- Only ODI or T20 ----------
      const sql = `
        SELECT 
          id AS match_id,
          match_type,
          match_name,
          team1,
          team2,
          winner,
          match_time AS match_date
        FROM match_history
        WHERE (LOWER(TRIM(team1)) = LOWER(TRIM($1)) OR LOWER(TRIM(team2)) = LOWER(TRIM($1)))
          AND match_type = $2
          AND user_id = $3
        ORDER BY match_time DESC
        LIMIT $4
      `;
      const { rows } = await pool.query(sql, [teamName, matchType, userId, LIMIT]);
      allMatches = rows.map(r => {
        const isT1 = lnorm(r.team1) === lnorm(teamName);
        const opponent = isT1 ? r.team2 : r.team1;
        return {
          match_id: r.match_id,
          match_type: r.match_type,
          match_name: r.match_name,
          opponent,
          result: parseOdiT20Result(r.winner, teamName, opponent),
          match_date: r.match_date
        };
      });
    }

    res.json({ team_name: teamName, data: allMatches });
  } catch (err) {
    console.error('WIN/LOSS TREND ERROR', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
