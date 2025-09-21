// routes/userTeamsRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/user-teams?user_id=123
 * Returns: { teams: ["England", "India", ...] }
 *
 * Notes:
 * - Reads distinct team names from the `players` table for this user.
 * - Ignores null/blank names. Returns an empty array if none found.
 */
router.get('/user-teams', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    if (!userId) {
      return res.status(400).json({ error: 'Missing or invalid user_id' });
    }

    const sql = `
      SELECT DISTINCT team_name
      FROM players
      WHERE user_id = $1
        AND team_name IS NOT NULL
        AND TRIM(team_name) <> ''
      ORDER BY team_name ASC
    `;
    const { rows } = await pool.query(sql, [userId]);

    // Return team names exactly as stored (so they match other queries)
    const teams = rows.map(r => r.team_name);
    res.json({ teams });
  } catch (err) {
    console.error('❌ user-teams route error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
