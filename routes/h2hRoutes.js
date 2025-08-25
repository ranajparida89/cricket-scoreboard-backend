// routes/h2hRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ---------------- Helpers ---------------- */
const toTitle = (s = "") => s.toLowerCase().replace(/\b\w/g, m => m.toUpperCase());
const nz = v => (v == null ? 0 : Number(v));
const nor = s => (s || "").trim().toLowerCase();
const isDrawish = w =>
  !w || w.includes("draw") || w.includes("tie") || w.includes("no result") || w.includes("abandon");

// Escape regex special chars + whole-word check for winner name matching
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordHit = (winner, teamName) => {
  if (!winner || !teamName) return false;
  const re = new RegExp(`\\b${reEsc(teamName)}\\b`, "i");
  return re.test(winner);
};

/* ---------------- Teams ---------------- */
router.get("/teams", async (_req, res) => {
  try {
    const q = `
      SELECT DISTINCT team FROM (
        SELECT LOWER(TRIM(team1)) AS team FROM match_history
        UNION ALL SELECT LOWER(TRIM(team2)) AS team FROM match_history
        UNION ALL SELECT LOWER(TRIM(team1)) AS team FROM test_match_results
        UNION ALL SELECT LOWER(TRIM(team2)) AS team FROM test_match_results
      ) x
      WHERE team IS NOT NULL AND team <> ''
      ORDER BY team
    `;
    const r = await pool.query(q);
    res.json([...new Set(r.rows.map(v => toTitle(v.team)))]);
  } catch (e) {
    console.error("teams:", e);
    res.status(500).json({ error: "Failed to fetch team names" });
  }
});

