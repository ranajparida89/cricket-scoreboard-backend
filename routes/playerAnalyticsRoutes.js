// routes/playerAnalyticsRoutes.js
// Player Trends: per-match timeline + per-opponent summary
const express = require("express");
const router = express.Router();
const pool = require("../db");

const normType = v => String(v || "ALL").toUpperCase();

/* Per-match time series with MA(5) */
router.get("/trend", async (req, res) => {
  try {
    const player = String(req.query.player || "").trim();
    const type = normType(req.query.type);
    const opponent = (req.query.opponent || "ALL").trim();
    const metric = (req.query.metric || "runs").trim().toLowerCase();
    if (!player) return res.status(400).json({ error: "player required" });

    const seriesSql = `
      WITH m AS (
        SELECT match_name, LOWER(TRIM(match_type)) AS mt, team1, team2, created_at FROM match_history
        UNION ALL
        SELECT match_name, 'test' AS mt, team1, team2, created_at FROM test_match_results
      ),
      raw AS (
        SELECT
          pp.match_name,
          COALESCE(m.created_at, pp.created_at, to_timestamp(pp.id)) AS evt_time,
          UPPER(m.mt) AS match_type,
          CASE WHEN LOWER(TRIM(pp.team_name)) = LOWER(TRIM(m.team1)) THEN m.team2 ELSE m.team1 END AS opponent,
          SUM(pp.run_scored)    AS runs,
          SUM(pp.balls_faced)   AS balls_faced,
          SUM(pp.wickets_taken) AS wickets,
          SUM(pp.runs_given)    AS runs_given,
          SUM(CASE WHEN COALESCE(pp.dismissed,'') ILIKE '%out%' THEN 1 ELSE 0 END) AS outs
        FROM player_performance pp
        JOIN players p ON p.id = pp.player_id
        JOIN m ON m.match_name = pp.match_name
        WHERE p.player_name = $1
          AND ($2='ALL' OR UPPER(m.mt)=$2)
        GROUP BY pp.match_name, evt_time, match_type, opponent
      ),
      cooked AS (
        SELECT *,
          CASE WHEN outs>0 THEN (runs::numeric/outs) ELSE NULL END AS batting_avg,
          CASE WHEN balls_faced>0 THEN (runs::numeric*100/balls_faced) ELSE NULL END AS strike_rate,
          CASE WHEN wickets>0 THEN (runs_given::numeric/wickets) ELSE NULL END AS bowling_avg
        FROM raw
      ),
      with_metric AS (
        SELECT
          match_name, evt_time, match_type, opponent, runs, balls_faced, wickets, runs_given,
          batting_avg, strike_rate, bowling_avg,
          CASE
            WHEN $3='runs'        THEN runs::numeric
            WHEN $3='batting_avg' THEN batting_avg
            WHEN $3='strike_rate' THEN strike_rate
            WHEN $3='wickets'     THEN wickets::numeric
            WHEN $3='bowling_avg' THEN bowling_avg
            ELSE runs::numeric
          END AS metric_value
        FROM cooked
        WHERE ($4='ALL' OR LOWER(TRIM(opponent))=LOWER($4))
      )
      SELECT
        match_name, match_type, opponent, metric_value,
        ROUND(AVG(metric_value) OVER (ORDER BY evt_time ROWS BETWEEN 4 PRECEDING AND CURRENT ROW)::numeric, 2) AS ma5,
        evt_time
      FROM with_metric
      ORDER BY evt_time ASC
    `;
    const r = await pool.query(seriesSql, [player, type, metric, opponent]);
    res.json({ series: r.rows || [] });
  } catch (e) {
    console.error("players/trend:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/* Per-opponent aggregates for bars + overall */
router.get("/opponent-summary", async (req, res) => {
  try {
    const player = String(req.query.player || "").trim();
    const type = normType(req.query.type);
    if (!player) return res.status(400).json({ error: "player required" });

    const sql = `
      WITH m AS (
        SELECT match_name, LOWER(TRIM(match_type)) AS mt, team1, team2 FROM match_history
        UNION ALL
        SELECT match_name, 'test' AS mt, team1, team2 FROM test_match_results
      ),
      raw AS (
        SELECT
          CASE WHEN LOWER(TRIM(pp.team_name))=LOWER(TRIM(m.team1)) THEN m.team2 ELSE m.team1 END AS opponent,
          UPPER(m.mt) AS match_type,
          SUM(pp.run_scored)    AS runs,
          SUM(pp.balls_faced)   AS balls_faced,
          SUM(pp.wickets_taken) AS wickets,
          SUM(pp.runs_given)    AS runs_given,
          SUM(CASE WHEN COALESCE(pp.dismissed,'') ILIKE '%out%' THEN 1 ELSE 0 END) AS outs,
          COUNT(*) AS inns
        FROM player_performance pp
        JOIN players p ON p.id=pp.player_id
        JOIN m ON m.match_name=pp.match_name
        WHERE p.player_name=$1 AND ($2='ALL' OR UPPER(m.mt)=$2)
        GROUP BY opponent, match_type
      )
      SELECT
        opponent,
        SUM(runs) AS runs, SUM(balls_faced) AS balls_faced,
        SUM(wickets) AS wickets, SUM(runs_given) AS runs_given,
        SUM(outs) AS outs, SUM(inns) AS inns,
        CASE WHEN SUM(outs)>0 THEN ROUND(SUM(runs)::numeric/SUM(outs),2) ELSE NULL END AS batting_avg,
        CASE WHEN SUM(balls_faced)>0 THEN ROUND(SUM(runs)::numeric*100/SUM(balls_faced),2) ELSE NULL END AS strike_rate,
        CASE WHEN SUM(wickets)>0 THEN ROUND(SUM(runs_given)::numeric/SUM(wickets),2) ELSE NULL END AS bowling_avg
      FROM raw
      GROUP BY opponent
      ORDER BY runs DESC NULLS LAST
    `;
    const r = await pool.query(sql, [player, type]);

    const overall = r.rows.reduce((a, x) => ({
      runs: a.runs + Number(x.runs || 0),
      balls_faced: a.balls_faced + Number(x.balls_faced || 0),
      wickets: a.wickets + Number(x.wickets || 0),
      runs_given: a.runs_given + Number(x.runs_given || 0),
      outs: a.outs + Number(x.outs || 0),
    }), { runs:0, balls_faced:0, wickets:0, runs_given:0, outs:0 });

    const overallStats = {
      batting_avg: overall.outs ? +(overall.runs / overall.outs).toFixed(2) : null,
      strike_rate: overall.balls_faced ? +((overall.runs * 100) / overall.balls_faced).toFixed(2) : null,
      bowling_avg: overall.wickets ? +(overall.runs_given / overall.wickets).toFixed(2) : null
    };

    res.json({ opponents: r.rows || [], overall: overallStats });
  } catch (e) {
    console.error("players/opponent-summary:", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
