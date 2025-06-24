const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/top-performer?user_id=23&period=month&match_type=Test&team_name=England
router.get('/top-performer', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    const period = req.query.period || 'month';
    const matchType = req.query.match_type || 'All';
    let teamName = req.query.team_name || null;

    if (!userId) return res.status(400).json({ error: 'Missing or invalid user_id' });

    // ---------- For TEST MATCHES: Aggregate all runs by player across all teams ----------
    if (matchType === 'Test') {
      // Optionally filter by teamName (if passed)
      let teamFilter = '';
      let params = [userId];

      if (teamName) {
        teamFilter = `AND LOWER(rp.team_name) = LOWER($2)`;
        params.push(teamName);
      }

      // Main query: aggregate per player, get the top run(s)
      // Returns all tied top scorers (if any)
      const sql = `
        WITH player_agg AS (
          SELECT
            p.player_name,
            SUM(rp.run_scored) AS total_runs,
            SUM(rp.wickets_taken) AS total_wickets,
            SUM(rp.fifties) AS total_fifties,
            SUM(rp.hundreds) AS total_hundreds,
            COUNT(*) AS innings,
            SUM(CASE WHEN COALESCE(rp.dismissed, '') ILIKE '%out%' THEN 1 ELSE 0 END) AS outs,
            SUM(rp.runs_given) AS total_runs_given,
            SUM(rp.balls_faced) AS total_balls_faced
          FROM player_performance rp
          JOIN players p ON rp.player_id = p.id
          WHERE p.user_id = $1
            AND rp.match_type = 'Test'
            ${teamFilter}
          GROUP BY p.player_name
        ),
        max_run AS (
          SELECT MAX(total_runs) AS max_runs FROM player_agg
        )
        SELECT
          pa.player_name,
          'Test' AS match_type,
          pa.total_runs,
          pa.total_wickets,
          pa.total_fifties,
          pa.total_hundreds,
          pa.innings,
          pa.outs,
          CASE
            WHEN pa.outs > 0 THEN ROUND(pa.total_runs::numeric / pa.outs, 2)
            ELSE NULL
          END AS batting_avg,
          pa.total_runs_given,
          CASE
            WHEN pa.total_wickets > 0 THEN ROUND(pa.total_runs_given::numeric / pa.total_wickets, 2)
            ELSE NULL
          END AS bowling_avg,
          CASE
            WHEN pa.total_balls_faced > 0 THEN ROUND(pa.total_runs::numeric * 100 / pa.total_balls_faced, 2)
            ELSE NULL
          END AS strike_rate
        FROM player_agg pa
        JOIN max_run mr ON pa.total_runs = mr.max_runs
        ORDER BY pa.player_name;   -- deterministic order if tied
      `;

      const result = await pool.query(sql, params);

      if (!result.rows.length) return res.json({ performers: [] });

      // Add MVP badge info for each performer (all tied players)
      const performers = result.rows.map(p => ({
        ...p,
        mvp_badge: period === 'month'
      }));
      return res.json({ performers });
    }

    // ---------- FOR ODI/T20/All: (No change) ----------
    let params = [userId];
    let whereClauses = ['p.user_id = $1', 'rp.match_id IS NOT NULL'];
    let paramIdx = 2;

    if (teamName) {
      teamName = teamName.trim();
      whereClauses.push(`LOWER(rp.team_name) = LOWER($${paramIdx})`);
      params.push(teamName);
      paramIdx++;
    }

    if (matchType && matchType !== 'All') {
      whereClauses.push(`rp.match_type = $${paramIdx}`);
      params.push(matchType);
      paramIdx++;
    }

    if (period === 'month' && matchType !== 'Test') {
      whereClauses.push(`rp.created_at >= NOW() - INTERVAL '30 days'`);
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
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY p.player_name, rp.match_type, rp.team_name
      ORDER BY total_runs DESC
      LIMIT 1
    `;

    let result = await pool.query(sql, params);

    if (!result.rows.length) return res.json({ performers: [] });

    const performers = result.rows.map(p => ({
      ...p,
      mvp_badge: period === 'month'
    }));
    return res.json({ performers });

  } catch (err) {
    console.error('❌ Top Performer API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