/* ---------------- Summary ---------------- */
router.get("/summary", async (req, res) => {
  const { team1, team2, type } = req.query;
  if (!team1 || !team2 || !type || team1.toLowerCase() === team2.toLowerCase()) {
    return res.status(400).json({ error: "Provide two different teams and a match type" });
  }

  try {
    const t1 = team1.trim(), t2 = team2.trim(), up = String(type).toUpperCase();

    const pair = `
      (
        (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
        (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
      )
    `;

    let sql, params = [t1, t2];

    if (up === "TEST") {
      sql = `SELECT winner FROM test_match_results WHERE ${pair}`;
    } else if (up === "ODI" || up === "T20") {
      sql = `SELECT winner FROM match_history WHERE ${pair} AND LOWER(TRIM(match_type))=LOWER($3)`;
      params.push(up);
    } else {
      // ALL formats: ODI + T20 from match_history, plus Test from test_match_results
      sql = `
        SELECT winner FROM match_history
        WHERE ${pair} AND LOWER(TRIM(match_type)) IN('odi','t20')
        UNION ALL
        SELECT winner FROM test_match_results
        WHERE ${pair}
      `;
      params = [t1, t2];
    }

    const r = await pool.query(sql, params);

    let t1w = 0, t2w = 0, d = 0;
    for (const row of r.rows) {
      const w = nor(row.winner);
      if (isDrawish(w)) d++;
      else if (wordHit(w, t1)) t1w++;
      else if (wordHit(w, t2)) t2w++;
    }

    const total = r.rowCount;
    res.json({
      total_matches: total,
      [t1]: t1w,
      [t2]: t2w,
      draws: d,
      win_percentage_team1: total ? Math.round((t1w / total) * 100) : 0,
      win_percentage_team2: total ? Math.round((t2w / total) * 100) : 0,
    });
  } catch (e) {
    console.error("summary:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ---------------- Wins by format ---------------- */
router.get("/by-format", async (req, res) => {
  const { team1, team2 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = team1.trim(), t2 = team2.trim();
    const q = `
      WITH pair AS (
        SELECT team1,team2,winner, LOWER(TRIM(match_type)) AS match_type
        FROM match_history
        WHERE (
          (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
          (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
        ) AND LOWER(TRIM(match_type)) IN ('odi','t20')
        UNION ALL
        SELECT team1,team2,winner, 'test' AS match_type
        FROM test_match_results
        WHERE (
          (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
          (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
        )
      )
      SELECT UPPER(match_type) AS match_type,
             SUM(CASE WHEN winner ILIKE '%'||$1||'%' THEN 1 ELSE 0 END) AS t1_wins,
             SUM(CASE WHEN winner ILIKE '%'||$2||'%' THEN 1 ELSE 0 END) AS t2_wins,
             SUM(CASE WHEN winner IS NULL OR winner ILIKE '%draw%' OR winner ILIKE '%tie%' OR winner ILIKE '%no result%' THEN 1 ELSE 0 END) AS draws
      FROM pair
      GROUP BY match_type
      ORDER BY match_type;
    `;
    const r = await pool.query(q, [t1, t2]);
    res.json(r.rows);
  } catch (e) {
    console.error("by-format:", e);
    res.status(500).json({ error: "Failed to compute by-format" });
  }
});

/* ---------------- Points ---------------- */
router.get("/points", async (req, res) => {
  const { team1, team2, type = "ALL" } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = team1.trim(), t2 = team2.trim(), up = String(type).toUpperCase();
    const pair = `
      (
        (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
        (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
      )
    `;
    const compute = (rows, fmt) => {
      let a = 0, b = 0, d = 0;
      for (const m of rows) {
        const w = nor(m.winner);
        if (isDrawish(w)) d++;
        else if (wordHit(w, t1)) a++;
        else if (wordHit(w, t2)) b++;
      }
      if (fmt === "TEST") return { t1: a * 12 + b * 6 + d * 4, t2: b * 12 + a * 6 + d * 4 };
      return { t1: a * 2 + d * 1, t2: b * 2 + d * 1 }; // ODI/T20
    };

    let total = { t1: 0, t2: 0 };
    const runOne = async (fmt) => {
      if (fmt === "TEST") {
        const r = await pool.query(`SELECT winner FROM test_match_results WHERE ${pair}`, [t1, t2]);
        const p = compute(r.rows || [], "TEST");
        total.t1 += p.t1; total.t2 += p.t2;
      } else {
        const r = await pool.query(
          `SELECT winner FROM match_history WHERE ${pair} AND LOWER(TRIM(match_type))=LOWER($3)`,
          [t1, t2, fmt]
        );
        const p = compute(r.rows || [], fmt.toUpperCase());
        total.t1 += p.t1; total.t2 += p.t2;
      }
    };

    if (up === "ALL") { await runOne("odi"); await runOne("t20"); await runOne("TEST"); }
    else if (up === "TEST") await runOne("TEST");
    else if (up === "ODI") await runOne("odi");
    else if (up === "T20") await runOne("t20");

    res.json({ t1_points: total.t1, t2_points: total.t2 });
  } catch (e) {
    console.error("points:", e);
    res.status(500).json({ error: "Failed to compute points" });
  }
});

/* ---------------- Runs by format ---------------- */
/*
 * IMPORTANT FIX:
 * Earlier this endpoint compared pp.match_name with an array of exact strings.
 * Because match_name strings differ in case/spacing across tables, ODI/TEST
 * returned []. We now normalize and JOIN on LOWER(TRIM(match_name)) so all
 * formats work reliably. Optional ?type=ODI|T20|TEST|ALL is honored.
 */
router.get("/runs-by-format", async (req, res) => {
  const { team1, team2 } = req.query;
  const upType = String(req.query.type || "ALL").toUpperCase();
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });

  try {
    const t1 = team1.trim();
    const t2 = team2.trim();

    const q = `
      WITH m AS (
        SELECT LOWER(TRIM(match_name)) AS match_name
        FROM match_history
        WHERE (
          (LOWER(TRIM(team1)) = LOWER($1) AND LOWER(TRIM(team2)) = LOWER($2)) OR
          (LOWER(TRIM(team1)) = LOWER($2) AND LOWER(TRIM(team2)) = LOWER($1))
        )
        UNION
        SELECT LOWER(TRIM(match_name)) AS match_name
        FROM test_match_results
        WHERE (
          (LOWER(TRIM(team1)) = LOWER($1) AND LOWER(TRIM(team2)) = LOWER($2)) OR
          (LOWER(TRIM(team1)) = LOWER($2) AND LOWER(TRIM(team2)) = LOWER($1))
        )
      )
      SELECT
        UPPER(TRIM(pp.match_type)) AS match_type,
        CASE WHEN LOWER(TRIM(pp.team_name)) = LOWER($1) THEN $1 ELSE $2 END AS team,
        SUM(pp.run_scored) AS runs
      FROM player_performance pp
      JOIN m ON LOWER(TRIM(pp.match_name)) = m.match_name
      WHERE LOWER(TRIM(pp.team_name)) IN (LOWER($1), LOWER($2))
        AND ($3 = 'ALL' OR UPPER(TRIM(pp.match_type)) = $3)
      GROUP BY match_type, team
      ORDER BY match_type, team;
    `;

    const r = await pool.query(q, [t1, t2, upType]);

    const out = {};
    for (const row of r.rows) {
      const mt = row.match_type;
      if (!out[mt]) out[mt] = { match_type: mt, [t1]: 0, [t2]: 0 };
      out[mt][row.team] = Number(row.runs || 0);
    }

    res.json(Object.values(out));
  } catch (e) {
    console.error("runs-by-format:", e);
    res.status(500).json({ error: "Failed to compute runs by format" });
  }
});

/* ---------------- Top Batters (paired-matches, case-insensitive types) ---------------- */
router.get("/top-batters", async (req, res) => {
  const { team1, team2, type = "ALL", limit = 8 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = String(team1).trim();
    const t2 = String(team2).trim();
    const up = String(type).toUpperCase();
    const lim = Number(limit) || 8;

    const sql = `
      WITH pp AS (
        SELECT TRIM(match_name) AS match_name,
               LOWER(TRIM(team_name)) AS team,
               player_id,
               SUM(run_scored) AS runs
        FROM player_performance
        WHERE ($3 = 'ALL' OR UPPER(TRIM(match_type)) = $3)
        GROUP BY TRIM(match_name), LOWER(TRIM(team_name)), player_id
      ),
      paired_matches AS (
        SELECT match_name
        FROM pp
        GROUP BY match_name
        HAVING SUM(CASE WHEN team = LOWER($1) THEN 1 ELSE 0 END) > 0
           AND SUM(CASE WHEN team = LOWER($2) THEN 1 ELSE 0 END) > 0
      )
      SELECT p.player_name, SUM(pp.runs) AS runs
      FROM pp
      JOIN paired_matches pm ON pm.match_name = pp.match_name
      JOIN players p        ON p.id = pp.player_id
      WHERE pp.team IN (LOWER($1), LOWER($2))
      GROUP BY p.player_name
      ORDER BY runs DESC
      LIMIT $4
    `;
    const r = await pool.query(sql, [t1, t2, up, lim]);
    res.json(r.rows || []);
  } catch (e) {
    console.error("top-batters:", e);
    res.status(500).json({ error: "Failed to compute top batters" });
  }
});

/* ---------------- Top Bowlers (avg; min 3 wkts; paired-matches) ---------------- */
router.get("/top-bowlers", async (req, res) => {
  const { team1, team2, type = "ALL", limit = 10, min_wkts = 3 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = String(team1).trim();
    const t2 = String(team2).trim();
    const up = String(type).toUpperCase();
    const lim = Number(limit) || 10;
    const min = Number(min_wkts) || 3;

    const sql = `
      WITH pp AS (
        SELECT TRIM(match_name) AS match_name,
               LOWER(TRIM(team_name)) AS team,
               player_id,
               SUM(wickets_taken) AS wkts,
               SUM(runs_given)    AS runs_given
        FROM player_performance
        WHERE ($3 = 'ALL' OR UPPER(TRIM(match_type)) = $3)
        GROUP BY TRIM(match_name), LOWER(TRIM(team_name)), player_id
      ),
      paired_matches AS (
        SELECT match_name
        FROM pp
        GROUP BY match_name
        HAVING SUM(CASE WHEN team = LOWER($1) THEN 1 ELSE 0 END) > 0
           AND SUM(CASE WHEN team = LOWER($2) THEN 1 ELSE 0 END) > 0
      ),
      agg AS (
        SELECT p.player_name,
               SUM(pp.wkts)       AS wkts,
               SUM(pp.runs_given) AS runs_given
        FROM pp
        JOIN paired_matches pm ON pm.match_name = pp.match_name
        JOIN players p        ON p.id = pp.player_id
        WHERE pp.team IN (LOWER($1), LOWER($2))
        GROUP BY p.player_name
      )
      SELECT player_name, wkts, runs_given,
             ROUND(CASE WHEN wkts > 0 THEN runs_given::numeric / wkts END, 2) AS bowl_avg
      FROM agg
      WHERE wkts >= $4
      ORDER BY bowl_avg ASC NULLS LAST, wkts DESC
      LIMIT $5
    `;
    const r = await pool.query(sql, [t1, t2, up, min, lim]);
    res.json(r.rows || []);
  } catch (e) {
    console.error("top-bowlers:", e);
    res.status(500).json({ error: "Failed to compute top bowlers" });
  }
});

/* ---------------- Test extras (safe fallbacks) ---------------- */
router.get("/test-innings-lead", async (req, res) => {
  const { team1, team2 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = team1.trim(), t2 = team2.trim();

    const q = `
      WITH inn1 AS (
        SELECT pp.match_name,
               LOWER(TRIM(pp.team_name)) AS team,
               SUM(pp.run_scored) AS runs
        FROM player_performance pp
        JOIN test_match_results t ON t.match_name = pp.match_name
        WHERE (
          (LOWER(TRIM(t.team1))=LOWER($1) AND LOWER(TRIM(t.team2))=LOWER($2)) OR
          (LOWER(TRIM(t.team1))=LOWER($2) AND LOWER(TRIM(t.team2))=LOWER($1))
        )
          AND pp.match_type ILIKE 'test'
          AND COALESCE(pp.innings,1) = 1
        GROUP BY pp.match_name, team
      ),
      per_match AS (
        SELECT match_name,
          MAX(CASE WHEN team ILIKE LOWER($1) THEN runs END) AS t1_runs,
          MAX(CASE WHEN team ILIKE LOWER($2) THEN runs END) AS t2_runs
        FROM inn1 GROUP BY match_name
      )
      SELECT
        SUM(CASE WHEN t1_runs > t2_runs THEN 1 ELSE 0 END) AS t1_leads,
        SUM(CASE WHEN t2_runs > t1_runs THEN 1 ELSE 0 END) AS t2_leads,
        SUM(CASE WHEN t1_runs = t2_runs THEN 1 ELSE 0 END) AS level
      FROM per_match;
    `;
    const r = await pool.query(q, [t1, t2]);
    const row = r.rows[0] || { t1_leads: 0, t2_leads: 0, level: 0 };
    res.json({ t1_leads: nz(row.t1_leads), t2_leads: nz(row.t2_leads), level: nz(row.level) });
  } catch (e) {
    console.warn("test-innings-lead (fallback):", e.message);
    res.json({ t1_leads: 0, t2_leads: 0, level: 0 });
  }
});

router.get("/test-innings-averages", async (req, res) => {
  const { team1, team2 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = team1.trim(), t2 = team2.trim();

    const q = `
      WITH raw AS (
        SELECT LOWER(TRIM(pp.team_name)) AS team,
               COALESCE(pp.innings,1) AS inn,
               SUM(pp.run_scored) AS runs,
               SUM(CASE WHEN COALESCE(pp.dismissed,'') ILIKE '%out%' THEN 1 ELSE 0 END) AS outs,
               SUM(pp.runs_given) AS runs_given,
               SUM(pp.wickets_taken) AS wkts
        FROM player_performance pp
        JOIN test_match_results t ON t.match_name = pp.match_name
        WHERE (
          (LOWER(TRIM(t.team1))=LOWER($1) AND LOWER(TRIM(t.team2))=LOWER($2)) OR
          (LOWER(TRIM(t.team1))=LOWER($2) AND LOWER(TRIM(t.team2))=LOWER($1))
        )
          AND pp.match_type ILIKE 'test'
        GROUP BY team, inn
      )
      SELECT
        CASE WHEN team ILIKE LOWER($1) THEN $1 ELSE $2 END AS team_name,
        ROUND(SUM(CASE WHEN inn=1 THEN runs END)::numeric / NULLIF(SUM(CASE WHEN inn=1 THEN outs END),0), 2) AS avg_inn1_runs,
        ROUND(SUM(CASE WHEN inn=2 THEN runs END)::numeric / NULLIF(SUM(CASE WHEN inn=2 THEN outs END),0), 2) AS avg_inn2_runs,
        ROUND(SUM(CASE WHEN inn=1 THEN runs END)::numeric / NULLIF(SUM(CASE WHEN inn=1 THEN wkts END),0), 2) AS inn1_rpw,
        ROUND(SUM(CASE WHEN inn=2 THEN runs END)::numeric / NULLIF(SUM(CASE WHEN inn=2 THEN wkts END),0), 2) AS inn2_rpw
      FROM raw
      GROUP BY team;
    `;
    const r = await pool.query(q, [t1, t2]);
    const out = r.rows.map(row => ({
      team: row.team_name,
      avg_inn1_runs: nz(row.avg_inn1_runs),
      avg_inn2_runs: nz(row.avg_inn2_runs),
      inn1_rpw: nz(row.inn1_rpw),
      inn2_rpw: nz(row.inn2_rpw),
    }));
    res.json(out);
  } catch (e) {
    console.warn("test-innings-averages (fallback):", e.message);
    res.json([]); // safe fallback
  }
});

/* ---------------- Recent ---------------- */
router.get("/recent", async (req, res) => {
  const { team1, team2, type = "ALL", limit = 10 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });

  try {
    const t1 = team1.trim(), t2 = team2.trim(), up = String(type).toUpperCase();
    const q = `
      WITH unioned AS (
        SELECT created_at, id, winner, UPPER(TRIM(match_type)) AS match_type, team1, team2
        FROM match_history
        WHERE (
          (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
          (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
        ) AND ($3='ALL' OR LOWER(TRIM(match_type))=LOWER($3))
        UNION ALL
        SELECT created_at, id, winner, 'TEST' AS match_type, team1, team2
        FROM test_match_results
        WHERE (
          (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
          (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
        ) AND ($3='ALL' OR $3='TEST')
      )
      SELECT winner, match_type
      FROM unioned
      ORDER BY COALESCE(created_at, to_timestamp(id)) DESC
      LIMIT $4
    `;
    const r = await pool.query(q, [t1, t2, up, Number(limit)]);
    res.json(r.rows || []);
  } catch (e) {
    console.error("recent:", e);
    res.status(500).json({ error: "Failed to fetch recent results" });
  }
});

