// routes/h2hRoutes.js
// VS head-to-head analytics (match_history + test_match_results + player_performance)
const express = require("express");
const router = express.Router();
const pool = require("../db");

// helpers
const toTitle = (s = "") => s.toLowerCase().replace(/\b\w/g, m => m.toUpperCase());
const nz = v => (v == null ? 0 : Number(v));
const nor = s => (s || "").trim().toLowerCase();
const isDrawish = w =>
  !w || w.includes("draw") || w.includes("tie") || w.includes("no result") || w.includes("abandon");

// escape regex special chars
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordHit = (winner, teamName) => {
  if (!winner || !teamName) return false;
  // word boundary style check to avoid partial-name hits
  const re = new RegExp(`\\b${reEsc(teamName)}\\b`, "i");
  return re.test(winner);
};

/* ---------------- Teams (from both tables) ---------------- */
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

/* ---------------- Summary (ALL/ODI/T20/TEST) ---------------- */
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
      // ✅ ALL: make sure parameter list matches both SELECTs (bug fixed)
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

    // Use ILIKE so text like "India win the match" still counts for India.
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

/* ---------------- Points (Test 12/6/4; ODI/T20 2/0/1) ---------------- */
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

/* ---------------- Total Runs by Format ---------------- */
router.get("/runs-by-format", async (req, res) => {
  const { team1, team2 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = team1.trim(), t2 = team2.trim();

    // collect match_names for this H2H across both tables
    const m = await pool.query(`
      SELECT match_name
      FROM match_history
      WHERE (
        (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
        (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
      ) AND LOWER(TRIM(match_type)) IN('odi','t20')
      UNION ALL
      SELECT match_name
      FROM test_match_results
      WHERE (
        (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
        (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
      )
    `, [t1, t2]);

    const names = m.rows.map(r => r.match_name).filter(Boolean);
    if (!names.length) return res.json([]);

    // use player_performance.match_type directly; normalize case
    const r = await pool.query(`
      SELECT UPPER(TRIM(pp.match_type)) AS match_type,
             LOWER(TRIM(pp.team_name)) AS team,
             SUM(pp.run_scored) AS runs
      FROM player_performance pp
      WHERE pp.match_name = ANY($1)
        AND LOWER(TRIM(pp.team_name)) IN (LOWER($2), LOWER($3))
      GROUP BY match_type, team
      ORDER BY match_type, team
    `, [names, t1, t2]);

    const out = {};
    r.rows.forEach(row => {
      const mt = row.match_type;
      if (!out[mt]) out[mt] = { match_type: mt, [t1]: 0, [t2]: 0 };
      const key = row.team.includes(t1.toLowerCase()) ? t1 : t2;
      out[mt][key] = nz(row.runs);
    });
    res.json(Object.values(out));
  } catch (e) {
    console.error("runs-by-format:", e);
    res.status(500).json({ error: "Failed to compute runs by format" });
  }
});

/* ---------------- Test extras (fail-safe JSON even if schema lacks 'innings') ---------------- */

// FIRST-INNINGS LEAD (best effort / safe fallback)
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
          AND COALESCE(pp.innings,1) = 1   -- if 'innings' column doesn't exist, this whole route will fall back below
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
    // ✅ Always return JSON so the UI never breaks
    res.json({ t1_leads: 0, t2_leads: 0, level: 0 });
  }
});

// Test Batting Averages per Innings (safe fallback)
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
    res.json([]); // ✅ safe JSON
  }
});

/* ---------------- Recent (union) ---------------- */
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

module.exports = router;
