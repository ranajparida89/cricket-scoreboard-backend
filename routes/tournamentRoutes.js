// routes/tournamentRoutes.js
// Tournament catalog + leaderboard + matches (schema-tolerant, no migrations required)

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ---- Helpers ---------------------------------------------------------------

const VALID_TYPES = new Set(["T20", "ODI", "Test", "All", "ALL", "t20", "odi", "test"]);
const normType = (s) => (s || "").toString().trim();
const safeYear = (y) => {
  const n = Number(y);
  return Number.isInteger(n) && n >= 1860 && n <= 2100 ? n : undefined;
};
const ilikeWrap = (s) => `%${(s || "").toString().trim()}%`;

// Minimal preset list (mirrors your UI constants)
const PRESETS = [
  { name: "ICC Cricket World Cup",           formats: ["ODI"] },
  { name: "ICC Champions Trophy",            formats: ["ODI"] },
  { name: "ICC Men’s T20 World Cup",         formats: ["T20"] },
  { name: "ICC World Test Championship",     formats: ["Test"] },
  { name: "Asia Cup",                         formats: ["ODI","T20"] },
  { name: "ACC Men’s Premier Cup",            formats: ["ODI","T20"] },
  { name: "ACC Men’s Challenger Cup",         formats: ["ODI","T20"] },
  { name: "ACC Emerging Teams Asia Cup",      formats: ["ODI","T20"] },
  { name: "The Ashes",                        formats: ["Test"] },
  { name: "Border–Gavaskar Trophy",           formats: ["Test"] },
  { name: "Chappell–Hadlee Trophy",           formats: ["ODI","T20"] },
];

