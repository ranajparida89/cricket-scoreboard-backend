// routes/userRecentMatchesV2Routes.js
// Recent matches across all user-owned teams (ODI/T20 from match_history).
// GET /api/user-recent-matches-v2?user_id=22&limit=5

const express = require('express');
const router = express.Router();
const pool = require('../db');

const toInt = (v, def = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

const norm = (s) => (s ?? '').toString().trim();
const toLowerTrim = (s) => norm(s).toLowerCase();

// Winner text may be "India won the match!", "India won the match by 10 runs", etc.
function didWinnerContainAnyTeam(winnerText, teamNamesLower) {
  if (!winnerText) return false;
  const w = winnerText.toLowerCase();
  return teamNamesLower.some((t) => t && w.includes(t));
}

router.get('/user-recent-matches-v2', async (req, res) => {
  try {
    const userId = toInt(req.query.user_id);
    const limit = Math.min(Math.max(toInt(req.query.limit, 5), 1), 20); // 1..20

    if (!userId) {
      return res.status(400).json({ error: 'Missing or invalid user_id' });
    }

    // 1) Pull distinct teams this user has in players table
    const teamRes = await pool.query(
      `SELECT DISTINCT LOWER(TRIM(team_name)) AS team_key
       FROM players
       WHERE user_id = $1 AND team_name IS NOT NULL AND TRIM(team_name) <> ''`,
      [userId]
    );
    if (teamRes.rowCount === 0) {
      return res.json([]); // No teams → no matches
    }
    const userTeamsLower = teamRes.rows.map((r) => r.team_key);

    // 2) Fetch most recent matches from match_history where user's teams participated
    //    Keep it simple and fast; we grab 3×limit and slice later to account for both sides.
    const take = Math.max(limit * 3, limit); // small cushion
    const matchRes = await pool.query(
      `
      SELECT
        id,
        match_name,
        match_type,
        team1, team2,
        runs1, runs2, wickets1, wickets2,
        winner,
        match_time
      FROM match_history
      WHERE LOWER(TRIM(team1)) = ANY($1) OR LOWER(TRIM(team2)) = ANY($1)
      ORDER BY match_time DESC
      LIMIT $2
      `,
      [userTeamsLower, take]
    );

    // 3) Shape rows for UI
    const matches = matchRes.rows.slice(0, limit).map((row) => {
      const t1 = toLowerTrim(row.team1);
      const userIsTeam1 = userTeamsLower.includes(t1);
      const opponent = userIsTeam1 ? row.team2 : row.team1;

      let result = 'Lost';
      if (!norm(row.winner)) {
        result = 'Draw';
      } else if (didWinnerContainAnyTeam(row.winner, userTeamsLower)) {
        result = 'Won';
      }

      return {
        match_id: row.id,
        match_name: row.match_name,
        match_type: row.match_type,
        opponent,
        result, // "Won" | "Lost" | "Draw"
        match_time: row.match_time,
        runs: userIsTeam1 ? row.runs1 : row.runs2,
        wickets: userIsTeam1 ? row.wickets1 : row.wickets2,
      };
    });

    res.json(matches);
  } catch (err) {
    console.error('❌ Recent matches V2 error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
