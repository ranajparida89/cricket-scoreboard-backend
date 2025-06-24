  const express = require('express');
  const router = express.Router();
  const pool = require('../db');

  // GET /api/top-performer?user_id=23&period=month&match_type=Test&team_name=England
  router.get('/top-performer', async (req, res) => {
    try {
      const userId = parseInt(req.query.user_id, 10);
      const period = req.query.period || 'month';
      const limit = parseInt(req.query.limit, 10) || 5;
      const matchType = req.query.match_type || 'All';
      let teamName = req.query.team_name || null;

      if (!userId) return res.status(400).json({ error: 'Missing or invalid user_id' });

      let params = [userId];
      let whereClauses = ['p.user_id = $1', 'rp.match_id IS NOT NULL'];
      let paramIdx = 2;

      // Team name filter (case-insensitive)
      if (teamName) {
        teamName = teamName.trim();
        whereClauses.push(`LOWER(rp.team_name) = LOWER($${paramIdx})`);
        params.push(teamName);
        paramIdx++;
      }

      // Match type filter
      if (matchType && matchType !== 'All') {
        whereClauses.push(`rp.match_type = $${paramIdx}`);
        params.push(matchType);
        paramIdx++;
      }

      // For ODI/T20 only, apply period filter (NOT for Test)
      if (period === 'month' && matchType !== 'Test') {
        whereClauses.push(`rp.created_at >= NOW() - INTERVAL '30 days'`);
      }

      // Primary Query
    const sql = `
    SELECT
      p.player_name,
      rp.match_type,
      rp.team_name,                                -- ADD this!
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
    GROUP BY p.player_name, rp.match_type, rp.team_name    -- ADD team_name to group by!
    ORDER BY total_runs DESC
    LIMIT 1
  `;

      let result = await pool.query(sql, params);

      // ============= HARD CODED TEST MATCH FALLBACK ============
      // If no result for Test (even after all filters), do a minimal fallback query for Test only
     // ============= UPDATED TEST MATCH FALLBACK ============
if ((!result.rows.length) && matchType === 'Test') {
  const sqlTest = `
    SELECT 
      p.player_name,
      agg.match_type,
      SUM(agg.total_runs) AS total_runs,
      SUM(agg.total_wickets) AS total_wickets,
      SUM(agg.total_fifties) AS total_fifties,
      SUM(agg.total_hundreds) AS total_hundreds
    FROM players p
    JOIN (
        SELECT 
            player_id,
            match_type,
            SUM(run_scored) AS total_runs,
            SUM(wickets_taken) AS total_wickets,
            SUM(fifties) AS total_fifties,
            SUM(hundreds) AS total_hundreds
        FROM player_performance
        WHERE match_type = 'Test'
        GROUP BY player_id, match_type
    ) agg ON agg.player_id = p.id
    WHERE p.user_id = $1
    GROUP BY p.player_name, agg.match_type
    ORDER BY SUM(agg.total_runs) DESC
    LIMIT 1
  `;
  result = await pool.query(sqlTest, [userId]);
}
// =========== END TEST FALLBACK ============
 // =========== END TEST FALLBACK ============

      if (!result.rows.length) return res.json({ performer: null });

      const performer = result.rows[0];
      performer.mvp_badge = period === 'month';
      res.json({ performer });

    } catch (err) {
      console.error('❌ Top Performer API error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  module.exports = router;
