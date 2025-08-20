// routes/tournaments.js
// Read-only tournament endpoints built on top of existing match_history (ODI/T20)
// Test can be added later; currently ignored for NRR simplicity.

const express = require("express");
const router = express.Router();
const pool = require("../db");

// helpers
const canon = (s) => (s || "").toString().trim().toLowerCase();
const asInt = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

/**
 * GET /api/tournaments
 * Returns the catalog of (tournament_name, season_year) found in match_history (ODI/T20 only), with counts.
 * Optional: ?match_type=ODI|T20
 */
router.get("/", async (req, res) => {
  try {
    const { match_type } = req.query;
    const params = [];
    let where = `
      tournament_name IS NOT NULL AND tournament_name <> ''
      AND status = 'approved'
      AND match_type IN ('ODI','T20')
    `;
    if (match_type && ["ODI", "T20"].includes(match_type)) {
      params.push(match_type);
      where += ` AND match_type = $${params.length}`;
    }

    const sql = `
      SELECT
        -- Keep a stable display name while grouping case-insensitively
        MIN(tournament_name) AS tournament_name,
        season_year,
        ARRAY_AGG(DISTINCT match_type) AS match_types,
        COUNT(*) AS total_matches
      FROM match_history
      WHERE ${where}
      GROUP BY LOWER(TRIM(tournament_name)), season_year
      ORDER BY MIN(tournament_name), season_year DESC
    `;

    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) {
    console.error("[tournaments] list error:", err);
    res.status(500).json({ error: "Failed to load tournaments" });
  }
});

/**
 * GET /api/tournaments/leaderboard
 * Query: tournament_name (required), season_year (optional), match_type=All|ODI|T20 (default All)
 * Returns: Team, Matches, Wins, Losses, Draws, Points, NRR  (NRR only for ODI/T20)
 */
router.get("/leaderboard", async (req, res) => {
  try {
    const { tournament_name } = req.query;
    const season_year = asInt(req.query.season_year);
    const match_type = (req.query.match_type || "All").trim();

    if (!tournament_name) {
      return res.status(400).json({ error: "tournament_name is required" });
    }

    // Allowed types for now
    const types =
      match_type === "All"
        ? ["ODI", "T20"]
        : ["ODI", "T20"].includes(match_type)
        ? [match_type]
        : ["ODI", "T20"]; // fallback

    const params = [canon(tournament_name)];
    let p = params.length;

    const sql = `
      WITH base AS (
        SELECT *
        FROM match_history
        WHERE status = 'approved'
          AND tournament_name IS NOT NULL
          AND LOWER(TRIM(tournament_name)) = $1
          AND match_type = ANY($2)
          ${season_year ? `AND season_year = $${++p}` : ""}
      ),
      per_team AS (
        -- team1 perspective
        SELECT
          team1 AS team,
          runs1::int     AS runs_for,
          overs1::numeric AS overs_for,
          runs2::int     AS runs_against,
          overs2::numeric AS overs_against,
          winner
        FROM base
        UNION ALL
        -- team2 perspective
        SELECT
          team2 AS team,
          runs2::int     AS runs_for,
          overs2::numeric AS overs_for,
          runs1::int     AS runs_against,
          overs1::numeric AS overs_against,
          winner
        FROM base
      )
      SELECT
        team AS team_name,
        COUNT(*) AS matches,
        SUM(CASE
              WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team))
                OR LOWER(TRIM(winner)) = LOWER(TRIM(team)) || ' won the match!'
              THEN 1 ELSE 0
            END) AS wins,
        SUM(CASE
              WHEN LOWER(TRIM(winner)) IN ('match draw','draw','no result','tie')
              THEN 1 ELSE 0
            END) AS draws,
        SUM(CASE
              WHEN winner IS NOT NULL AND winner <> ''
               AND LOWER(TRIM(winner)) NOT IN (
                   LOWER(TRIM(team)),
                   LOWER(TRIM(team)) || ' won the match!',
                   'match draw','draw','no result','tie'
                 )
              THEN 1 ELSE 0
            END) AS losses,
        (SUM(CASE
              WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team))
                OR LOWER(TRIM(winner)) = LOWER(TRIM(team)) || ' won the match!'
              THEN 1 ELSE 0
            END) * 2
         + SUM(CASE
              WHEN LOWER(TRIM(winner)) IN ('match draw','draw','no result','tie')
              THEN 1 ELSE 0
            END) * 1) AS points,
        ROUND(
          (SUM(runs_for)::decimal / NULLIF(SUM(overs_for), 0))
          - (SUM(runs_against)::decimal / NULLIF(SUM(overs_against), 0))
        , 2) AS nrr
      FROM per_team
      GROUP BY team
      ORDER BY points DESC, nrr DESC NULLS LAST, team ASC
    `;

    const r = await pool.query(sql, season_year ? [params[0], types, season_year] : [params[0], types]);
    res.json(r.rows);
  } catch (err) {
    console.error("[tournaments] leaderboard error:", err);
    res.status(500).json({ error: "Failed to load tournament leaderboard" });
  }
});

/**
 * GET /api/tournaments/matches
 * Raw matches for a tournament (+ optional year/type)
 */
router.get("/matches", async (req, res) => {
  try {
    const { tournament_name } = req.query;
    const season_year = asInt(req.query.season_year);
    const match_type = (req.query.match_type || "All").trim();

    if (!tournament_name) {
      return res.status(400).json({ error: "tournament_name is required" });
    }

    const types =
      match_type === "All"
        ? ["ODI", "T20"]
        : ["ODI", "T20"].includes(match_type)
        ? [match_type]
        : ["ODI", "T20"];

    const params = [canon(tournament_name), types];
    let p = params.length;

    const sql = `
      SELECT
        id, match_name, match_type, team1, runs1, overs1, wickets1,
        team2, runs2, overs2, wickets2, winner,
        match_time, match_date, season_year, tournament_name
      FROM match_history
      WHERE status='approved'
        AND tournament_name IS NOT NULL
        AND LOWER(TRIM(tournament_name)) = $1
        AND match_type = ANY($2)
        ${season_year ? `AND season_year = $${++p}` : ""}
      ORDER BY COALESCE(match_time, created_at) DESC
    `;

    const r = await pool.query(sql, season_year ? [params[0], params[1], season_year] : [params[0], params[1]]);
    res.json(r.rows);
  } catch (err) {
    console.error("[tournaments] matches error:", err);
    res.status(500).json({ error: "Failed to load tournament matches" });
  }
});

module.exports = router;
