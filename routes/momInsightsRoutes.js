// ✅ routes/momInsightsRoutes.js
// ✅ [04-NOV-2025 | Ranaj Parida] MoM analytics across match_history + test_match_results
// Exposes:
//   GET /api/mom-insights/meta   → dropdown data (match types, tournaments, seasons)
//   GET /api/mom-insights        → filtered MoM records + aggregated player-wise summary

const express = require("express");
const router = express.Router();
const pool = require("../db");

// small helper to trim
const clean = (v) => (v ? v.toString().trim() : null);

/**
 * GET /api/mom-insights/meta
 * Returns distinct lists needed for dropdowns:
 *  - match_types → from your app it's basically ['T20','ODI','Test']
 *  - tournaments → DISTINCT from match_history + test_match_results
 *  - seasons     → DISTINCT season_year from both tables
 */
router.get("/mom-insights/meta", async (req, res) => {
  try {
    // match types are known, but we can still keep it dynamic
    const matchTypes = ["T20", "ODI", "Test"];

    // distinct tournaments from both tables
    const tournamentsQuery = `
      SELECT DISTINCT tournament_name
      FROM (
        SELECT tournament_name FROM match_history
        UNION ALL
        SELECT tournament_name FROM test_match_results
      ) t
      WHERE tournament_name IS NOT NULL AND tournament_name <> ''
      ORDER BY tournament_name ASC
    `;
    const tournamentsResult = await pool.query(tournamentsQuery);

    // distinct seasons
    const seasonsQuery = `
      SELECT DISTINCT season_year
      FROM (
        SELECT season_year FROM match_history
        UNION ALL
        SELECT season_year FROM test_match_results
      ) s
      WHERE season_year IS NOT NULL AND season_year <> ''
      ORDER BY season_year DESC
    `;
    const seasonsResult = await pool.query(seasonsQuery);

    return res.json({
      match_types: matchTypes,
      tournaments: tournamentsResult.rows.map((r) => r.tournament_name),
      seasons: seasonsResult.rows.map((r) => r.season_year),
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

    // ✅ we union ODI/T20 + Test, normalize test's match_type to 'Test'
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

    // if no data, return empty structure
    if (!rows.length) {
      return res.json({ summary: [], records: [] });
    }

    // ✅ build player-wise summary
    const summaryMap = {};
    for (const row of rows) {
      const key = row.player_name || "Unknown";
      if (!summaryMap[key]) {
        summaryMap[key] = {
          player: key,
          count: 0,
          formats: new Set(),
          tournaments: new Set(),
        };
      }
      summaryMap[key].count += 1;
      if (row.match_type) summaryMap[key].formats.add(row.match_type);
      if (row.tournament_name) summaryMap[key].tournaments.add(row.tournament_name);
    }

    const summary = Object.values(summaryMap)
      .map((s) => ({
        player: s.player,
        count: s.count,
        formats: Array.from(s.formats),
        tournaments: Array.from(s.tournaments),
      }))
      .sort((a, b) => b.count - a.count); // highest first

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
