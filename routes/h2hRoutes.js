// routes/h2hRoutes.js
// VS head-to-head analytics (uses match_history + test_match_results)
const express = require("express");
const router = express.Router();
const pool = require("../db");

const titleCase = (s = "") => s.toLowerCase().replace(/\b\w/g, m => m.toUpperCase());

/* ---- Teams (from both tables) ---- */
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
    res.json([...new Set(r.rows.map(v => titleCase(v.team)))]);
  } catch (e) {
    console.error("teams:", e);
    res.status(500).json({ error: "Failed to fetch team names" });
  }
});

/* ---- Summary (ALL/ODI/T20/TEST) ---- */
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
        SELECT winner FROM match_history WHERE ${pair} AND LOWER(TRIM(match_type)) IN('odi','t20')
        UNION ALL
        SELECT winner FROM test_match_results WHERE ${pair}
      `;
      params = [t1, t2, t1, t2];
    }
    const r = await pool.query(sql, params);
    let t1w = 0, t2w = 0, d = 0;
    r.rows.forEach(m => {
      const w = (m.winner || "").trim().toLowerCase();
      if (!w || w.includes("draw") || w.includes("tie")) d++;
      else if (w.includes(t1.toLowerCase())) t1w++;
      else if (w.includes(t2.toLowerCase())) t2w++;
    });
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

/* ---- Wins by format ---- */
router.get("/by-format", async (req, res) => {
  const { team1, team2 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = team1.trim(), t2 = team2.trim();
    const q = `
      WITH pair AS (
        SELECT team1,team2,winner, LOWER(TRIM(match_type)) AS match_type FROM match_history
        WHERE (
          (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
          (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
        ) AND LOWER(TRIM(match_type)) IN ('odi','t20')
        UNION ALL
        SELECT team1,team2,winner, 'test' AS match_type FROM test_match_results
        WHERE (
          (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
          (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
        )
      )
      SELECT UPPER(match_type) AS match_type,
             SUM(CASE WHEN LOWER(winner) LIKE LOWER($1) THEN 1 ELSE 0 END) AS t1_wins,
             SUM(CASE WHEN LOWER(winner) LIKE LOWER($2) THEN 1 ELSE 0 END) AS t2_wins,
             SUM(CASE WHEN winner IS NULL OR winner ILIKE '%draw%' OR winner ILIKE '%tie%' THEN 1 ELSE 0 END) AS draws
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

/* ---- Points ---- */
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
        const w = (m.winner || "").toLowerCase();
        if (!w || w.includes("draw") || w.includes("tie")) d++;
        else if (w.includes(t1.toLowerCase())) a++;
        else if (w.includes(t2.toLowerCase())) b++;
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
        const r = await pool.query(`SELECT winner FROM match_history WHERE ${pair} AND LOWER(TRIM(match_type))=LOWER($3)`, [t1, t2, fmt]);
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

/* ---- Total Runs by Format (union) ---- */
router.get("/runs-by-format", async (req, res) => {
  const { team1, team2 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = team1.trim(), t2 = team2.trim();
    const m = await pool.query(`
      SELECT match_name, LOWER(TRIM(match_type)) AS mt FROM match_history
      WHERE (
        (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
        (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
      ) AND LOWER(TRIM(match_type)) IN('odi','t20')
      UNION ALL
      SELECT match_name, 'test' AS mt FROM test_match_results
      WHERE (
        (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
        (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
      )
    `, [t1, t2]);

    const names = m.rows.map(r => r.match_name).filter(Boolean);
    if (!names.length) return res.json([]);

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
      out[mt][key] = Number(row.runs || 0);
    });
    res.json(Object.values(out));
  } catch (e) {
    console.error("runs-by-format:", e);
    res.status(500).json({ error: "Failed to compute runs by format" });
  }
});

/* ---- Leaderboards ---- */
router.get("/top-batters", async (req, res) => {
  const { team1, team2, type = "ALL", limit = 5 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = team1.trim(), t2 = team2.trim(), up = String(type).toUpperCase();
    const add = up === "ALL" ? "" : " AND LOWER(TRIM(pp.match_type))=LOWER($4) ";
    const params = [t1, t2, Number(limit)];
    if (up !== "ALL") params.push(up);
    const q = `
      SELECT p.player_name, SUM(pp.run_scored) AS runs
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE LOWER(TRIM(pp.team_name)) IN (LOWER($1), LOWER($2)) ${add}
      GROUP BY p.player_name
      ORDER BY runs DESC
      LIMIT $3
    `;
    const r = await pool.query(q, params);
    res.json(r.rows || []);
  } catch (e) {
    console.error("top-batters:", e);
    res.status(500).json({ error: "Failed to compute top batters" });
  }
});

router.get("/top-bowlers", async (req, res) => {
  const { team1, team2, type = "ALL", min_wkts = 3, limit = 5 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = team1.trim(), t2 = team2.trim(), up = String(type).toUpperCase();
    const add = up === "ALL" ? "" : " AND LOWER(TRIM(pp.match_type))=LOWER($5) ";
    const params = [t1, t2, Number(min_wkts), Number(limit)];
    if (up !== "ALL") params.push(up);
    const q = `
      SELECT p.player_name,
             SUM(pp.wickets_taken) AS wkts,
             SUM(pp.runs_given)    AS runs_given,
             ROUND(SUM(pp.runs_given)::numeric / NULLIF(SUM(pp.wickets_taken),0), 2) AS bowl_avg
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE LOWER(TRIM(pp.team_name)) IN (LOWER($1), LOWER($2)) ${add}
      GROUP BY p.player_name
      HAVING SUM(pp.wickets_taken) >= $3
      ORDER BY bowl_avg ASC, wkts DESC
      LIMIT $4
    `;
    const r = await pool.query(q, params);
    res.json(r.rows || []);
  } catch (e) {
    console.error("top-bowlers:", e);
    res.status(500).json({ error: "Failed to compute top bowlers" });
  }
});

/* ---- Recent ---- */
router.get("/recent", async (req, res) => {
  const { team1, team2, type = "ALL", limit = 10 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });
  try {
    const t1 = team1.trim(), t2 = team2.trim(), up = String(type).toUpperCase();
    const q = `
      WITH unioned AS (
        SELECT created_at, id, winner, match_type, team1, team2
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
