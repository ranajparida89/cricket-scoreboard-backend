// routes/teamLeaderboardRoutes.js
// Filterable leaderboard with the SAME maths as /api/teams.
// Aggregate from TEAMS; filter with MATCHES + EXISTS on MATCH_HISTORY
// (no row multiplication). Also echo back tournament/year so UI can show them.

const express = require("express");
const router = express.Router();
const pool = require("../db");

const norm = (s) => (s ?? "").toString().trim();

router.get("/teams/leaderboard", async (req, res) => {
  try {
    const { match_type = "All", tournament_name = null, season_year = null } = req.query;

    // "All" (ODI+T20) or a single type
    const mtArr =
      match_type === "All"
        ? ["ODI", "T20"]
        : ["ODI", "T20"].includes(match_type)
        ? [match_type]
        : ["ODI", "T20"];

    const sql = `
      SELECT
        t.name AS team_name,
        COUNT(DISTINCT t.match_id)                                AS matches_played,
        SUM(t.wins)                                               AS wins,
        SUM(t.losses)                                             AS losses,
        COUNT(DISTINCT t.match_id) - SUM(t.wins) - SUM(t.losses)  AS draws,
        (SUM(t.wins) * 2 + (COUNT(DISTINCT t.match_id) - SUM(t.wins) - SUM(t.losses))) AS points,
        ROUND(
          (SUM(t.total_runs)::decimal          / NULLIF(SUM(t.total_overs), 0))
          -
          (SUM(t.total_runs_conceded)::decimal / NULLIF(SUM(t.total_overs_bowled), 0))
        , 2) AS nrr,
        /* Echo selected filters so UI can display them deterministically */
        $2::text AS tournament_name,
        $3::int  AS season_year
      FROM teams t
      JOIN matches m ON m.id = t.match_id
      WHERE m.match_type = ANY($1)
        AND (
          ($2::text IS NULL AND $3::int IS NULL)
          OR EXISTS (
            SELECT 1
            FROM match_history h
            WHERE LOWER(TRIM(h.match_type)) = LOWER(TRIM(m.match_type))
              AND LOWER(TRIM(h.match_name))  = LOWER(TRIM(m.match_name))
              AND ($2::text IS NULL OR LOWER(TRIM(h.tournament_name)) = LOWER(TRIM($2)))
              AND ($3::int  IS NULL OR h.season_year = $3::int)
          )
        )
      GROUP BY t.name, tournament_name, season_year
      ORDER BY points DESC, nrr DESC, team_name ASC
    `;

    const params = [
      mtArr,
      tournament_name ? norm(tournament_name) : null,
      season_year ? Number(season_year) : null,
    ];

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /teams/leaderboard error:", err);
    res.status(500).json({ error: "Failed to load teams leaderboard" });
  }
});

module.exports = router;
