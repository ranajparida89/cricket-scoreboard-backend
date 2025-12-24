// C:\cricket-scoreboard-backend\routes\homeHighlightsRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/home-highlights
router.get("/", async (_req, res) => {
  // 🔒 Disable all caching (browser / PWA / proxy)
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });

  const generatedAt = new Date().toISOString();

  try {
    // 1️⃣ MOST RUNS
    const mostRunsQ = await pool.query(`
      SELECT
        p.id AS player_id,
        p.player_name,
        p.team_name,
        SUM(pp.run_scored) AS total_runs
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      GROUP BY p.id, p.player_name, p.team_name
      ORDER BY total_runs DESC
      LIMIT 1;
    `);

    // 2️⃣ MOST WICKETS
    const mostWicketsQ = await pool.query(`
      SELECT
        p.id AS player_id,
        p.player_name,
        p.team_name,
        SUM(pp.wickets_taken) AS total_wickets
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      GROUP BY p.id, p.player_name, p.team_name
      ORDER BY total_wickets DESC
      LIMIT 1;
    `);

    // 3️⃣ MOST SUCCESSFUL PLAYER (MoM)
    const mostSuccessfulQ = await pool.query(`
      WITH all_mom AS (
        SELECT mom_player FROM match_history WHERE mom_player IS NOT NULL AND mom_player <> ''
        UNION ALL
        SELECT mom_player FROM test_match_results WHERE mom_player IS NOT NULL AND mom_player <> ''
      )
      SELECT
        mom_player AS player_name,
        COUNT(*) AS mom_count
      FROM all_mom
      GROUP BY mom_player
      ORDER BY mom_count DESC
      LIMIT 1;
    `);

    // 4️⃣ BEST TEAM
    const bestTeamQ = await pool.query(`
      WITH wins AS (
        SELECT TRIM(SPLIT_PART(winner, ' won', 1)) AS team_name
        FROM match_history
        WHERE winner IS NOT NULL AND winner <> ''
        UNION ALL
        SELECT TRIM(winner)
        FROM test_match_results
        WHERE winner IS NOT NULL AND winner <> ''
      )
      SELECT team_name, COUNT(*) AS total_wins
      FROM wins
      GROUP BY team_name
      ORDER BY total_wins DESC
      LIMIT 1;
    `);

    // 5️⃣ ALL ROUND PERFORMER (FIXED)
    const allRoundQ = await pool.query(`
      WITH valid_players AS (
        SELECT
          p.id,
          p.player_name,
          p.team_name,
          p.skill_type,
          pr.batting_rating,
          pr.bowling_rating,
          pr.allrounder_rating
        FROM player_ratings pr
        JOIN players p ON p.id = pr.player_id
        WHERE p.skill_type IS NOT NULL
          AND p.skill_type <> ''
      ),
      totals AS (
        SELECT
          id AS player_id,
          player_name,
          team_name,
          skill_type,
          SUM(COALESCE(batting_rating,0)
            + COALESCE(bowling_rating,0)
            + COALESCE(allrounder_rating,0)) AS total_rating
        FROM valid_players
        GROUP BY id, player_name, team_name, skill_type
      ),
      ranked AS (
        SELECT *,
          DENSE_RANK() OVER (PARTITION BY skill_type ORDER BY total_rating DESC) AS rnk
        FROM totals
      )
      SELECT *
      FROM ranked
      WHERE rnk = 1
      ORDER BY skill_type;
    `);

    const highlights = [];

    if (mostRunsQ.rows[0]) {
      const r = mostRunsQ.rows[0];
      highlights.push({
        tag: "Most Runs (T20 + ODI + Test)",
        type: "most_runs",
        title: r.player_name,
        subtitle: r.team_name ? `Team: ${r.team_name}` : "",
        meta: [{ label: "Total Runs", value: Number(r.total_runs) }],
      });
    }

    if (mostWicketsQ.rows[0]) {
      const w = mostWicketsQ.rows[0];
      highlights.push({
        tag: "Highest Wicket Taker",
        type: "most_wickets",
        title: w.player_name,
        subtitle: w.team_name ? `Team: ${w.team_name}` : "",
        meta: [{ label: "Total Wickets", value: Number(w.total_wickets) }],
      });
    }

    if (mostSuccessfulQ.rows[0]) {
      const s = mostSuccessfulQ.rows[0];
      highlights.push({
        tag: "Most Successful Player",
        type: "most_successful",
        title: s.player_name,
        subtitle: "Based on Man of the Match",
        meta: [{ label: "MoM Awards", value: Number(s.mom_count) }],
      });
    }

    if (bestTeamQ.rows[0]) {
      const b = bestTeamQ.rows[0];
      highlights.push({
        tag: "Best Team",
        type: "best_team",
        title: b.team_name,
        subtitle: "Across all formats",
        meta: [{ label: "Total Wins", value: Number(b.total_wins) }],
      });
    }

    allRoundQ.rows.forEach((row) => {
      highlights.push({
        tag: "All Round Performer",
        type: "all_round_performer",
        title: row.player_name,
        subtitle: `Skill: ${row.skill_type}`,
        meta: [
          { label: "Rating Earned", value: Number(row.total_rating) },
          { label: "Team", value: row.team_name },
        ],
      });
    });

    res.json({
      generated_at: generatedAt,
      highlights,
    });
  } catch (err) {
    console.error("❌ Error in /api/home-highlights:", err);
    res.status(500).json({ message: "Failed to fetch home highlights" });
  }
});

module.exports = router;
