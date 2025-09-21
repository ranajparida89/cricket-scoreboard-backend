// routes/topPerformerRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/top-performer?user_id=23&period=month&match_type=Test&team_name=England
router.get('/top-performer', async (req, res) => {
  try {
    const userId = Number.parseInt(req.query.user_id, 10);
    const period = (req.query.period || 'month').toLowerCase(); // 'month'|'all' etc.
    const matchType = req.query.match_type || 'All';
    const limit = Number.parseInt(req.query.limit, 10) || 5;
    let teamName = (req.query.team_name || '').trim();

    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ error: 'Missing or invalid user_id' });
    }

    // Guard period to known values (optional)
    const VALID_PERIODS = new Set(['month', 'all']);
    const usePeriod = VALID_PERIODS.has(period) ? period : 'month';

    // ========= TEST MATCH BRANCH =========
    if (matchType === 'Test') {
      // Note: teamName is optional
      const sql = `
        SELECT 
          p.player_name,
          'Test' AS match_type,
          pp.team_name,
          SUM(pp.run_scored) AS total_runs,
          COUNT(*) AS innings,
          SUM(CASE WHEN COALESCE(pp.dismissed, '') ILIKE '%out%' THEN 1 ELSE 0 END) AS outs,
          CASE 
            WHEN SUM(CASE WHEN COALESCE(pp.dismissed, '') ILIKE '%out%' THEN 1 ELSE 0 END) > 0
              THEN ROUND(SUM(pp.run_scored)::numeric / SUM(CASE WHEN COALESCE(pp.dismissed, '') ILIKE '%out%' THEN 1 ELSE 0 END), 2)
            ELSE NULL
          END AS batting_avg,
          SUM(pp.wickets_taken) AS total_wickets,
          SUM(pp.runs_given) AS total_runs_given,
          CASE 
            WHEN SUM(pp.wickets_taken) > 0 
              THEN ROUND(SUM(pp.runs_given)::numeric / SUM(pp.wickets_taken), 2)
            ELSE NULL
          END AS bowling_avg,
          SUM(pp.balls_faced) AS total_balls_faced,
          CASE
            WHEN SUM(pp.balls_faced) > 0
              THEN ROUND(SUM(pp.run_scored)::numeric * 100 / SUM(pp.balls_faced), 2)
            ELSE NULL
          END AS strike_rate
        FROM player_performance pp
        JOIN players p ON pp.player_id = p.id
        WHERE pp.match_type = 'Test'
          AND p.user_id = $1
          ${teamName ? `AND LOWER(TRIM(pp.team_name)) = LOWER(TRIM($2))` : ''}
        GROUP BY p.player_name, pp.team_name
        ORDER BY SUM(pp.run_scored) DESC
        LIMIT 1
      `;

      const params = teamName ? [userId, teamName] : [userId];
      const { rows } = await pool.query(sql, params);
      if (!rows.length) return res.json({ performer: null });

      const performer = rows[0];
      performer.mvp_badge = usePeriod === 'month';
      return res.json({ performer });
    }

    // ========= ODI / T20 / All =========
    const where = ['p.user_id = $1'];
    const params = [userId];
    let idx = 2;

    if (teamName) {
      where.push(`LOWER(TRIM(rp.team_name)) = LOWER(TRIM($${idx}))`);
      params.push(teamName);
      idx++;
    }

    if (matchType && matchType !== 'All') {
      where.push(`rp.match_type = $${idx}`);
      params.push(matchType);
      idx++;
    }

    // Apply period only for non-Test (kept from your logic)
    if (usePeriod === 'month') {
      where.push(`rp.created_at >= NOW() - INTERVAL '30 days'`);
    }

    const sql = `
      SELECT
        p.player_name,
        rp.match_type,
        rp.team_name,
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
      WHERE ${where.join(' AND ')}
      GROUP BY p.player_name, rp.match_type, rp.team_name
      ORDER BY total_runs DESC
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, params);
    if (!rows.length) return res.json({ performer: null });

    const performer = rows[0];
    performer.mvp_badge = usePeriod === 'month';
    res.json({ performer });
  } catch (err) {
    console.error('❌ Top Performer API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
