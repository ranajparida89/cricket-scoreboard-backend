// routes/tournamentRoutes.js
// Tournament endpoints backed by match_history (ODI/T20). Robust winner parsing.

const express = require("express");
const router = express.Router();
const pool = require("../db");

// helpers
const norm  = (s) => (s ?? "").toString().trim();
const canon = (s) => norm(s).toLowerCase();

/**
 * GET /api/tournaments?match_type=All|ODI|T20
 * Returns [{ name, editions:[{season_year, match_type, matches}] }]
 */
router.get("/", async (req, res) => {
  try {
    const { match_type = "All" } = req.query;
    const mtArr =
      match_type === "All" ? ["ODI", "T20"] :
      ["ODI", "T20"].includes(match_type) ? [match_type] :
      ["ODI", "T20"];

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
      if (!map.has(r.key_name)) {
        map.set(r.key_name, { name: r.display_name, editions: [] });
      }
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
 * Query: tournament_name? (optional), season_year? (optional), match_type=All|ODI|T20
 * Aggregates by team from match_history and computes Points + NRR.
 * Winner parsing: "<team> won the match!" (case/! tolerant). Draws handled.
 */
router.get("/leaderboard", async (req, res) => {
  try {
    const { tournament_name, season_year, match_type = "All" } = req.query;

    const mtArr =
      match_type === "All" ? ["ODI", "T20"] :
      ["ODI", "T20"].includes(match_type) ? [match_type] :
      ["ODI", "T20"];

    const cond = [];
    const vals = [];

    // match_type filter
    vals.push(mtArr);
    cond.push(`match_type = ANY($${vals.length})`);

    // tournament filter (optional)
    if (tournament_name) {
      vals.push(tournament_name);
      cond.push(`LOWER(TRIM(tournament_name)) = LOWER(TRIM($${vals.length}))`);
    }

    // season filter (optional)
    if (season_year) {
      vals.push(Number(season_year));
      cond.push(`season_year = $${vals.length}`);
    }

    const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

    // Note the LIKE pattern to be tolerant to optional "!" or extra suffix
    // and explicit draw aliases.
    const sql = `
      WITH base AS (
        SELECT *
        FROM match_history
        ${where}
      ),
      t1 AS (
        SELECT
          LOWER(TRIM(team1)) AS team_key,
          MIN(team1)        AS team_name,
          COUNT(*)          AS matches,
          SUM(CASE
                WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team1)) || ' won the match!'
                  OR LOWER(TRIM(winner)) LIKE LOWER(TRIM(team1)) || ' won the match%' THEN 1
                ELSE 0
              END)           AS wins,
          SUM(CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw','match drawn') THEN 1 ELSE 0 END) AS draws,
          SUM(CASE
                WHEN winner IS NOT NULL AND winner <> '' AND
                     LOWER(TRIM(winner)) NOT IN (
                       LOWER(TRIM(team1)) || ' won the match!',
                       'draw','match draw','match drawn'
                     )
                THEN 1 ELSE 0
              END)           AS losses,
          SUM(runs1)::int   AS runs_for,
          SUM(overs1)::decimal AS overs_faced,
          SUM(runs2)::int   AS runs_against,
          SUM(overs2)::decimal AS overs_bowled
        FROM base
        GROUP BY LOWER(TRIM(team1))
      ),
      t2 AS (
        SELECT
          LOWER(TRIM(team2)) AS team_key,
          MIN(team2)        AS team_name,
          COUNT(*)          AS matches,
          SUM(CASE
                WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team2)) || ' won the match!'
                  OR LOWER(TRIM(winner)) LIKE LOWER(TRIM(team2)) || ' won the match%' THEN 1
                ELSE 0
              END)           AS wins,
          SUM(CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw','match drawn') THEN 1 ELSE 0 END) AS draws,
          SUM(CASE
                WHEN winner IS NOT NULL AND winner <> '' AND
                     LOWER(TRIM(winner)) NOT IN (
                       LOWER(TRIM(team2)) || ' won the match!',
                       'draw','match draw','match drawn'
                     )
                THEN 1 ELSE 0
              END)           AS losses,
          SUM(runs2)::int   AS runs_for,
          SUM(overs2)::decimal AS overs_faced,
          SUM(runs1)::int   AS runs_against,
          SUM(overs1)::decimal AS overs_bowled
        FROM base
        GROUP BY LOWER(TRIM(team2))
      ),
      per_team AS (
        SELECT * FROM t1
        UNION ALL
        SELECT * FROM t2
      )
      SELECT
        MIN(team_name) AS team_name,
        SUM(matches)   AS matches,
        SUM(wins)      AS wins,
        SUM(losses)    AS losses,
        SUM(draws)     AS draws,
        (SUM(wins)*2 + SUM(draws)*1) AS points,
        ROUND(
          (SUM(runs_for)::decimal / NULLIF(SUM(overs_faced),0))
          -
          (SUM(runs_against)::decimal / NULLIF(SUM(overs_bowled),0))
        , 2) AS nrr,
        MIN(COALESCE(tournament_name,'')) AS tournament_name,
        MIN(COALESCE(season_year::int,0)) AS season_year,
        CASE WHEN $1::text[] = ARRAY['ODI','T20'] THEN 'All' ELSE (SELECT $1::text[])[1] END AS match_type
      FROM per_team
      LEFT JOIN base b ON (b.team1 = per_team.team_name OR b.team2 = per_team.team_name)
      GROUP BY team_key
      ORDER BY points DESC, nrr DESC, team_name ASC
    `;

    const result = await pool.query(sql, vals);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ tournaments leaderboard error:", err);
    res.status(500).json({ error: "Failed to load tournament leaderboard" });
  }
});

module.exports = router;
