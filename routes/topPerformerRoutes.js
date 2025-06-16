const express = require('express');
const router = express.Router();
const pool = require('../db');

// =======================
// GET /api/top-performer?user_id=...&period=...&limit=...&match_type=...&team_name=...
// This route returns the top performer (by total runs) for the given user, match type, team and period
// =======================
router.get('/top-performer', async (req, res) => {
  try {
    // 1. Parse query parameters from the request
    const userId = parseInt(req.query.user_id, 10);
    const period = req.query.period || 'month'; // Default to 'month'
    const limit = parseInt(req.query.limit, 10) || 5;
    const matchType = req.query.match_type || 'All';
    const teamName = req.query.team_name; // Can be undefined/null

    // 2. Validate required params
    if (!userId) return res.status(400).json({ error: 'Missing or invalid user_id' });

    // 3. Prepare SQL parameters and WHERE conditions
    let params = [userId];
    let whereClauses = ['p.user_id = $1', 'rp.match_id IS NOT NULL'];
    let paramIdx = 2;

    // 4. Add period filter (last 30 days), except for Test
    if (period === 'month' && matchType !== 'Test') {
      whereClauses.push(`rp.created_at >= NOW() - INTERVAL '30 days'`);
    }

    // 5. If match_type supplied and not "All", filter it
    if (matchType && matchType !== 'All') {
      whereClauses.push(`rp.match_type = $${paramIdx}`);
      params.push(matchType);
      paramIdx++;
    }

    // 6. If team_name supplied, filter by it (case-insensitive)
    if (teamName) {
      whereClauses.push(`LOWER(TRIM(p.team_name)) = LOWER(TRIM($${paramIdx}))`);
      params.push(teamName);
      paramIdx++;
    }

    // 7. SQL Query - exactly your working version, just dynamic WHERE
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
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY p.player_name, rp.match_type
      ORDER BY total_runs DESC
      LIMIT 1
    `;

    // 8. Run the query with parameters
    const result = await pool.query(sql, params);
    if (!result.rows.length) return res.json({ performer: null });

    // 9. Attach MVP badge if querying for a month
    const performer = result.rows[0];
    performer.mvp_badge = period === 'month';

    res.json({ performer });
  } catch (err) {
    console.error('❌ Top Performer API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
