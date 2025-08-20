// ✅ routes/tournamentRoutes.js
// Tournament-aware endpoints backed by match_history (ODI/T20) and optional Test in future
// Endpoints used by src/services/api.js:
//  - GET /api/tournaments                 → catalog (name + editions)
//  - GET /api/tournaments/leaderboard     → per-tournament season table (ODI/T20; Test ignored for NRR)
//  - GET /api/tournaments/matches         → raw matches for that tournament season

const express = require("express");
const router = express.Router();
const pool = require("../db");

// Lower-trim helper
const norm = (s) => (s ?? "").toString().trim();
const canon = (s) => norm(s).toLowerCase();

/**
 * GET /api/tournaments?match_type=ODI|T20|Test
 * Returns: [{ name, editions: [{season_year, match_type, matches}] }]
 * Uses match_history (ODI/T20). Test can be added later if needed.
 */
router.get("/", async (req, res) => {
  try {
    const { match_type } = req.query;
    const mtFilter = match_type && ["ODI", "T20"].includes(match_type) ? match_type : null;

    const result = await pool.query(
      `
      SELECT
        MIN(tournament_name) AS display_name,
        LOWER(TRIM(tournament_name)) AS key_name,
        season_year,
        match_type,
        COUNT(*) AS matches
      FROM match_history
      WHERE tournament_name IS NOT NULL AND tournament_name <> ''
        ${mtFilter ? "AND match_type = $1" : ""}
      GROUP BY LOWER(TRIM(tournament_name)), season_year, match_type
      ORDER BY MIN(tournament_name), season_year DESC
      `,
      mtFilter ? [match_type] : []
    );

    const map = new Map();
    for (const r of result.rows) {
      const key = r.key_name;
      if (!map.has(key)) {
        map.set(key, { name: r.display_name, editions: [] });
      }
      map.get(key).editions.push({
        season_year: Number(r.season_year),
        match_type: r.match_type,
        matches: Number(r.matches),
      });
    }

    res.json(Array.from(map.values()));
  } catch (err) {
    console.error("❌ tournaments catalog error:", err);
    res.status(500).json({ error: "Failed to load tournaments catalog" });
  }
});

/**
 * GET /api/tournaments/leaderboard?tournament_name=...&season_year=...&match_type=All|ODI|T20
 * Returns aggregated table:
 *  team_name, matches, wins, losses, draws, points, nrr, tournament_name, season_year, match_type
 * Only ODI/T20 (NRR) for now.
 */
router.get("/leaderboard", async (req, res) => {
  try {
    const { tournament_name, season_year, match_type = "All" } = req.query;
    if (!tournament_name || !season_year) {
      return res.status(400).json({ error: "tournament_name and season_year are required" });
    }

    const mtClause =
      match_type === "All" ? "IN ('ODI','T20')" :
      ["ODI","T20"].includes(match_type) ? `= '${match_type}'` :
      "IN ('ODI','T20')"; // ignore Test here by design

    const sql = `
      WITH base AS (
        SELECT *
        FROM match_history
        WHERE tournament_name IS NOT NULL AND tournament_name <> ''
          AND LOWER(TRIM(tournament_name)) = LOWER(TRIM($1))
          AND season_year = $2
          AND match_type ${mtClause}
      ),
      per_team AS (
        -- perspective for team1
        SELECT
          LOWER(TRIM(team1)) AS team_key,
          team1 AS team_name,
          1 AS matches,
          CASE WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team1)) || ' won the match!' THEN 1 ELSE 0 END AS wins,
          CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw') THEN 1 ELSE 0 END AS draws,
          CASE 
            WHEN winner IS NOT NULL AND winner <> '' 
              AND LOWER(TRIM(winner)) NOT IN (
                LOWER(TRIM(team1)) || ' won the match!', 'draw','match draw'
              ) 
            THEN 1 ELSE 0 
          END AS losses,
          runs1::int AS runs_for,
          overs1::decimal AS overs_faced,
          runs2::int AS runs_against,
          overs2::decimal AS overs_bowled
        FROM base
        UNION ALL
        -- perspective for team2
        SELECT
          LOWER(TRIM(team2)) AS team_key,
          team2 AS team_name,
          1 AS matches,
          CASE WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team2)) || ' won the match!' THEN 1 ELSE 0 END AS wins,
          CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw') THEN 1 ELSE 0 END AS draws,
          CASE 
            WHEN winner IS NOT NULL AND winner <> '' 
              AND LOWER(TRIM(winner)) NOT IN (
                LOWER(TRIM(team2)) || ' won the match!', 'draw','match draw'
              ) 
            THEN 1 ELSE 0 
          END AS losses,
          runs2::int AS runs_for,
          overs2::decimal AS overs_faced,
          runs1::int AS runs_against,
          overs1::decimal AS overs_bowled
        FROM base
      )
      SELECT
        MIN(team_name) AS team_name,
        SUM(matches) AS matches,
        SUM(wins) AS wins,
        SUM(losses) AS losses,
        SUM(draws) AS draws,
        (SUM(wins) * 2 + SUM(draws) * 1) AS points,
        ROUND(
          (SUM(runs_for)::decimal / NULLIF(SUM(overs_faced),0))
          -
          (SUM(runs_against)::decimal / NULLIF(SUM(overs_bowled),0))
          , 2
        ) AS nrr,
        MIN($1) AS tournament_name,
        MIN($2::int) AS season_year,
        ${match_type === "All" ? ` 'All' ` : ` '${match_type}' `} AS match_type
      FROM per_team
      GROUP BY team_key
      ORDER BY points DESC, nrr DESC, team_name ASC
    `;

    const result = await pool.query(sql, [tournament_name, Number(season_year)]);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ tournaments leaderboard error:", err);
    res.status(500).json({ error: "Failed to load tournament leaderboard" });
  }
});

/**
 * GET /api/tournaments/matches?tournament_name=...&season_year=...&match_type=All|ODI|T20
 * Raw matches for that tournament season (ODI/T20 only for now).
 */
router.get("/matches", async (req, res) => {
  try {
    const { tournament_name, season_year, match_type = "All" } = req.query;
    if (!tournament_name || !season_year) {
      return res.status(400).json({ error: "tournament_name and season_year are required" });
    }

    const mtFilter =
      match_type === "All" ? ["ODI", "T20"] :
      ["ODI", "T20"].includes(match_type) ? [match_type] : ["ODI", "T20"];

    const result = await pool.query(
      `
      SELECT *
      FROM match_history
      WHERE tournament_name IS NOT NULL AND tournament_name <> ''
        AND LOWER(TRIM(tournament_name)) = LOWER(TRIM($1))
        AND season_year = $2
        AND match_type = ANY($3)
      ORDER BY COALESCE(match_date::timestamp, match_time, created_at) DESC
      `,
      [tournament_name, Number(season_year), mtFilter]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ tournaments matches error:", err);
    res.status(500).json({ error: "Failed to load tournament matches" });
  }
});

module.exports = router;
