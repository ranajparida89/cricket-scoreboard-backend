// routes/topPerformerRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/top-performer?user_id=22&period=month&limit=5
router.get('/top-performer', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    const period = req.query.period || 'month';
    const limit = parseInt(req.query.limit, 10) || 5;

    if (!userId) return res.status(400).json({ error: 'Missing or invalid user_id' });

    let cte = '';
    let whereClause = `p.user_id = $1 AND pp.match_id IS NOT NULL`;
    let params = [userId];

    // Use different CTEs for "month" and "matches"
    if (period === 'matches') {
      cte = `
        WITH recent_performance AS (
          SELECT pp.*, ROW_NUMBER() OVER (PARTITION BY pp.player_id ORDER BY pp.created_at DESC) AS rn
          FROM player_performance pp
          JOIN players p ON pp.player_id = p.id
          WHERE p.user_id = $1 AND pp.match_id IS NOT NULL
        )
      `;
      whereClause = `rp.rn <= $2`;
      params.push(limit);
    } else if (period === 'month') {
      cte = `
        WITH recent_performance AS (
          SELECT pp.*
          FROM player_performance pp
          JOIN players p ON pp.player_id = p.id
          WHERE p.user_id = $1 AND pp.match_id IS NOT NULL
            AND pp.created_at >= NOW() - INTERVAL '30 days'
        )
      `;
      whereClause = '1=1'; // Use all recent_performance rows
    }

    // Main Query
    const sql = `
      ${cte}
      SELECT
        p.player_name,
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
      FROM ${period === 'matches' ? 'recent_performance rp' : 'recent_performance rp'}
      JOIN players p ON rp.player_id = p.id
      ${period === 'matches' ? `WHERE ${whereClause}` : ''}
      GROUP BY p.player_name
      ORDER BY total_runs DESC
      LIMIT 1;
    `;

    const result = await pool.query(sql, params);
    if (!result.rows.length) return res.json({ performer: null });

    // Mark badge if month
    const performer = result.rows[0];
    performer.mvp_badge = period === 'month' ? true : false;

    res.json({ performer });
  } catch (err) {
    console.error('❌ Top Performer API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
