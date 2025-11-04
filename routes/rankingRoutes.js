// ✅ routes/rankingRoutes.js
// ✅ Purpose: unified team rankings for T20/ODI (from teams + matches)
// ✅ and real Test rankings from test_match_results
// ✅ 05-NOV-2025: expose wins/losses/draws for *all* formats so UI can sort properly
// ✅ Test rows: we still award 12/6/4 but UI can now sort by wins first

const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/team-rankings", async (req, res) => {
  try {
    const sql = `
      WITH limited AS (
        -- ✅ Limited overs (ODI/T20) from teams + matches
        SELECT 
          t.name AS team_name,
          m.match_type,
          COUNT(*) AS matches,
          SUM(t.wins) AS wins,
          SUM(t.losses) AS losses,
          COUNT(*) - SUM(t.wins) - SUM(t.losses) AS draws,
          SUM(t.points) AS points,
          ROUND(
            (SUM(t.total_runs)::decimal / NULLIF(SUM(t.total_overs), 0)) -
            (SUM(t.total_runs_conceded)::decimal / NULLIF(SUM(t.total_overs_bowled), 0)),
            2
          ) AS nrr
        FROM teams t
        JOIN matches m ON m.id = t.match_id
        WHERE m.match_type IN ('ODI', 'T20')
        GROUP BY t.name, m.match_type
      ),
      test_appearances AS (
        -- ✅ Get every team's appearance in a test match (team1 + team2)
        SELECT
          match_id,
          team1 AS team_name,
          winner,
          'team1' AS side
        FROM test_match_results
        UNION ALL
        SELECT
          match_id,
          team2 AS team_name,
          winner,
          'team2' AS side
        FROM test_match_results
      ),
      test_scored AS (
        -- ✅ Score each appearance according to your rule:
        -- Win = 12, Loss = 6, Draw = 4, anything else = 0
        SELECT
          team_name,
          CASE
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team_name)) THEN 12
            WHEN LOWER(TRIM(winner)) IN ('draw','match draw','match drawn','tie') THEN 4
            WHEN winner IS NOT NULL AND TRIM(winner) <> '' THEN 6
            ELSE 0
          END AS points,
          CASE
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team_name)) THEN 1 ELSE 0
          END AS win_flag,
          CASE
            WHEN LOWER(TRIM(winner)) IN ('draw','match draw','match drawn','tie') THEN 1 ELSE 0
          END AS draw_flag,
          CASE
            WHEN winner IS NOT NULL AND TRIM(winner) <> '' 
                 AND LOWER(TRIM(winner)) <> LOWER(TRIM(team_name))
                 AND LOWER(TRIM(winner)) NOT IN ('draw','match draw','match drawn','tie')
            THEN 1 ELSE 0
          END AS loss_flag
        FROM test_appearances
      ),
      tests AS (
        -- ✅ Aggregate test rows per team
        SELECT
          team_name,
          'Test' AS match_type,
          COUNT(*) AS matches,
          SUM(win_flag) AS wins,
          SUM(loss_flag) AS losses,
          SUM(draw_flag) AS draws,
          SUM(points) AS points
        FROM test_scored
        GROUP BY team_name
      )
      SELECT
        team_name,
        match_type,
        matches,
        wins,
        losses,
        draws,
        points,
        nrr
      FROM (
        SELECT * FROM limited
        UNION ALL
        -- ✅ Test doesn't have NRR, send NULL to keep shape
        SELECT
          team_name,
          match_type,
          matches,
          wins,
          losses,
          draws,
          points,
          NULL::numeric AS nrr
        FROM tests
      ) AS all_rows
      -- ✅ let frontend decide final ordering per-format
      ORDER BY team_name ASC, match_type ASC;
    `;

    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching team rankings:", err.message);
    res.status(500).json({ error: "Failed to fetch team rankings" });
  }
});

module.exports = router;
