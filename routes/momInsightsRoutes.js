// ✅ routes/momInsightsRoutes.js
// ✅ [04-NOV-2025 | Ranaj Parida] MoM analytics across match_history + test_match_results
// Exposes:
//   GET /api/mom-insights/meta   → dropdown data (match types, tournaments, seasons)
//   GET /api/mom-insights        → filtered MoM records + aggregated player-wise summary

const express = require("express");
const router = express.Router();
const pool = require("../db");

// small helper to trim and normalize empties
const clean = (v) => {
  if (v === null || v === undefined) return null;
  const t = v.toString().trim();
  if (!t || t.toLowerCase() === "null" || t.toLowerCase() === "undefined") return null;
  return t;
};

/**
 * GET /api/mom-insights/meta
 * Returns distinct lists needed for dropdowns:
 *  - match_types → from actual data (T20/ODI from match_history, add Test if present in test_match_results)
 *  - tournaments → DISTINCT from match_history + test_match_results, filtered for null/empty/"null"
 *  - seasons     → DISTINCT season_year from both tables, filtered
 */
router.get("/mom-insights/meta", async (req, res) => {
  try {
    // 1) formats from match_history
    const mhFormats = await pool.query(`
      SELECT DISTINCT match_type
      FROM match_history
      WHERE match_type IS NOT NULL AND match_type <> ''
    `);

    // 2) check if there is at least one test MoM
    const testHasMom = await pool.query(`
      SELECT 1
      FROM test_match_results
      WHERE mom_player IS NOT NULL AND mom_player <> ''
      LIMIT 1
    `);

    const matchTypeSet = new Set();
    mhFormats.rows.forEach((r) => {
      const v = clean(r.match_type);
      if (v) matchTypeSet.add(v);
    });
    if (testHasMom.rows.length > 0) {
      matchTypeSet.add("Test");
    }
    const match_types = Array.from(matchTypeSet).sort(); // e.g. ["ODI","T20","Test"]

    // 3) tournaments from both tables
    const tournamentsResult = await pool.query(`
      SELECT DISTINCT tournament_name
      FROM (
        SELECT tournament_name FROM match_history
        UNION ALL
        SELECT tournament_name FROM test_match_results
      ) t
      ORDER BY tournament_name ASC
    `);

    const tournaments = tournamentsResult.rows
      .map((r) => clean(r.tournament_name))
      .filter(Boolean); // remove null/empty/"null"

    // 4) seasons from both tables
    const seasonsResult = await pool.query(`
      SELECT DISTINCT season_year
      FROM (
        SELECT season_year FROM match_history
        UNION ALL
        SELECT season_year FROM test_match_results
      ) s
      ORDER BY season_year DESC
    `);

    const seasons = seasonsResult.rows
      .map((r) => clean(r.season_year))
      .filter(Boolean);

    return res.json({
      match_types,
      tournaments,
      seasons,
    });
  } catch (err) {
    console.error("❌ /mom-insights/meta error:", err);
    return res.status(500).json({ error: "Failed to load dropdown data" });
  }
});

/**
 * GET /api/mom-insights
 * Query params (all optional):
 *  - match_type
 *  - tournament_name
 *  - season_year (YYYY only)
 *  - player
 *
 * Returns:
 *  {
 *    summary: [ { player, count, formats:[], tournaments:[] } ],
 *    records: [ ...each match where he got MoM... ]
 *  }
 */
router.get("/mom-insights", async (req, res) => {
  try {
    const { match_type, tournament_name, season_year, player } = req.query;

    // ✅ validation
    if (season_year && !/^\d{4}$/.test(season_year.toString().trim())) {
      return res.status(400).json({ error: "Season year must be in YYYY format." });
    }

    const params = [];
    const conditions = [];

    const add = (sql, val) => {
      params.push(val);
      conditions.push(sql.replace("?", `$${params.length}`));
    };

    if (match_type) add("m.match_type ILIKE ?", `%${clean(match_type)}%`);
    if (tournament_name) add("m.tournament_name ILIKE ?", `%${clean(tournament_name)}%`);
    if (season_year) add("CAST(m.season_year AS TEXT) ILIKE ?", `%${clean(season_year)}%`);
    if (player) add("m.mom_player ILIKE ?", `%${clean(player)}%`);

    const whereClause = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    // ✅ union ODI/ODI from match_history + Test from test_match_results
    const sql = `
      SELECT 
        m.mom_player      AS player_name,
        m.mom_reason      AS reason,
        m.match_name,
        m.tournament_name,
        m.season_year,
        m.match_type,
        m.match_date
      FROM (
        SELECT mom_player, mom_reason, match_name, tournament_name, season_year, match_type, match_date 
        FROM match_history
        WHERE mom_player IS NOT NULL AND mom_player <> ''
        UNION ALL
        SELECT mom_player, mom_reason, match_name, tournament_name, season_year, 'Test' AS match_type, match_date 
        FROM test_match_results
        WHERE mom_player IS NOT NULL AND mom_player <> ''
      ) m
      ${whereClause}
      ORDER BY m.match_date DESC NULLS LAST, m.match_name ASC
    `;

    const { rows } = await pool.query(sql, params);

    if (!rows.length) {
      return res.json({ summary: [], records: [] });
    }

    // ✅ build player-wise summary
    const summaryMap = {};
    for (const row of rows) {
      const key = clean(row.player_name) || "Unknown";
      if (!summaryMap[key]) {
        summaryMap[key] = {
          player: key,
          count: 0,
          formats: new Set(),
          tournaments: new Set(),
        };
      }
      summaryMap[key].count += 1;
      const fmt = clean(row.match_type);
      const tour = clean(row.tournament_name);
      if (fmt) summaryMap[key].formats.add(fmt);
      if (tour) summaryMap[key].tournaments.add(tour);
    }

    const summary = Object.values(summaryMap)
      .map((s) => ({
        player: s.player,
        count: s.count,
        formats: Array.from(s.formats),
        tournaments: Array.from(s.tournaments),
      }))
      .sort((a, b) => b.count - a.count);

    return res.json({
      summary,
      records: rows,
    });
  } catch (err) {
    console.error("❌ /mom-insights error:", err);
    return res.status(500).json({ error: "Failed to fetch MoM insights" });
  }
});

module.exports = router;
