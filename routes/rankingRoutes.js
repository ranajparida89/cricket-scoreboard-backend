// ✅ routes/rankingRoutes.js
// Unified team rankings (ODI, T20, Test) with a derived `rating` column

const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/team-rankings", async (req, res) => {
  try {
    const sql = `
      WITH limited AS (
        -- ✅ Limited overs (ODI/T20)
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
        -- ✅ Each team’s appearance in a test
        SELECT match_id, team1 AS team_name, winner FROM test_match_results
        UNION ALL
        SELECT match_id, team2 AS team_name, winner FROM test_match_results
      ),
      test_scored AS (
        -- ✅ Score each test appearance
        SELECT
          team_name,
          CASE
            WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team_name)) THEN 12          -- win
            WHEN LOWER(TRIM(winner)) IN ('draw','match draw','match drawn','tie') THEN 4
            WHEN winner IS NOT NULL AND TRIM(winner) <> '' THEN 6              -- loss
            ELSE 0
          END AS points,
          CASE WHEN LOWER(TRIM(winner)) = LOWER(TRIM(team_name)) THEN 1 ELSE 0 END AS win_flag,
          CASE WHEN LOWER(TRIM(winner)) IN ('draw','match draw','match drawn','tie') THEN 1 ELSE 0 END AS draw_flag,
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
        nrr,
        -- ✅ derived rating so frontend can show something real
        CASE 
          WHEN matches > 0 THEN ROUND( (points::numeric / matches) * 10, 2 )
          ELSE 0
        END AS rating
      FROM (
        SELECT * FROM limited
        UNION ALL
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
