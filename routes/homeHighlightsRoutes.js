// C:\cricket-scoreboard-backend\routes\homeHighlightsRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // your existing pg pool

// GET  /api/home-highlights
router.get("/", async (req, res) => {
  try {
    // 1) MOST RUNS (all formats)
    const mostRunsQ = await pool.query(
      `
      SELECT
        p.id AS player_id,
        p.player_name,
        p.team_name,
        COALESCE(SUM(pp.run_scored), 0) AS total_runs
      FROM players p
      JOIN player_performance pp ON p.id = pp.player_id
      GROUP BY p.id, p.player_name, p.team_name
      ORDER BY total_runs DESC
      LIMIT 1;
      `
    );

    // 2) HIGHEST WICKET TAKER (all formats)
    const mostWicketsQ = await pool.query(
      `
      SELECT
        p.id AS player_id,
        p.player_name,
        p.team_name,
        COALESCE(SUM(pp.wickets_taken), 0) AS total_wickets
      FROM players p
      JOIN player_performance pp ON p.id = pp.player_id
      GROUP BY p.id, p.player_name, p.team_name
      ORDER BY total_wickets DESC
      LIMIT 1;
      `
    );

    // 3) MOST SUCCESSFUL PLAYER (max MoM count)
    const mostSuccessfulQ = await pool.query(
      `
      WITH all_mom AS (
        SELECT mom_player AS player_name
        FROM match_history
        WHERE mom_player IS NOT NULL AND mom_player <> ''
        UNION ALL
        SELECT mom_player
        FROM test_match_results
        WHERE mom_player IS NOT NULL AND mom_player <> ''
      )
      SELECT
        player_name,
        COUNT(*) AS mom_count
      FROM all_mom
      GROUP BY player_name
      ORDER BY mom_count DESC
      LIMIT 1;
      `
    );

    // 4) BEST TEAM (most wins)
    const bestTeamQ = await pool.query(
      `
      WITH odi_t20 AS (
        SELECT
          TRIM(SPLIT_PART(winner, ' won', 1)) AS team_name
        FROM match_history
        WHERE winner IS NOT NULL AND winner <> ''
      ),
      test_fmt AS (
        SELECT TRIM(winner) AS team_name
        FROM test_match_results
        WHERE winner IS NOT NULL AND winner <> ''
      ),
      all_wins AS (
        SELECT team_name FROM odi_t20
        UNION ALL
        SELECT team_name FROM test_fmt
      )
      SELECT
        team_name,
        COUNT(*) AS total_wins
      FROM all_wins
      WHERE team_name IS NOT NULL AND team_name <> ''
      GROUP BY team_name
      ORDER BY total_wins DESC
      LIMIT 1;
      `
    );

    // 5) 🔥 NEW: ALL ROUND PERFORMER (top per skill_type from ratings)
    const allRoundQ = await pool.query(
      `
      WITH player_totals AS (
        SELECT
          p.id AS player_id,
          p.player_name,
          p.team_name,
          p.skill_type,
          SUM(COALESCE(pr.batting_rating, 0))    AS batting_total,
          SUM(COALESCE(pr.bowling_rating, 0))    AS bowling_total,
          SUM(COALESCE(pr.allrounder_rating, 0)) AS allrounder_total,
          SUM(
            COALESCE(pr.batting_rating, 0)
            + COALESCE(pr.bowling_rating, 0)
            + COALESCE(pr.allrounder_rating, 0)
          ) AS total_rating
        FROM player_ratings pr
        JOIN players p ON pr.player_id = p.id
        GROUP BY p.id, p.player_name, p.team_name, p.skill_type
      ),
      ranked AS (
        SELECT
          player_id,
          player_name,
          team_name,
          skill_type,
          batting_total,
          bowling_total,
          allrounder_total,
          total_rating,
          DENSE_RANK() OVER (PARTITION BY skill_type ORDER BY total_rating DESC) AS rnk
        FROM player_totals
      )
      SELECT *
      FROM ranked
      WHERE rnk = 1
        AND skill_type IS NOT NULL
        AND skill_type <> ''
      ORDER BY skill_type;
      `
    );

    // build response for frontend carousel
    const highlights = [];

    // 1) most runs
    if (mostRunsQ.rows[0]) {
      const r = mostRunsQ.rows[0];
      highlights.push({
        tag: "Most Runs (T20 + ODI + Test)",
        type: "most_runs",
        title: r.player_name,
        subtitle: r.team_name ? `Team: ${r.team_name}` : "",
        meta: [
          { label: "Total Runs", value: r.total_runs },
          { label: "Player ID", value: r.player_id },
        ],
      });
    }

    // 2) highest wicket taker
    if (mostWicketsQ.rows[0]) {
      const w = mostWicketsQ.rows[0];
      highlights.push({
        tag: "Highest Wicket Taker",
        type: "most_wickets",
        title: w.player_name,
        subtitle: w.team_name ? `Team: ${w.team_name}` : "",
        meta: [{ label: "Total Wickets", value: w.total_wickets }],
      });
    }

    // 3) most successful player
    if (mostSuccessfulQ.rows[0]) {
      const s = mostSuccessfulQ.rows[0];
      highlights.push({
        tag: "Most Successful Player",
        type: "most_successful",
        title: s.player_name,
        subtitle: "Based on Man of the Match count",
        meta: [{ label: "MoM Awards", value: s.mom_count }],
      });
    }

    // 4) best team
    if (bestTeamQ.rows[0]) {
      const b = bestTeamQ.rows[0];
      highlights.push({
        tag: "Best Team",
        type: "best_team",
        title: b.team_name,
        subtitle: "Calculated from ODI/T20/Test wins",
        meta: [{ label: "Total Wins", value: b.total_wins }],
      });
    }

    // 5) 🔥 add one highlight PER skill_type for all-round performer
    if (allRoundQ.rows.length) {
      allRoundQ.rows.forEach((row) => {
        highlights.push({
          tag: "All Round Performer",
          type: "all_round_performer",
          title: row.player_name,
          subtitle: `Skill: ${row.skill_type}`,
          meta: [
            { label: "Rating Earned", value: row.total_rating },
            { label: "Team", value: row.team_name },
            { label: "Skill", value: row.skill_type },
          ],
        });
      });
    }

    return res.json(highlights);
  } catch (err) {
    console.error("Error in /api/home-highlights:", err);
    return res.status(500).json({ message: "Failed to fetch home highlights" });
  }
});

module.exports = router;
