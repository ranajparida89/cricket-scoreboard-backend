// ✅ routes/rankingRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

/**
 * GET /api/team-rankings
 * - ODI/T20 from `teams` + `matches` (kept exactly as you had, with safe NULL handling)
 * - Test from `test_match_results` (no NRR; returns wins/losses/draws + points/rating)
 * - Non-breaking: same columns across both halves of the UNION ALL
 * - Optional: safely tolerates mixed/odd winner strings (e.g., "Match Drawn")
 */
router.get("/team-rankings", async (req, res) => {
  try {
    const sql = `
      /* ---------- ODI/T20 (keep existing behavior) ---------- */
      SELECT 
        t.name AS team_name,
        COALESCE(SUM(t.matches_played), 0) AS matches,
        COALESCE(SUM(t.points), 0) AS points,
        ROUND(
          COALESCE(SUM(t.points)::decimal, 0) / NULLIF(COALESCE(SUM(t.matches_played), 0), 0),
          2
        ) AS rating,
        ROUND(
          COALESCE(SUM(t.total_runs)::decimal, 0) / NULLIF(COALESCE(SUM(t.total_overs), 0), 0)
          -
          COALESCE(SUM(t.total_runs_conceded)::decimal, 0) / NULLIF(COALESCE(SUM(t.total_overs_bowled), 0), 0),
          2
        ) AS nrr,
        m.match_type,
        NULL::int AS wins,
        NULL::int AS losses,
        NULL::int AS draws
      FROM teams t
      JOIN matches m ON m.id = t.match_id
      WHERE m.match_type IN ('ODI', 'T20')
      GROUP BY m.match_type, t.name

      UNION ALL

      /* ---------- Test (points only; no NRR; add W/L/D) ---------- */
      WITH all_teams AS (
        SELECT team1 AS team, winner FROM test_match_results
        UNION ALL
        SELECT team2 AS team, winner FROM test_match_results
      ),
      scored AS (
        SELECT
          team,
          COUNT(*) AS matches,
          /* outcome buckets */
          SUM(
            CASE WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team))
              THEN 1 ELSE 0 END
          ) AS wins,
          SUM(
            CASE
              WHEN LOWER(TRIM(winner)) <> LOWER(TRIM(team))
               AND LOWER(TRIM(winner)) NOT IN ('draw','match draw','match drawn','drawn')
              THEN 1 ELSE 0
            END
          ) AS losses,
          SUM(
            CASE
              WHEN LOWER(TRIM(winner)) IN ('draw','match draw','match drawn','drawn')
              THEN 1 ELSE 0
            END
          ) AS draws,
          /* points model: Win=12, Loss=6, Draw=4 */
          SUM(
            CASE
              WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team)) THEN 12
              WHEN LOWER(TRIM(winner)) IN ('draw','match draw','match drawn','drawn') THEN 4
              WHEN LOWER(TRIM(winner)) <> LOWER(TRIM(team)) THEN 6
              ELSE 0
            END
          ) AS points
        FROM all_teams
        GROUP BY team
      )
      SELECT
        team AS team_name,
        matches,
        points,
        ROUND(points::decimal / NULLIF(matches, 0), 2) AS rating,
        NULL::numeric AS nrr,
        'Test' AS match_type,
        COALESCE(wins, 0)   AS wins,
        COALESCE(losses, 0) AS losses,
        COALESCE(draws, 0)  AS draws
      FROM scored
    `;

    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching team rankings:", err.message);
    res.status(500).json({ error: "Failed to fetch team rankings" });
  }
});

module.exports = router;
