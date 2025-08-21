// routes/teamLeaderboardRoutes.js
// Exact same maths as your /api/teams endpoint, but filterable.
// We aggregate from the TEAMS table and filter via the MATCHES table,
// so we don't touch match_history and we don't re-join wrong.

const express = require("express");
const router = express.Router();
const pool = require("../db");

const norm = (s) => (s ?? "").toString().trim();

router.get("/teams/leaderboard", async (req, res) => {
  try {
    const { match_type = "All", tournament_name = null, season_year = null } = req.query;

    // Accept "All" (ODI + T20), or a single type ("ODI" / "T20")
    const mtArr =
      match_type === "All"
        ? ["ODI", "T20"]
        : ["ODI", "T20"].includes(match_type)
        ? [match_type]
        : ["ODI", "T20"];

    // IMPORTANT:
    // - Aggregate from TEAMS (same numbers as your /api/teams).
    // - Filter by MATCHES metadata (type/year/tournament) BEFORE grouping.
    // - No joins back to raw rows that would duplicate totals.
    const sql = `
      SELECT
        t.name AS team_name,
        COUNT(DISTINCT t.match_id) AS matches_played,
        SUM(t.wins) AS wins,
        SUM(t.losses) AS losses,
        COUNT(DISTINCT t.match_id) - SUM(t.wins) - SUM(t.losses) AS draws,
        (SUM(t.wins) * 2 + (COUNT(DISTINCT t.match_id) - SUM(t.wins) - SUM(t.losses))) AS points,
        ROUND(
          (SUM(t.total_runs)::decimal / NULLIF(SUM(t.total_overs), 0)) -
          (SUM(t.total_runs_conceded)::decimal / NULLIF(SUM(t.total_overs_bowled), 0))
        , 2) AS nrr
      FROM teams t
      JOIN matches m ON m.id = t.match_id
      WHERE m.match_type = ANY($1)
        AND ($2::text IS NULL OR LOWER(TRIM(m.tournament_name)) = LOWER(TRIM($2)))
        AND ($3::int  IS NULL OR m.season_year = $3::int)
      GROUP BY t.name
      ORDER BY points DESC, nrr DESC, team_name ASC
    `;

    const { rows } = await pool.query(sql, [
      mtArr,
      tournament_name ? norm(tournament_name) : null,
      season_year ? Number(season_year) : null,
    ]);

    res.json(rows);
  } catch (err) {
    console.error("❌ /teams/leaderboard error:", err);
    res.status(500).json({ error: "Failed to load teams leaderboard" });
  }
});

module.exports = router;
