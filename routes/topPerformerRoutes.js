const express = require('express');
const router = express.Router();
const pool = require('../db');

// =======================
// GET /api/top-performer?user_id=22&period=month&limit=5&match_type=ODI
// This route returns the top performer (by total runs) for the given user, match type, and period
// =======================
router.get('/top-performer', async (req, res) => {
  try {
    // 1. Parse query parameters from the request
    const userId = parseInt(req.query.user_id, 10);
    const period = req.query.period || 'month'; // Default to 'month'
    const limit = parseInt(req.query.limit, 10) || 5; // Default to 5 (only for 'matches' period)
    const matchType = req.query.match_type || 'All'; // Default to 'All'

    // 2. Validate required params
    if (!userId) return res.status(400).json({ error: 'Missing or invalid user_id' });

    // 3. Prepare SQL parameters and WHERE conditions
    let params = [userId]; // $1 is always userId
    let whereClauses = ['p.user_id = $1', 'rp.match_id IS NOT NULL']; // Only fetch records for this user
    let paramIdx = 2;

    // 4. Add a date filter for monthly period (EXCEPT for Test matches)
    if (period === 'month' && matchType !== 'Test') {
      whereClauses.push(`rp.created_at >= NOW() - INTERVAL '30 days'`);
    }

    // 5. If a specific match type is selected, add to WHERE and params
    if (matchType && matchType !== 'All') {
      whereClauses.push(`rp.match_type = $${paramIdx}`);
      params.push(matchType);
      paramIdx++;
    }

    // 6. Build the SQL query
    const sql = `
      SELECT
        p.player_name,
        rp.match_type,
        SUM(rp.run_scored) AS total_runs,
        COUNT(*) AS innings,
        SUM(CASE WHEN COALESCE(rp.dismissed, '') ILIKE '%out%' THEN 1 ELSE 0 END) AS outs,
        CASE
          WHEN SUM(CASE WHEN COALESCE(rp.dismissed, '') ILIKE '%out%' THEN 1 ELSE 0 END) > 0
            THEN ROUND(SUM(rp.run_scored)::numeric / SUM(CASE WHEN COALESCE(rp.dismissed, '') ILIKE '%out%' THEN 1 ELSE 0 END), 2)
          ELSE NULL
        END AS batting_avg,
        SUM(rp.wickets_taken) AS total_wickets,
        SUM(rp.runs_given) AS total_runs_given,
        CASE
          WHEN SUM(rp.wickets_taken) > 0
            THEN ROUND(SUM(rp.runs_given)::numeric / SUM(rp.wickets_taken), 2)
          ELSE NULL
        END AS bowling_avg,
        CASE
          WHEN SUM(rp.balls_faced) > 0
            THEN ROUND(SUM(rp.run_scored)::numeric * 100 / SUM(rp.balls_faced), 2)
          ELSE NULL
        END AS strike_rate
      FROM player_performance rp
      JOIN players p ON rp.player_id = p.id
      WHERE ${whereClauses.join(' AND ')} -- <<<<<<<< This line always filters by user_id
      GROUP BY p.player_name, rp.match_type
      ORDER BY total_runs DESC
      LIMIT 1
    `;

    // 7. Run the query with the parameters
    const result = await pool.query(sql, params);
    if (!result.rows.length) return res.json({ performer: null });

    // 8. Attach MVP badge if querying for a month
    const performer = result.rows[0];
    performer.mvp_badge = period === 'month' ? true : false;

    // 9. Return result
    res.json({ performer });
  } catch (err) {
    console.error('❌ Top Performer API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