// Build editions dictionary from DB if possible
async function discoverEditions() {
  const map = new Map(); // key: tournament name -> {name, editions: [{season_year, match_type}]}

  // Helper to push into map
  const push = (name, year, type) => {
    if (!name) return;
    const key = name.trim();
    if (!map.has(key)) map.set(key, { name: key, editions: [] });
    if (year && type) {
      const arr = map.get(key).editions;
      if (!arr.find((e) => e.season_year === year && e.match_type === type)) {
        arr.push({ season_year: year, match_type: type });
      }
    }
  };

  // 1) From match_history (ODI/T20)
  try {
    const q = `
      SELECT DISTINCT
        match_name,
        CASE WHEN match_time IS NOT NULL THEN EXTRACT(YEAR FROM match_time)::int ELSE NULL END AS season_year,
        match_type
      FROM match_history
      WHERE match_name IS NOT NULL AND match_name <> ''
    `;
    const r = await pool.query(q);
    for (const row of r.rows) {
      push(row.match_name, row.season_year || undefined, row.match_type);
    }
  } catch (e) {
    // Table/column might not exist -> ignore
  }

  // 2) From test_match_results (Test)
  try {
    // Prefer created_at for year; if not present, push without year
    const r = await pool.query(`
      SELECT DISTINCT
        match_name,
        CASE
          WHEN to_regclass('public.test_match_results') IS NOT NULL THEN
            CASE
              WHEN to_char(current_date,'YYYY') IS NOT NULL THEN NULL
              ELSE NULL
            END
          ELSE NULL
        END AS dummy -- just to keep query simple across engines
      FROM test_match_results
      WHERE match_name IS NOT NULL AND match_name <> ''
    `);
    // Try again with year extraction (created_at) separately; if it fails we fall back to no-year
    let withYears = [];
    try {
      const y = await pool.query(`
        SELECT DISTINCT
          match_name,
          EXTRACT(YEAR FROM created_at)::int AS season_year
        FROM test_match_results
        WHERE match_name IS NOT NULL AND match_name <> '' AND created_at IS NOT NULL
      `);
      withYears = y.rows;
    } catch {
      // ignore
    }

    const yearMap = new Map(withYears.map((x) => [x.match_name, x.season_year]));
    for (const row of r.rows) {
      const year = yearMap.get(row.match_name);
      push(row.match_name, year || undefined, "Test");
    }
  } catch (e) {
    // ignore
  }

  // If nothing found, fall back to presets with empty editions
  if (map.size === 0) {
    for (const p of PRESETS) {
      map.set(p.name, { name: p.name, editions: [] });
    }
  }

  // Sort editions by year desc for readability
  for (const v of map.values()) {
    v.editions.sort((a, b) => (b.season_year || 0) - (a.season_year || 0));
  }

  // Return array sorted by name
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ---- GET /api/tournaments ---------------------------------------------------
router.get("/tournaments", async (req, res) => {
  try {
    const { match_type } = req.query;
    const type = normType(match_type);
    const editions = await discoverEditions();

    let out = editions;
    if (type && VALID_TYPES.has(type)) {
      if (type.toLowerCase() !== "all") {
        out = editions.map((t) => ({
          name: t.name,
          editions: (t.editions || []).filter((e) => e.match_type?.toLowerCase() === type.toLowerCase()),
        })).filter((t) => t.editions.length);
      }
    }
    // If filtering removed all editions but we still want the catalog names:
    if (!out.length && type && type.toLowerCase() !== "all") {
      out = editions.map((t) => ({ name: t.name, editions: [] }));
    }
    res.json(out);
  } catch (err) {
    // Hard fallback to presets if something goes wrong
    res.json(PRESETS.map((p) => ({ name: p.name, editions: [] })));
  }
});

// ---- GET /api/tournaments/leaderboard --------------------------------------
// Params:
//   - tournament_name (required)
//   - season_year   (optional, int)
//   - match_type    (optional; T20|ODI|Test|All)
router.get("/tournaments/leaderboard", async (req, res) => {
  const tournamentName = (req.query.tournament_name || "").trim();
  const year = safeYear(req.query.season_year);
  const type = normType(req.query.match_type || "All");

  if (!tournamentName) {
    return res.status(400).json({ error: "tournament_name is required" });
  }
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: "Invalid match_type" });
  }

  try {
    const parts = [];

    // ---- LOI (ODI/T20) ----
    if (type.toLowerCase() === "all" || type.toLowerCase() === "odi" || type.toLowerCase() === "t20") {
      const params = [ilikeWrap(tournamentName)];
      let where = `WHERE match_name ILIKE $1 AND match_type IN ('ODI','T20')`;
      // Prefer approved rows if status exists (safe try)
      let approvedWhere = `${where} AND (status IS NULL OR status = 'approved')`;
      if (year) {
        params.push(year);
        approvedWhere += ` AND match_time IS NOT NULL AND EXTRACT(YEAR FROM match_time) = $${params.length}`;
        where += ` AND match_time IS NOT NULL AND EXTRACT(YEAR FROM match_time) = $${params.length}`;
      }

      const sqlBase = (w) => `
        WITH f AS (
          SELECT team1, team2, winner FROM match_history ${w}
        ),
        per_team AS (
          SELECT team1 AS team, winner FROM f
          UNION ALL
          SELECT team2 AS team, winner FROM f
        )
        SELECT
          team AS team_name,
          COUNT(*) AS matches,
          SUM(CASE WHEN LOWER(TRIM(winner)) IN (LOWER(TRIM(team)), LOWER(TRIM(team)) || ' won the match!') THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw','no result','no-result') THEN 1 ELSE 0 END) AS draws,
          SUM(
            CASE WHEN winner IS NOT NULL AND winner <> '' 
              AND LOWER(TRIM(winner)) NOT IN (LOWER(TRIM(team)), LOWER(TRIM(team)) || ' won the match!', 'draw','match draw','no result','no-result')
            THEN 1 ELSE 0 END
          ) AS losses,
          (SUM(CASE WHEN LOWER(TRIM(winner)) IN (LOWER(TRIM(team)), LOWER(TRIM(team)) || ' won the match!') THEN 1 ELSE 0 END) * 2
           + SUM(CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw','no result','no-result') THEN 1 ELSE 0 END) * 1) AS points,
          'ODI/T20' AS match_type
        FROM per_team
        GROUP BY team
        ORDER BY points DESC, wins DESC, team ASC
      `;

      let loiRows = [];
      try {
        const r = await pool.query(sqlBase(approvedWhere), params);
        loiRows = r.rows;
      } catch {
        const r2 = await pool.query(sqlBase(where), params);
        loiRows = r2.rows;
      }
      parts.push(...loiRows);
    }

    // ---- Test ----
    if (type.toLowerCase() === "all" || type.toLowerCase() === "test") {
      const params = [ilikeWrap(tournamentName)];
      let where = `WHERE match_name ILIKE $1`;

      // Try to include season_year filter via created_at when available
      let tryWithYear = false;
      if (year) {
        tryWithYear = true;
        params.push(year);
      }

      const baseSQL = (useYear) => `
        WITH f AS (
          SELECT team1, team2, winner FROM test_match_results
          ${useYear ? `WHERE match_name ILIKE $1 AND created_at IS NOT NULL AND EXTRACT(YEAR FROM created_at) = $2`
                     : `WHERE match_name ILIKE $1`}
        ),
        per_team AS (
          SELECT team1 AS team, winner FROM f
          UNION ALL
          SELECT team2 AS team, winner FROM f
        )
        SELECT
          team AS team_name,
          COUNT(*) AS matches,
          SUM(CASE WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team)) THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN LOWER(TRIM(winner)) != LOWER(TRIM(team)) AND LOWER(TRIM(winner)) NOT IN ('draw','match draw') THEN 1 ELSE 0 END) AS losses,
          SUM(CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw') THEN 1 ELSE 0 END) AS draws,
          (SUM(CASE WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team)) THEN 1 ELSE 0 END) * 12
           + SUM(CASE WHEN LOWER(TRIM(winner)) != LOWER(TRIM(team)) AND LOWER(TRIM(winner)) NOT IN ('draw','match draw') THEN 1 ELSE 0 END) * 6
           + SUM(CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw') THEN 1 ELSE 0 END) * 4) AS points,
          'Test' AS match_type
        FROM per_team
        GROUP BY team
        ORDER BY points DESC, wins DESC, team ASC
      `;

      let testRows = [];
      try {
        const r = await pool.query(baseSQL(tryWithYear), params);
        testRows = r.rows;
      } catch {
        // Fall back without year (e.g., created_at missing)
        const r2 = await pool.query(baseSQL(false), [params[0]]);
        testRows = r2.rows;
      }
      parts.push(...testRows);
    }

    res.json(parts);
  } catch (err) {
    console.error("TOURNAMENT LEADERBOARD ERROR:", err);
    res.status(500).json({ error: "Failed to build tournament leaderboard" });
  }
});

