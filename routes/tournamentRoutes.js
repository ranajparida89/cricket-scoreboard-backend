// routes/tournamentRoutes.js
// Tournament endpoints backed by match_history (ODI/T20). Robust winner parsing.
// FIX: remove multiplicative LEFT JOIN; attach tournament/year via a 1-row-per-team CTE.

const express = require("express");
const router = express.Router();
const pool = require("../db");

// small helper
const norm = (s) => (s ?? "").toString().trim();

/**
 * GET /api/tournaments?match_type=All|ODI|T20
 * Returns [{ name, editions:[{season_year, match_type, matches}] }]
 */
router.get("/", async (req, res) => {
  try {
    const { match_type = "All" } = req.query;
    const mtArr =
      match_type === "All"
        ? ["ODI", "T20"]
        : ["ODI", "T20"].includes(match_type)
        ? [match_type]
        : ["ODI", "T20"];

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
        AND match_type = ANY($1)
      GROUP BY LOWER(TRIM(tournament_name)), season_year, match_type
      ORDER BY MIN(tournament_name), season_year DESC
      `,
      [mtArr]
    );

    const map = new Map();
    for (const r of result.rows) {
      if (!map.has(r.key_name)) map.set(r.key_name, { name: r.display_name, editions: [] });
      map.get(r.key_name).editions.push({
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
 * GET /api/tournaments/leaderboard
 * Query: match_type=All|ODI|T20, tournament_name?, season_year?
 * Uses the approved SQL; FIXED: no multiplicative join.
 */
router.get("/leaderboard", async (req, res) => {
  try {
    const { match_type = "All", tournament_name = null, season_year = null } = req.query;

    const mtArr =
      match_type === "All"
        ? ["T20", "ODI"]
        : ["T20", "ODI"].includes(match_type)
        ? [match_type]
        : ["T20", "ODI"];

    const sql = `
      WITH base AS (
        SELECT *
        FROM match_history
        WHERE match_type = ANY($1)
          AND ($2::text IS NULL OR LOWER(TRIM(tournament_name)) = LOWER(TRIM($2)))
          AND ($3::int  IS NULL OR season_year = $3::int)
      ),
      t1 AS (
        SELECT
          LOWER(TRIM(team1)) AS team_key, MIN(team1) AS team_name, COUNT(*) AS matches,
          SUM(CASE
                WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team1)) || ' won the match!'
                  OR LOWER(TRIM(winner)) LIKE LOWER(TRIM(team1)) || ' won the match%' THEN 1
                ELSE 0
              END) AS wins,
          SUM(CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw','match drawn') THEN 1 ELSE 0 END) AS draws,
          SUM(CASE
                WHEN winner IS NOT NULL AND winner <> '' AND
                     LOWER(TRIM(winner)) NOT IN (
                       LOWER(TRIM(team1)) || ' won the match!',
                       'draw','match draw','match drawn'
                     )
                THEN 1 ELSE 0
              END) AS losses,
          SUM(runs1)::int AS runs_for,  SUM(overs1)::decimal AS overs_faced,
          SUM(runs2)::int AS runs_against, SUM(overs2)::decimal AS overs_bowled
        FROM base
        GROUP BY LOWER(TRIM(team1))
      ),
      t2 AS (
        SELECT
          LOWER(TRIM(team2)) AS team_key, MIN(team2) AS team_name, COUNT(*) AS matches,
          SUM(CASE
                WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team2)) || ' won the match!'
                  OR LOWER(TRIM(winner)) LIKE LOWER(TRIM(team2)) || ' won the match%' THEN 1
                ELSE 0
              END) AS wins,
          SUM(CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw','match drawn') THEN 1 ELSE 0 END) AS draws,
          SUM(CASE
                WHEN winner IS NOT NULL AND winner <> '' AND
                     LOWER(TRIM(winner)) NOT IN (
                       LOWER(TRIM(team2)) || ' won the match!',
                       'draw','match draw','match drawn'
                     )
                THEN 1 ELSE 0
              END) AS losses,
          SUM(runs2)::int AS runs_for,  SUM(overs2)::decimal AS overs_faced,
          SUM(runs1)::int AS runs_against, SUM(overs1)::decimal AS overs_bowled
        FROM base
        GROUP BY LOWER(TRIM(team2))
      ),
      per_team AS (
        SELECT * FROM t1
        UNION ALL
        SELECT * FROM t2
      ),
      -- ❗ attach tournament/year as a 1-row-per-team meta so we don't multiply sums
      team_meta AS (
        SELECT team_key,
               MIN(tournament_name) AS tournament_name,
               MIN(season_year)::int AS season_year
        FROM (
          SELECT LOWER(TRIM(team1)) AS team_key, MIN(tournament_name) AS tournament_name, MIN(season_year) AS season_year
          FROM base GROUP BY LOWER(TRIM(team1))
          UNION ALL
          SELECT LOWER(TRIM(team2)) AS team_key, MIN(tournament_name) AS tournament_name, MIN(season_year) AS season_year
          FROM base GROUP BY LOWER(TRIM(team2))
        ) s
        GROUP BY team_key
      )
      SELECT
        MIN(pt.team_name) AS team_name,
        SUM(pt.matches)   AS matches,
        SUM(pt.wins)      AS wins,
        SUM(pt.losses)    AS losses,
        SUM(pt.draws)     AS draws,
        (SUM(pt.wins)*2 + SUM(pt.draws)) AS points,
        ROUND(
          (SUM(pt.runs_for)::decimal/NULLIF(SUM(pt.overs_faced),0))
          -
          (SUM(pt.runs_against)::decimal/NULLIF(SUM(pt.overs_bowled),0))
        , 2) AS nrr,
        COALESCE(tm.tournament_name, '') AS tournament_name,
        COALESCE(tm.season_year, 0)      AS season_year
      FROM per_team pt
      LEFT JOIN team_meta tm USING (team_key)
      GROUP BY pt.team_key, tm.tournament_name, tm.season_year
      ORDER BY points DESC, nrr DESC, team_name ASC;
    `;

    const { rows } = await pool.query(
      sql,
      [mtArr, tournament_name ? norm(tournament_name) : null, season_year ? Number(season_year) : null]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ tournaments leaderboard error:", err);
    res.status(500).json({ error: "Failed to load tournament leaderboard" });
  }
});

module.exports = router;
