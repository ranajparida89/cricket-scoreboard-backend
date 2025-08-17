// routes/h2hRoutes.js
// H2H API: supports TEST table + extra analytics using existing columns only
// Last updated: 2025-08-17

const express = require("express");
const router = express.Router();
const pool = require("../db");

// helpers
const titleCase = (s = "") =>
  s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

/* ================================
   HEAD-TO-HEAD SUMMARY
   ================================ */
router.get("/summary", async (req, res) => {
  const { team1, team2, type } = req.query;
  if (!team1 || !team2 || !type || team1.toLowerCase() === team2.toLowerCase()) {
    return res.status(400).json({ error: "Please provide two different teams and a match type" });
  }

  try {
    const t1 = team1.trim(), t2 = team2.trim(), up = String(type).toUpperCase();

    const pairWhere = `
      (
        (LOWER(TRIM(team1)) = LOWER($1) AND LOWER(TRIM(team2)) = LOWER($2))
        OR
        (LOWER(TRIM(team1)) = LOWER($2) AND LOWER(TRIM(team2)) = LOWER($1))
      )
    `;

    let queryText = "";
    let queryParams = [t1, t2];

    if (up === "TEST") {
      queryText = `
        SELECT id, match_name, winner, 'TEST' AS match_type
        FROM test_match_results
        WHERE ${pairWhere}
      `;
    } else if (up === "ODI" || up === "T20") {
      queryText = `
        SELECT id, match_name, winner, match_type
        FROM match_history
        WHERE ${pairWhere}
          AND LOWER(TRIM(match_type)) = LOWER($3)
      `;
      queryParams.push(type);
    } else {
      // ALL -> ODI/T20 from match_history + TEST from test_match_results
      queryText = `
        SELECT id, match_name, winner, match_type
        FROM match_history
        WHERE ${pairWhere} AND LOWER(TRIM(match_type)) IN ('odi','t20')
        UNION ALL
        SELECT id, match_name, winner, 'TEST' AS match_type
        FROM test_match_results
        WHERE ${pairWhere}
      `;
      queryParams = [t1, t2, t1, t2];
    }

    const matchResult = await pool.query(queryText, queryParams);
    const matches = matchResult.rows || [];

    const matchIds = matches.map((m) => m.id);
    if (matchIds.length === 0) {
      return res.json({
        total_matches: 0,
        [t1]: 0,
        [t2]: 0,
        draws: 0,
        win_percentage_team1: 0,
        win_percentage_team2: 0,
      });
    }

    let team1Wins = 0, team2Wins = 0, draws = 0;
    for (const m of matches) {
      const w = (m.winner || "").trim().toLowerCase();
      if (!w || w.includes("draw") || w.includes("tie")) draws++;
      else if (w.includes(t1.toLowerCase())) team1Wins++;
      else if (w.includes(t2.toLowerCase())) team2Wins++;
    }

    const total = matchIds.length;
    const winPct1 = total ? Math.round((team1Wins / total) * 100) : 0;
    const winPct2 = total ? Math.round((team2Wins / total) * 100) : 0;

    return res.json({
      total_matches: total,
      [t1]: team1Wins,
      [t2]: team2Wins,
      draws,
      win_percentage_team1: winPct1,
      win_percentage_team2: winPct2,
    });
  } catch (error) {
    console.error("❌ Error in /api/h2h/summary:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ================================
   TEAM LIST  (from BOTH tables)
   ================================ */
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
    const teamList = [...new Set(r.rows.map((v) => titleCase(v.team)))];
    return res.json(teamList);
  } catch (e) {
    console.error("❌ Error in /api/h2h/teams:", e);
    return res.status(500).json({ error: "Failed to fetch team names" });
  }
});

/* ================================
   EXTRA ANALYTICS (existing data only)
   ================================ */

/** 1) Wins by Format (ODI/T20/TEST) */
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
             SUM(CASE WHEN LOWER(winner) LIKE LOWER($1) THEN 1 ELSE 0 END) AS t1_wins,
             SUM(CASE WHEN LOWER(winner) LIKE LOWER($2) THEN 1 ELSE 0 END) AS t2_wins,
             SUM(CASE WHEN winner IS NULL OR winner ILIKE '%draw%' OR winner ILIKE '%tie%' THEN 1 ELSE 0 END) AS draws
      FROM pair
      GROUP BY match_type
      ORDER BY match_type;
    `;
    const r = await pool.query(q, [t1, t2]);
    return res.json(r.rows);
  } catch (e) {
    console.error("❌ /by-format:", e);
    return res.status(500).json({ error: "Failed to compute by-format" });
  }
});

/** 2) Test: First-Innings Lead */
router.get("/test-innings-lead", async (req, res) => {
  const { team1, team2 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });

  try {
    const t1 = team1.trim(), t2 = team2.trim();
    const q = `
      SELECT
        SUM(CASE WHEN runs1 > runs2 THEN 1 ELSE 0 END) AS t1_leads,
        SUM(CASE WHEN runs2 > runs1 THEN 1 ELSE 0 END) AS t2_leads,
        SUM(CASE WHEN runs1 = runs2 THEN 1 ELSE 0 END) AS level
      FROM test_match_results
      WHERE (
        (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
        (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
      );
    `;
    const r = await pool.query(q, [t1, t2]);
    return res.json(r.rows[0] || { t1_leads: 0, t2_leads: 0, level: 0 });
  } catch (e) {
    console.error("❌ /test-innings-lead:", e);
    return res.status(500).json({ error: "Failed to compute test innings lead" });
  }
});

/** 3) Test: Average runs per innings + runs per wicket */
router.get("/test-innings-averages", async (req, res) => {
  const { team1, team2 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });

  try {
    const t1 = team1.trim(), t2 = team2.trim();
    const q = `
      WITH norm AS (
        SELECT team1 AS team, runs1 AS inn1_runs, wickets1 AS inn1_wkts,
               runs1_2 AS inn2_runs, wickets1_2 AS inn2_wkts
        FROM test_match_results
        WHERE (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2))
        UNION ALL
        SELECT team2, runs2, wickets2, runs2_2, wickets2_2
        FROM test_match_results
        WHERE (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2))
        UNION ALL
        SELECT team2, runs2, wickets2, runs2_2, wickets2_2
        FROM test_match_results
        WHERE (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
        UNION ALL
        SELECT team1, runs1, wickets1, runs1_2, wickets1_2
        FROM test_match_results
        WHERE (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
      )
      SELECT team,
             AVG(inn1_runs)::int AS avg_inn1_runs,
             AVG(inn2_runs)::int AS avg_inn2_runs,
             ROUND(AVG(inn1_runs)::numeric / NULLIF(AVG(inn1_wkts),0), 2) AS inn1_rpw,
             ROUND(AVG(inn2_runs)::numeric / NULLIF(AVG(inn2_wkts),0), 2) AS inn2_rpw
      FROM norm
      WHERE LOWER(TRIM(team)) IN (LOWER($1), LOWER($2))
      GROUP BY team;
    `;
    const r = await pool.query(q, [t1, t2]);
    return res.json(r.rows || []);
  } catch (e) {
    console.error("❌ /test-innings-averages:", e);
    return res.status(500).json({ error: "Failed to compute test innings averages" });
  }
});

/** 4) Points (correct rules)
 *  Test:  Win=12, Loss=6, Draw=4 (each)
 *  ODI/T20: Win=2, Loss=0, Draw=1 (each)
 *  type=TEST|ODI|T20|ALL
 */
router.get("/points", async (req, res) => {
  const { team1, team2, type = "ALL" } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });

  try {
    const t1 = team1.trim(), t2 = team2.trim();

    // helper to compute from rows
    const compute = (rows, fmt) => {
      let t1w = 0, t2w = 0, d = 0;
      for (const m of rows) {
        const w = (m.winner || "").toLowerCase();
        if (!w || w.includes("draw") || w.includes("tie")) d++;
        else if (w.includes(t1.toLowerCase())) t1w++;
        else if (w.includes(t2.toLowerCase())) t2w++;
      }
      if (fmt === "TEST") {
        return { t1: t1w * 12 + (t2w) * 6 + d * 4, t2: t2w * 12 + (t1w) * 6 + d * 4 };
      } else { // ODI/T20
        return { t1: t1w * 2 + d * 1, t2: t2w * 2 + d * 1 };
      }
    };

    const pairWhere = `
      (
        (LOWER(TRIM(team1)) = LOWER($1) AND LOWER(TRIM(team2)) = LOWER($2))
        OR
        (LOWER(TRIM(team1)) = LOWER($2) AND LOWER(TRIM(team2)) = LOWER($1))
      )
    `;

    let totals = { t1: 0, t2: 0 };

    const up = String(type).toUpperCase();

    const runOne = async (fmt) => {
      if (fmt === "TEST") {
        const r = await pool.query(
          `SELECT winner FROM test_match_results WHERE ${pairWhere}`, [t1, t2]
        );
        const p = compute(r.rows || [], "TEST");
        totals.t1 += p.t1; totals.t2 += p.t2;
      } else {
        const r = await pool.query(
          `SELECT winner FROM match_history WHERE ${pairWhere} AND LOWER(TRIM(match_type))=LOWER($3)`,
          [t1, t2, fmt]
        );
        const p = compute(r.rows || [], fmt.toUpperCase());
        totals.t1 += p.t1; totals.t2 += p.t2;
      }
    };

    if (up === "TEST") await runOne("TEST");
    else if (up === "ODI") await runOne("odi");
    else if (up === "T20") await runOne("t20");
    else { await runOne("odi"); await runOne("t20"); await runOne("TEST"); }

    return res.json({ t1_points: totals.t1, t2_points: totals.t2 });
  } catch (e) {
    console.error("❌ /points:", e);
    return res.status(500).json({ error: "Failed to compute points" });
  }
});

/** 5) Total runs by format (for the two teams only, vs each other) */
router.get("/runs-by-format", async (req, res) => {
  const { team1, team2 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });

  try {
    const t1 = team1.trim(), t2 = team2.trim();

    // Collect match names for pair from both tables
    const mRes = await pool.query(`
      SELECT match_name, LOWER(TRIM(match_type)) AS mt
      FROM match_history
      WHERE (
        (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
        (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
      ) AND LOWER(TRIM(match_type)) IN ('odi','t20')
      UNION ALL
      SELECT match_name, 'test' AS mt
      FROM test_match_results
      WHERE (
        (LOWER(TRIM(team1))=LOWER($1) AND LOWER(TRIM(team2))=LOWER($2)) OR
        (LOWER(TRIM(team1))=LOWER($2) AND LOWER(TRIM(team2))=LOWER($1))
      )
    `, [t1, t2]);

    const names = mRes.rows.map(r => r.match_name).filter(Boolean);
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

    // Pivot to [{match_type, team1_runs, team2_runs}]
    const out = {};
    r.rows.forEach(row => {
      const mt = row.match_type;
      if (!out[mt]) out[mt] = { match_type: mt, [t1]: 0, [t2]: 0 };
      const key = row.team.includes(t1.toLowerCase()) ? t1 : t2;
      out[mt][key] = Number(row.runs || 0);
    });

    return res.json(Object.values(out));
  } catch (e) {
    console.error("❌ /runs-by-format:", e);
    return res.status(500).json({ error: "Failed to compute runs by format" });
  }
});

/** 6) Top Batters (by runs) – both teams combined, filter by type (ALL/ODI/T20/TEST) */
router.get("/top-batters", async (req, res) => {
  const { team1, team2, type = "ALL", limit = 5 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });

  try {
    const t1 = team1.trim(), t2 = team2.trim();
    const up = String(type).toUpperCase();

    const addType = up === "ALL" ? "" : " AND LOWER(TRIM(pp.match_type)) = LOWER($4) ";
    const params = [t1, t2, limit];
    if (up !== "ALL") params.push(type);

    const q = `
      SELECT p.player_name, SUM(pp.run_scored) AS runs
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE (LOWER(TRIM(pp.team_name)) IN (LOWER($1), LOWER($2)))
        ${addType}
      GROUP BY p.player_name
      ORDER BY runs DESC
      LIMIT $3;
    `;
    const r = await pool.query(q, params);
    return res.json(r.rows || []);
  } catch (e) {
    console.error("❌ /top-batters:", e);
    return res.status(500).json({ error: "Failed to compute top batters" });
  }
});

/** 7) Top Bowlers (by bowling average; min wickets) – both teams combined */
router.get("/top-bowlers", async (req, res) => {
  const { team1, team2, type = "ALL", min_wkts = 3, limit = 5 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });

  try {
    const t1 = team1.trim(), t2 = team2.trim();
    const up = String(type).toUpperCase();

    const addType = up === "ALL" ? "" : " AND LOWER(TRIM(pp.match_type)) = LOWER($5) ";
    const params = [t1, t2, min_wkts, limit];
    if (up !== "ALL") params.push(type);

    const q = `
      SELECT p.player_name,
             SUM(pp.wickets_taken) AS wkts,
             SUM(pp.runs_given)    AS runs_given,
             ROUND(SUM(pp.runs_given)::numeric / NULLIF(SUM(pp.wickets_taken),0), 2) AS bowl_avg
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE (LOWER(TRIM(pp.team_name)) IN (LOWER($1), LOWER($2)))
        ${addType}
      GROUP BY p.player_name
      HAVING SUM(pp.wickets_taken) >= $3
      ORDER BY bowl_avg ASC, wkts DESC
      LIMIT $4;
    `;
    const r = await pool.query(q, params);
    return res.json(r.rows || []);
  } catch (e) {
    console.error("❌ /top-bowlers:", e);
    return res.status(500).json({ error: "Failed to compute top bowlers" });
  }
});

/** 8) Recent Results (last N) */
router.get("/recent", async (req, res) => {
  const { team1, team2, type = "ALL", limit = 10 } = req.query;
  if (!team1 || !team2) return res.status(400).json({ error: "team1 & team2 required" });

  try {
    const t1 = team1.trim(), t2 = team2.trim();
    const up = String(type).toUpperCase();

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
      LIMIT $4;
    `;
    const r = await pool.query(q, [t1, t2, up, limit]);
    return res.json(r.rows || []);
  } catch (e) {
    console.error("❌ /recent:", e);
    return res.status(500).json({ error: "Failed to fetch recent results" });
  }
});

module.exports = router;
