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
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordHit = (winner, teamName) => {
  if (!winner || !teamName) return false;
  const re = new RegExp(`\\b${reEsc(teamName)}\\b`, "i");
  return re.test(winner);
};
// Treat variations of “All / All Teams” as no filter.
const isAll = s => {
  const t = String(s || "").trim().toLowerCase();
  return !t || t === "all" || t === "all teams" || t === "allteams";
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
      return { t1: a * 2 + d * 1, t2: b * 2 + d * 1 };
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

/* ---------------- Top Batters ---------------- */
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

/* ---------------- Top Bowlers ---------------- */
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

/* ---------------- Test extras ---------------- */
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
        ROUND(SUM(CASE WHEN inn=1 THEN runs END)::numeric / NULLIF(SUM(CASE WHEN inn=1 THEN outs END), 0), 2) AS avg_inn1_runs,
        ROUND(SUM(CASE WHEN inn=2 THEN runs END)::numeric / NULLIF(SUM(CASE WHEN inn=2 THEN outs END), 0), 2) AS avg_inn2_runs,
        ROUND(SUM(CASE WHEN inn=1 THEN runs END)::numeric / NULLIF(SUM(CASE WHEN inn=1 THEN wkts END), 0), 2) AS inn1_rpw,
        ROUND(SUM(CASE WHEN inn=2 THEN runs END)::numeric / NULLIF(SUM(CASE WHEN inn=2 THEN wkts END), 0), 2) AS inn2_rpw
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

/* ---------------- Players basics (dropdowns) ---------------- */
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

/* =========================================================================
 * META endpoints for filters (tournaments & years)
 * ========================================================================= */
router.get("/meta/tournaments", async (req, res) => {
  try {
    const upType = String(req.query.type || "ALL").toUpperCase();
    const q = `
      SELECT DISTINCT t FROM (
        SELECT TRIM(pp.tournament_name) AS t
        FROM player_performance pp
        WHERE pp.tournament_name IS NOT NULL AND TRIM(pp.tournament_name) <> ''
          AND (
            $1 = 'ALL'
            OR ($1='TEST' AND pp.match_type ILIKE 'test')
            OR ($1='ODI'  AND pp.match_type ILIKE 'odi')
            OR ($1='T20'  AND pp.match_type ILIKE 't20')
          )
        UNION
        SELECT TRIM(mh.tournament_name) AS t
        FROM match_history mh
        WHERE mh.tournament_name IS NOT NULL AND TRIM(mh.tournament_name) <> ''
          AND (
            $1 = 'ALL'
            OR ($1='TEST' AND mh.match_type ILIKE 'test')
            OR ($1='ODI'  AND mh.match_type ILIKE 'odi')
            OR ($1='T20'  AND mh.match_type ILIKE 't20')
          )
      ) x
      ORDER BY t;
    `;
    const r = await pool.query(q, [upType]);
    res.json(r.rows.map(x => x.t));
  } catch (e) {
    console.error("meta/tournaments:", e);
    res.status(500).json([]);
  }
});

router.get("/meta/years", async (req, res) => {
  try {
    const upType = String(req.query.type || "ALL").toUpperCase();
    const q = `
      SELECT DISTINCT y FROM (
        SELECT pp.season_year AS y
        FROM player_performance pp
        WHERE pp.season_year IS NOT NULL
          AND (
            $1 = 'ALL'
            OR ($1='TEST' AND pp.match_type ILIKE 'test')
            OR ($1='ODI'  AND pp.match_type ILIKE 'odi')
            OR ($1='T20'  AND pp.match_type ILIKE 't20')
          )
        UNION
        SELECT COALESCE(mh.season_year, EXTRACT(YEAR FROM mh.match_time))::int AS y
        FROM match_history mh
        WHERE (mh.season_year IS NOT NULL OR mh.match_time IS NOT NULL)
          AND (
            $1 = 'ALL'
            OR ($1='TEST' AND mh.match_type ILIKE 'test')
            OR ($1='ODI'  AND mh.match_type ILIKE 'odi')
            OR ($1='T20'  AND mh.match_type ILIKE 't20')
          )
      ) x
      ORDER BY y DESC;
    `;
    const r = await pool.query(q, [upType]);
    res.json(r.rows.map(x => x.y));
  } catch (e) {
    console.error("meta/years:", e);
    res.status(500).json([]);
  }
});

/* =========================================================================
 * Team Total Runs (Season-wise) + Leaderboard
 * ========================================================================= */

/**
 * GET /api/h2h/team-total-runs
 * Params:
 *  - team (required)
 *  - type = ALL|ODI|T20|TEST
 *  - tournament = '' | 'ALL' | partial name (ILIKE)
 *  - season = '' | year (number)
 * Returns: { filters, kpis:{total,min,max,avg,seasons}, series:[{season_year,runs}] }
 */
router.get("/team-total-runs", async (req, res) => {
  const team = String(req.query.team || "").trim();
  const upType = String(req.query.type || "ALL").toUpperCase();
  const tournament = String(req.query.tournament || "").trim();
  const seasonYear =
    req.query.season != null && String(req.query.season).trim() !== ""
      ? Number(req.query.season)
      : null;

  if (!team) return res.status(400).json({ error: "team is required" });

  try {
    const sql = `
      SELECT season_year, SUM(runs)::bigint AS runs
      FROM (
        SELECT
          COALESCE(mh.season_year, EXTRACT(YEAR FROM mh.match_time))::int AS season_year,
          COALESCE(mh.runs1,0) AS runs
        FROM match_history mh
        WHERE LOWER(TRIM(mh.team1)) = LOWER($1)
          AND ($2 = 'ALL' OR UPPER(TRIM(mh.match_type)) = $2)
          AND ($3 = '' OR $3 = 'ALL' OR mh.tournament_name ILIKE $3)
          AND ($4::int IS NULL OR COALESCE(mh.season_year, EXTRACT(YEAR FROM mh.match_time))::int = $4::int)

        UNION ALL

        SELECT
          COALESCE(mh.season_year, EXTRACT(YEAR FROM mh.match_time))::int AS season_year,
          COALESCE(mh.runs2,0) AS runs
        FROM match_history mh
        WHERE LOWER(TRIM(mh.team2)) = LOWER($1)
          AND ($2 = 'ALL' OR UPPER(TRIM(mh.match_type)) = $2)
          AND ($3 = '' OR $3 = 'ALL' OR mh.tournament_name ILIKE $3)
          AND ($4::int IS NULL OR COALESCE(mh.season_year, EXTRACT(YEAR FROM mh.match_time))::int = $4::int)
      ) t
      WHERE season_year IS NOT NULL
      GROUP BY season_year
      ORDER BY season_year;
    `;

    const r = await pool.query(sql, [team, upType, tournament, seasonYear]);
    const series = (r.rows || []).map(row => ({
      season_year: Number(row.season_year),
      runs: Number(row.runs || 0)
    }));

    const vals = series.map(s => s.runs);
    const total = vals.reduce((a, b) => a + b, 0);
    const min = vals.length ? Math.min(...vals) : 0;
    const max = vals.length ? Math.max(...vals) : 0;
    const avg = vals.length ? Math.round(total / vals.length) : 0;

    res.json({
      filters: {
        team,
        type: upType,
        tournament: tournament || "ALL",
        season: seasonYear || null
      },
      kpis: { total, min, max, avg, seasons: series.length },
      series
    });
  } catch (e) {
    console.error("team-total-runs:", e);
    res.status(500).json({ error: "Failed to compute team total runs", detail: e.message });
  }
});

/**
 * GET /api/h2h/team-total-runs/by-team
 * Leaderboard for the same filters.
 */
router.get("/team-total-runs/by-team", async (req, res) => {
  const upType = String(req.query.type || "ALL").toUpperCase();
  const tournament = String(req.query.tournament || "").trim();
  const seasonYear =
    req.query.season != null && String(req.query.season).trim() !== ""
      ? Number(req.query.season)
      : null;

  try {
    const sql = `
      SELECT t.team, SUM(t.runs)::bigint AS total_runs
      FROM (
        SELECT LOWER(TRIM(team1)) AS team,
               COALESCE(runs1,0) AS runs,
               UPPER(TRIM(match_type)) AS match_type,
               tournament_name,
               COALESCE(season_year, EXTRACT(YEAR FROM match_time))::int AS y
        FROM match_history
        UNION ALL
        SELECT LOWER(TRIM(team2)) AS team,
               COALESCE(runs2,0) AS runs,
               UPPER(TRIM(match_type)) AS match_type,
               tournament_name,
               COALESCE(season_year, EXTRACT(YEAR FROM match_time))::int AS y
        FROM match_history
      ) AS t
      WHERE t.team IS NOT NULL AND t.team <> ''
        AND ($1 = 'ALL' OR t.match_type = $1)
        AND ($2 = '' OR $2 = 'ALL' OR t.tournament_name ILIKE $2)
        AND ($3::int IS NULL OR t.y = $3::int)
      GROUP BY t.team
      ORDER BY total_runs DESC, t.team;
    `;
    const r = await pool.query(sql, [upType, tournament, seasonYear]);
    res.json((r.rows || []).map(x => ({
      team: toTitle(x.team),
      total_runs: Number(x.total_runs || 0)
    })));
  } catch (e) {
    console.error("team-total-runs/by-team:", e);
    res.status(500).json({ error: "Failed to compute totals by team", detail: e.message });
  }
});

/* =========================================================================
 * Player Highlights / Leaderboards (Best Players)
 * ========================================================================= */
router.get("/players/highlights", async (req, res) => {
  const upType = String(req.query.type || "ALL").toUpperCase();
  const tournament = String(req.query.tournament || "").trim();
  const year = req.query.year != null && String(req.query.year).trim() !== "" ? Number(req.query.year) : null;
  const teamRaw = String(req.query.team || "").trim();     // may be 'All Teams'
  const team = isAll(teamRaw) ? "" : teamRaw;              // normalize here
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));

  try {
    // --- base highlights ---
    const sql = `
      WITH base AS (
        SELECT
          pp.player_id,
          pl.player_name,
          pp.team_name,
          pp.run_scored,
          pp.wickets_taken,
          pp.runs_given,
          pp.fifties,
          pp.hundreds,
          COALESCE(pp.balls_faced, 0) AS balls_faced,
          CASE WHEN COALESCE(pp.dismissed,'') ILIKE '%out%' THEN 1 ELSE 0 END AS outs,
          pp.match_id
        FROM player_performance pp
        JOIN players pl ON pl.id = pp.player_id
        LEFT JOIN match_history mh ON mh.id = pp.match_id
        WHERE
          (
            $1 = 'ALL'
            OR ($1='TEST' AND pp.match_type ILIKE 'test')
            OR ($1='ODI'  AND pp.match_type ILIKE 'odi')
            OR ($1='T20'  AND pp.match_type ILIKE 't20')
          )
          AND (
            $2 = '' OR $2 = 'ALL'
            OR (pp.tournament_name IS NOT NULL AND pp.tournament_name ILIKE $2)
            OR (pp.tournament_name IS NULL AND mh.tournament_name IS NOT NULL AND mh.tournament_name ILIKE $2)
          )
          AND (
            $3::int IS NULL
            OR (pp.season_year IS NOT NULL AND pp.season_year = $3::int)
            OR (pp.season_year IS NULL AND mh.season_year IS NOT NULL AND mh.season_year = $3::int)
          )
          AND (
            $4 = '' OR LOWER(pp.team_name) = LOWER($4)
          )
      ),
      agg AS (
        SELECT
          player_id,
          MAX(player_name) AS player_name,
          MAX(team_name)   AS team_name,
          COUNT(*)         AS matches,
          SUM(run_scored)  AS total_runs,
          MAX(run_scored)  AS highest_score,
          SUM(wickets_taken) AS total_wickets,
          SUM(runs_given)    AS total_runs_given,
          SUM(fifties)       AS total_fifties,
          SUM(hundreds)      AS total_hundreds,
          SUM(balls_faced)   AS balls,
          SUM(outs)          AS outs,
          SUM(CASE WHEN run_scored >= 25 AND wickets_taken >= 2 THEN 1 ELSE 0 END) AS success_matches
        FROM base
        GROUP BY player_id
      )
      SELECT
        player_id,
        player_name,
        team_name,
        matches,
        total_runs,
        highest_score,
        total_wickets,
        total_runs_given,
        total_fifties,
        total_hundreds,
        balls,
        outs,
        success_matches,
        ROUND(CASE WHEN outs > 0   THEN total_runs::numeric / outs   END, 2) AS batting_avg,
        ROUND(CASE WHEN balls > 0  THEN (total_runs::numeric * 100.0) / balls END, 2) AS strike_rate,
        ROUND(CASE WHEN total_wickets > 0 THEN total_runs_given::numeric / total_wickets END, 2) AS bowling_avg,
        ROUND(CASE WHEN matches > 0 THEN success_matches::numeric / matches END, 3) AS success_rate
      FROM agg;
    `;

    const r = await pool.query(sql, [upType, tournament, year, team]);

    const rows = (r.rows || []).map(x => ({
      ...x,
      matches: nz(x.matches),
      total_runs: nz(x.total_runs),
      highest_score: nz(x.highest_score),
      total_wickets: nz(x.total_wickets),
      total_runs_given: nz(x.total_runs_given),
      total_fifties: nz(x.total_fifties),
      total_hundreds: nz(x.total_hundreds),
      balls: nz(x.balls),
      outs: nz(x.outs),
      success_matches: nz(x.success_matches),
      batting_avg: x.batting_avg == null ? 0 : Number(x.batting_avg),
      strike_rate: x.strike_rate == null ? 0 : Number(x.strike_rate),
      bowling_avg: x.bowling_avg == null ? 0 : Number(x.bowling_avg),
      success_rate: x.success_rate == null ? 0 : Number(x.success_rate),
    }));

    const by = (key, fn = () => true, desc = true) =>
      [...rows].filter(fn).sort((a, b) => (desc ? nz(b[key]) - nz(a[key]) : nz(a[key]) - nz(b[key]))).slice(0, limit);

    const leaders = {
      most_runs: by("total_runs"),
      highest_wickets: by("total_wickets"),
      best_batting_avg: by("batting_avg", x => x.outs > 0),
      best_strike_rate: by("strike_rate", x => x.balls > 0),
      most_centuries: by("total_hundreds"),
      most_fifties: by("total_fifties"),
      most_successful: [...rows]
        .sort((a, b) => {
          const d1 = nz(b.success_matches) - nz(a.success_matches);
          if (d1) return d1;
          const d2 = (b.success_rate || 0) - (a.success_rate || 0);
          if (d2) return d2;
          return (nz(b.total_runs) + nz(b.total_wickets)) - (nz(a.total_runs) + nz(a.total_wickets));
        })
        .slice(0, limit),
    };

    // --- Most 5-wicket hauls ---
    const sql5 = `
      WITH base AS (
        SELECT
          pp.player_id,
          pl.player_name,
          pp.team_name,
          pp.wickets_taken,
          pp.runs_given,
          pp.against_team,
          COALESCE(pp.is_five_wicket_haul, (pp.wickets_taken >= 5)) AS is_5w
        FROM player_performance pp
        JOIN players pl ON pl.id = pp.player_id
        LEFT JOIN match_history mh ON mh.id = pp.match_id
        WHERE
          (
            $1 = 'ALL'
            OR ($1='TEST' AND pp.match_type ILIKE 'test')
            OR ($1='ODI'  AND pp.match_type ILIKE 'odi')
            OR ($1='T20'  AND pp.match_type ILIKE 't20')
          )
          AND (
            $2 = '' OR $2 = 'ALL'
            OR (pp.tournament_name IS NOT NULL AND pp.tournament_name ILIKE $2)
            OR (pp.tournament_name IS NULL AND mh.tournament_name IS NOT NULL AND mh.tournament_name ILIKE $2)
          )
          AND (
            $3::int IS NULL
            OR (pp.season_year IS NOT NULL AND pp.season_year = $3::int)
            OR (pp.season_year IS NULL AND mh.season_year IS NOT NULL AND mh.season_year = $3::int)
          )
          AND (
            $4 = '' OR LOWER(pp.team_name) = LOWER($4)
          )
      ),
      fivewh AS (
        SELECT * FROM base WHERE is_5w = TRUE
      ),
      best_row AS (
        SELECT DISTINCT ON (player_id)
          player_id, player_name, team_name,
          wickets_taken AS best_wickets,
          COALESCE(against_team,'') AS best_vs_team
        FROM fivewh
        ORDER BY player_id, wickets_taken DESC, runs_given ASC NULLS LAST
      ),
      agg AS (
        SELECT
          player_id,
          MAX(player_name) AS player_name,
          MAX(team_name)   AS team_name,
          COUNT(*)::int    AS fivewh_count,
          MAX(wickets_taken)::int AS best_wickets
        FROM fivewh
        GROUP BY player_id
      )
      SELECT a.player_id, a.player_name, a.team_name,
             a.fivewh_count, a.best_wickets,
             b.best_vs_team
      FROM agg a
      LEFT JOIN best_row b USING (player_id)
      ORDER BY a.fivewh_count DESC, a.best_wickets DESC, a.player_name ASC
      LIMIT $5;
    `;
    const r5 = await pool.query(sql5, [upType, tournament, year, team, limit]);

    leaders.most_five_wicket_hauls = r5.rows || [];

    res.json({
      filters: { type: upType, tournament: tournament || "ALL", year: year || null, team: team || "ALL" },
      totals: { players: rows.length, matches: rows.reduce((s, x) => s + nz(x.matches), 0) },
      leaders,
    });
  } catch (e) {
    console.error("players/highlights:", e);
    res.status(500).json({ error: "Failed to compute highlights", detail: e.message });
  }
});

module.exports = router;
