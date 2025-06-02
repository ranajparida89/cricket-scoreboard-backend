// ✅ routes/userDashboardRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../db'); // Your DB connection

/**
 * GET /api/user-dashboard-stats
 * Query params: user_id (required), match_type (ODI/T20/Test/All, default All)
 */
router.get('/user-dashboard-stats', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    const matchType = req.query.match_type ? req.query.match_type : 'All';

    if (!userId) {
      return res.status(400).json({ error: "Missing or invalid user_id" });
    }

    // --- Validate match type ---
    const validTypes = ['ODI', 'T20', 'Test', 'All'];
    if (!validTypes.includes(matchType)) {
      return res.status(400).json({ error: "Invalid match_type" });
    }

    // --- Find all player_ids for this user ---
    const playerRes = await pool.query(
      'SELECT id, team_name FROM players WHERE user_id = $1',
      [userId]
    );
    if (playerRes.rowCount === 0) {
      return res.json({
        matches_played: 0,
        matches_won: 0,
        matches_lost: 0,
        matches_draw: 0,
        total_runs: 0,
        total_wickets: 0,
      });
    }

    const playerIds = playerRes.rows.map(r => r.id);
    const userTeams = [...new Set(playerRes.rows.map(r => r.team_name))]; // unique list

    // --- Prepare dynamic SQL for player_performance ---
    let statsQuery = `
      SELECT
        COUNT(*) AS matches_played,
        SUM(run_scored) AS total_runs,
        SUM(wickets_taken) AS total_wickets
      FROM player_performance
      WHERE player_id = ANY($1)
    `;
    let statsParams = [playerIds];

    if (matchType !== 'All') {
      statsQuery += ' AND match_type = $2';
      statsParams.push(matchType);
    }

    // --- Run main stats query ---
    const statsRes = await pool.query(statsQuery, statsParams);
    const stats = statsRes.rows[0];

    // --- Calculate matches_won, matches_lost: using match_history results ---
    // 1. Get all matches where user's teams played and which team won
    // --- Unify ALL match records (ODI/T20/Test) where user's teams played ---
let matchQuery = `
  SELECT id, winner, team1, team2, match_type FROM match_history
  WHERE (team1 = ANY($1) OR team2 = ANY($1))
  ${matchType !== 'All' ? 'AND match_type = $2' : ''}
  UNION ALL
  SELECT id, winner, team1, team2, match_type FROM test_match_results
  WHERE (team1 = ANY($1) OR team2 = ANY($1))
  ${matchType === 'Test' ? 'AND match_type = $2' : matchType !== 'All' ? 'AND 1=0' : ''}
`;
let matchParams = [userTeams];
if (matchType !== 'All') matchParams.push(matchType);

const matchRes = await pool.query(matchQuery, matchParams);

// --- Now count played/won/lost/draw from unified matches ---
const matches_played = matchRes.rowCount;
let matches_won = 0, matches_lost = 0, matches_draw = 0;
for (const row of matchRes.rows) {
  if (!row.winner || row.winner === '') matches_draw++;
  else if (userTeams.includes(row.winner)) matches_won++;
  else matches_lost++;
}


    // --- Return the dashboard stats ---
    const result = {
      matches_played: parseInt(stats.matches_played, 10) || 0,
      matches_won,
      matches_lost,
      matches_draw: draws,
      total_runs: parseInt(stats.total_runs, 10) || 0,
      total_wickets: parseInt(stats.total_wickets, 10) || 0,
    };

    console.log("Returning stats for user:", userId, "=>", result);

    return res.json(result); // <-- This is CRUCIAL

  } catch (err) {
    console.error("❌ User dashboard stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