// ---- GET /api/tournaments/matches ------------------------------------------
// Raw matches for a tournament/year (useful for details page)
router.get("/tournaments/matches", async (req, res) => {
  const tournamentName = (req.query.tournament_name || "").trim();
  const year = safeYear(req.query.season_year);
  const type = normType(req.query.match_type || "All");

  if (!tournamentName) {
    return res.status(400).json({ error: "tournament_name is required" });
  }
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: "Invalid match_type" });
  }

  const out = { odi_t20: [], test: [] };

  try {
    // LOI
    if (type.toLowerCase() === "all" || type.toLowerCase() === "odi" || type.toLowerCase() === "t20") {
      const params = [ilikeWrap(tournamentName)];
      let where = `WHERE match_name ILIKE $1 AND match_type IN ('ODI','T20')`;
      let approvedWhere = `${where} AND (status IS NULL OR status = 'approved')`;
      if (year) {
        params.push(year);
        where += ` AND match_time IS NOT NULL AND EXTRACT(YEAR FROM match_time) = $${params.length}`;
        approvedWhere += ` AND match_time IS NOT NULL AND EXTRACT(YEAR FROM match_time) = $${params.length}`;
      }

      const sql = (w) => `
        SELECT * FROM match_history ${w}
        ORDER BY match_time DESC NULLS LAST, id DESC
      `;
      try {
        const r = await pool.query(sql(approvedWhere), params);
        out.odi_t20 = r.rows;
      } catch {
        const r2 = await pool.query(sql(where), params);
        out.odi_t20 = r2.rows;
      }
    }

    // Test
    if (type.toLowerCase() === "all" || type.toLowerCase() === "test") {
      const params = [ilikeWrap(tournamentName)];
      const sqlNoYear = `
        SELECT * FROM test_match_results
        WHERE match_name ILIKE $1
        ORDER BY created_at DESC NULLS LAST, id DESC
      `;
      if (year) {
        // Try filter by created_at year; if column missing, fallback to no-year
        try {
          const r = await pool.query(`
            SELECT * FROM test_match_results
            WHERE match_name ILIKE $1
              AND created_at IS NOT NULL
              AND EXTRACT(YEAR FROM created_at) = $2
            ORDER BY created_at DESC NULLS LAST, id DESC
          `, [params[0], year]);
          out.test = r.rows;
        } catch {
          const r2 = await pool.query(sqlNoYear, params);
          out.test = r2.rows;
        }
      } else {
        const r = await pool.query(sqlNoYear, params);
        out.test = r.rows;
      }
    }

    res.json(out);
  } catch (err) {
    console.error("TOURNAMENT MATCHES ERROR:", err);
    res.status(500).json({ error: "Failed to fetch tournament matches" });
  }
});

module.exports = router;
