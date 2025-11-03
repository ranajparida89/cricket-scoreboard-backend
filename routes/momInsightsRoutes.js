// ✅ momInsightsRoutes.js [Final Advanced Version - 2025-11-04]
// Author: Ranaj Parida
// Purpose: Aggregate, validate, and visualize Man of the Match insights across all formats.

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Simple validator to sanitize strings
const clean = (val) => (val ? val.toString().trim() : null);

router.get("/mom-insights", async (req, res) => {
  try {
    const { match_type, tournament_name, season_year, player } = req.query;

    // ✅ 1. Validate inputs
    if (season_year && !/^\d{4}$/.test(season_year))
      return res.status(400).json({ error: "Invalid year format. Use YYYY." });

    const params = [];
    const conditions = [];

    const addCondition = (clause, val) => {
      params.push(val);
      conditions.push(clause.replace("?", `$${params.length}`));
    };

    if (match_type) addCondition("m.match_type ILIKE ?", `%${clean(match_type)}%`);
    if (tournament_name) addCondition("m.tournament_name ILIKE ?", `%${clean(tournament_name)}%`);
    if (season_year) addCondition("CAST(m.season_year AS TEXT) ILIKE ?", `%${clean(season_year)}%`);
    if (player) addCondition("m.mom_player ILIKE ?", `%${clean(player)}%`);

    const whereClause = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    // ✅ 2. Main query: combine ODI/T20/Test data
    const query = `
      SELECT 
        m.mom_player AS player_name,
        m.mom_reason AS reason,
        m.match_name,
        m.tournament_name,
        m.season_year,
        m.match_type,
        m.match_date
      FROM (
        SELECT mom_player, mom_reason, match_name, tournament_name, season_year, match_type, match_date 
          FROM match_history
        UNION ALL
        SELECT mom_player, mom_reason, match_name, tournament_name, season_year, 'Test' AS match_type, match_date 
          FROM test_match_results
      ) m
      ${whereClause}
      ORDER BY m.match_date DESC NULLS LAST
    `;

    const { rows } = await pool.query(query, params);
    if (!rows.length) return res.status(200).json({ summary: [], records: [] });

    // ✅ 3. Build summary with stats per player
    const summaryMap = {};
    for (const r of rows) {
      const name = r.player_name || "Unknown";
      summaryMap[name] = (summaryMap[name] || { count: 0, formats: new Set(), tournaments: new Set() });
      summaryMap[name].count++;
      summaryMap[name].formats.add(r.match_type);
      if (r.tournament_name) summaryMap[name].tournaments.add(r.tournament_name);
    }

    const summaryArr = Object.entries(summaryMap)
      .map(([player, s]) => ({
        player,
        count: s.count,
        formats: [...s.formats],
        tournaments: [...s.tournaments],
      }))
      .sort((a, b) => b.count - a.count);

    return res.status(200).json({ summary: summaryArr, records: rows });
  } catch (err) {
    console.error("❌ MoM Insights Error:", err);
    res.status(500).json({ error: "Server error while fetching MoM insights." });
  }
});

module.exports = router;