/* ========================================================================
 * NEW: PLAYER TRENDS ENDPOINTS (to power the Player Trends section in H2H)
 * ------------------------------------------------------------------------
 * Changes vs. previous version:
 *  - Return 0 instead of NULL when a denominator is 0 (outs/wkts/balls)
 *    so the charts don’t render blank series.
 *  - /players/trend returns extra arrays: per_match[] and ma5[].
 *  - /players/opponent-summary returns opponents_list[] for the dropdown.
 *  - Ensure chronological ordering (ORDER BY ts) for moving average.
 * ====================================================================== */

/* -- List of players (simple list of names) -- */
router.get("/players/list", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT player_name
      FROM players
      WHERE player_name IS NOT NULL AND player_name <> ''
      ORDER BY player_name;
    `);
    res.json(r.rows.map(x => x.player_name));
  } catch (e) {
    console.error("players/list:", e);
    res.status(500).json([]);
  }
});

/* -- Opponent summary for a player (aggregated batting/bowling vs each opponent) -- */
router.get("/players/opponent-summary", async (req, res) => {
  const player = String(req.query.player || "").trim();
  const upType = String(req.query.type || "ALL").toUpperCase();
  if (!player) return res.status(400).json({ opponents: [], overall: {}, opponents_list: [] });

  try {
    const q = `
      WITH m AS (
        SELECT TRIM(match_name) AS match_name,
               LOWER(TRIM(match_name)) AS mkey,
               LOWER(TRIM(team1)) AS t1,
               LOWER(TRIM(team2)) AS t2
        FROM match_history
        UNION ALL
        SELECT TRIM(match_name) AS match_name,
               LOWER(TRIM(match_name)) AS mkey,
               LOWER(TRIM(team1)) AS t1,
               LOWER(TRIM(team2)) AS t2
        FROM test_match_results
      ),
      p AS (
        SELECT LOWER(TRIM(pp.match_name)) AS mkey,
               LOWER(TRIM(pp.team_name))  AS team,
               SUM(pp.run_scored)         AS runs,
               SUM(CASE WHEN COALESCE(pp.dismissed,'') ILIKE '%out%' THEN 1 ELSE 0 END) AS outs,
               SUM(pp.wickets_taken)      AS wkts,
               SUM(pp.runs_given)         AS runs_given,
               COALESCE(SUM(pp.balls_faced), 0) AS balls
        FROM player_performance pp
        JOIN players pl ON pl.id = pp.player_id
        WHERE LOWER(pl.player_name) = LOWER($1)
          AND (
                $2 = 'ALL'
             OR ($2 = 'TEST' AND pp.match_type ILIKE 'test%')
             OR ($2 = 'ODI'  AND pp.match_type ILIKE 'odi%')
             OR ($2 = 'T20'  AND (pp.match_type ILIKE 't20%' OR pp.match_type ILIKE 't20i%'))
          )
        GROUP BY LOWER(TRIM(pp.match_name)), LOWER(TRIM(pp.team_name))
      ),
      j AS (
        SELECT
          CASE
            WHEN p.team = m.t1 THEN m.t2
            WHEN p.team = m.t2 THEN m.t1
            ELSE NULL
          END AS opponent,
          p.runs, p.outs, p.wkts, p.runs_given, p.balls
        FROM p
        LEFT JOIN m ON p.mkey = m.mkey
      ),
      agg AS (
        SELECT
          opponent,
          SUM(runs)       AS runs,
          SUM(outs)       AS outs,
          SUM(wkts)       AS wkts,
          SUM(runs_given) AS runs_given,
          SUM(balls)      AS balls
        FROM j
        WHERE opponent IS NOT NULL
        GROUP BY opponent
      )
      SELECT
        opponent,
        runs,
        ROUND(CASE WHEN outs  > 0 THEN runs::numeric / outs  ELSE 0 END, 2) AS batting_avg,
        ROUND(CASE WHEN balls > 0 THEN (runs::numeric * 100.0) / balls ELSE 0 END, 2) AS strike_rate,
        wkts,
        ROUND(CASE WHEN wkts  > 0 THEN runs_given::numeric / wkts ELSE 0 END, 2) AS bowling_avg
      FROM agg
      ORDER BY runs DESC NULLS LAST;
    `;
    const r = await pool.query(q, [player, upType]);

    const opponents = r.rows.map(row => ({
      opponent: toTitle(row.opponent || ""),
      runs: nz(row.runs),
      batting_avg: nz(row.batting_avg),
      strike_rate: nz(row.strike_rate),
      wickets: nz(row.wkts),
      bowling_avg: nz(row.bowling_avg),
    }));

    const overall = opponents.reduce(
      (a, x) => ({ runs: a.runs + x.runs, wickets: a.wickets + x.wickets }),
      { runs: 0, wickets: 0 }
    );
    const opponents_list = ["All Opponents", ...opponents.map(o => o.opponent)];

    res.json({ opponents, overall, opponents_list });
  } catch (e) {
    console.error("players/opponent-summary:", e);
    res.status(500).json({ opponents: [], overall: {}, opponents_list: [] });
  }
});

/* -- Per-match trend series for a player (with MA(5); tolerant type + join) -- */
router.get("/players/trend", async (req, res) => {
  const player   = String(req.query.player || "").trim();
  const upType   = String(req.query.type || "ALL").toUpperCase();
  const opponent = String(req.query.opponent || "ALL").trim().toLowerCase();
  const metric   = String(req.query.metric || "runs").toUpperCase(); // RUNS|BATTING_AVG|STRIKE_RATE|WICKETS|BOWLING_AVG

  if (!player) return res.status(400).json({ series: [], per_match: [], ma5: [] });

  try {
    const q = `
      -- Base list of matches; make a stable sequence for ordering
      WITH m_base AS (
        SELECT TRIM(match_name) AS match_name,
               LOWER(TRIM(match_name)) AS mkey,
               LOWER(TRIM(team1)) AS t1,
               LOWER(TRIM(team2)) AS t2,
               UPPER(TRIM(match_type)) AS mt
        FROM match_history
        UNION ALL
        SELECT TRIM(match_name) AS match_name,
               LOWER(TRIM(match_name)) AS mkey,
               LOWER(TRIM(team1)) AS t1,
               LOWER(TRIM(team2)) AS t2,
               'TEST' AS mt
        FROM test_match_results
      ),
      m AS (
        SELECT mb.*,
               ROW_NUMBER() OVER (ORDER BY mb.match_name) AS seq
        FROM m_base mb
      ),
      p AS (
        SELECT LOWER(TRIM(pp.match_name)) AS mkey,
               LOWER(TRIM(pp.team_name))  AS team,
               SUM(pp.run_scored)         AS runs,
               SUM(CASE WHEN COALESCE(pp.dismissed,'') ILIKE '%out%' THEN 1 ELSE 0 END) AS outs,
               SUM(pp.wickets_taken)      AS wkts,
               SUM(pp.runs_given)         AS runs_given,
               COALESCE(SUM(pp.balls_faced), 0) AS balls
        FROM player_performance pp
        JOIN players pl ON pl.id = pp.player_id
        WHERE LOWER(pl.player_name) = LOWER($1)
          AND (
                $2 = 'ALL'
             OR ($2 = 'TEST' AND pp.match_type ILIKE 'test%')
             OR ($2 = 'ODI'  AND pp.match_type ILIKE 'odi%')
             OR ($2 = 'T20'  AND (pp.match_type ILIKE 't20%' OR pp.match_type ILIKE 't20i%'))
          )
        GROUP BY LOWER(TRIM(pp.match_name)), LOWER(TRIM(pp.team_name))
      ),
      j AS (
        SELECT
          COALESCE(m.match_name, p.mkey)       AS match_name,
          m.seq                                AS mseq,
          m.mt                                 AS mt,
          CASE WHEN p.team = m.t1 THEN m.t2
               WHEN p.team = m.t2 THEN m.t1
               ELSE NULL END                   AS opponent,
          p.runs, p.outs, p.wkts, p.runs_given, p.balls
        FROM p
        LEFT JOIN m ON p.mkey = m.mkey
      ),
      f AS (
        SELECT *
        FROM j
        WHERE ($3 = 'all') OR (opponent = $3)
      ),
      per_match AS (
        SELECT
          match_name,
          COALESCE(mseq, ROW_NUMBER() OVER (ORDER BY match_name)) AS ord_seq,
          CASE
            WHEN $4 = 'RUNS'         THEN runs::numeric
            WHEN $4 = 'WICKETS'      THEN wkts::numeric
            WHEN $4 = 'BOWLING_AVG'  THEN CASE WHEN wkts  > 0 THEN runs_given::numeric / wkts ELSE 0 END
            WHEN $4 = 'BATTING_AVG'  THEN CASE WHEN outs  > 0 THEN runs::numeric / outs ELSE 0 END
            WHEN $4 = 'STRIKE_RATE'  THEN CASE WHEN balls > 0 THEN (runs::numeric * 100.0) / balls ELSE 0 END
            ELSE runs::numeric
          END AS metric_value
        FROM f
      )
      SELECT
        match_name,
        metric_value,
        ROUND(AVG(metric_value) OVER (ORDER BY ord_seq ROWS BETWEEN 4 PRECEDING AND CURRENT ROW), 2) AS ma5,
        ord_seq AS seq
      FROM per_match
      ORDER BY ord_seq;
    `;
    const r = await pool.query(q, [player, upType, opponent, metric]);
    const series = r.rows || [];

    const per_match = series.map(row => ({ name: row.match_name, value: nz(row.metric_value) }));
    const ma5       = series.map(row => ({ name: row.match_name, value: nz(row.ma5) }));

    res.json({ series, per_match, ma5 });
  } catch (e) {
    console.error("players/trend:", e);
    res.status(500).json({ series: [], per_match: [], ma5: [] });
  }
});


module.exports = router;
