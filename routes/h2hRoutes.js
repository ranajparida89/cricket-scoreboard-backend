// routes/h2hRoutes.js (✅ Updated on 15-May-2025 by Ranaj Parida | Team + Player H2H Advanced Version)
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ GET /api/h2h/summary - Full Head-to-Head summary for selected teams
router.get("/summary", async (req, res) => {
  const { team1, team2, type } = req.query;

  if (!team1 || !team2 || !type || team1.toLowerCase() === team2.toLowerCase()) {
    return res.status(400).json({ error: "Please provide two different teams and a match type" });
  }

  try {
    // ✅ Step 1: Fetch all matches played between team1 and team2 in given match_type
    const matchResult = await pool.query(
      `SELECT id, match_name, winner FROM match_history
       WHERE match_type = $1
       AND ((LOWER(TRIM(team1)) = LOWER($2) AND LOWER(TRIM(team2)) = LOWER($3))
         OR  (LOWER(TRIM(team1)) = LOWER($3) AND LOWER(TRIM(team2)) = LOWER($2)))`,
      [type, team1, team2]
    );

    const matches = matchResult.rows;
    const matchIds = matches.map(m => m.id);
    const matchNames = matches.map(m => m.match_name);

    if (matchIds.length === 0) {
      return res.json({
        total_matches: 0,
        [team1]: 0,
        [team2]: 0,
        draws: 0,
        top_scorer: null,
        top_bowler: null
      });
    }

    // ✅ Step 2: Calculate team-wise win/draws
    let team1Wins = 0, team2Wins = 0, draws = 0;
    matches.forEach(m => {
      const w = m.winner?.toLowerCase();
      if (!w || w === "draw" || w.includes("draw")) draws++;
      else if (w.includes(team1.toLowerCase())) team1Wins++;
      else if (w.includes(team2.toLowerCase())) team2Wins++;
    });

    // ✅ Step 3: Top Scorer from player_performance
    const scorerQuery = await pool.query(
      `SELECT p.player_name, SUM(pp.run_scored) AS total_runs
       FROM player_performance pp
       JOIN players p ON pp.player_id = p.id
       WHERE pp.match_name = ANY($1) AND pp.match_type = $2
         AND (LOWER(pp.team_name) = LOWER($3) OR LOWER(pp.team_name) = LOWER($4))
       GROUP BY p.player_name
       ORDER BY total_runs DESC
       LIMIT 1`,
      [matchNames, type, team1, team2]
    );

    const topScorer = scorerQuery.rows[0];

    // ✅ Step 4: Top Bowler using wickets_taken + tie-breaker: min runs_given
    const bowlerQuery = await pool.query(
      `SELECT p.player_name,
              SUM(pp.wickets_taken) AS total_wickets,
              SUM(pp.runs_given) AS total_runs_given
       FROM player_performance pp
       JOIN players p ON pp.player_id = p.id
       WHERE pp.match_name = ANY($1) AND pp.match_type = $2
         AND (LOWER(pp.team_name) = LOWER($3) OR LOWER(pp.team_name) = LOWER($4))
       GROUP BY p.player_name
       ORDER BY total_wickets DESC, total_runs_given ASC
       LIMIT 1`,
      [matchNames, type, team1, team2]
    );

    const topBowler = bowlerQuery.rows[0];

    // ✅ Step 5: Return all metrics
    res.json({
      total_matches: matchIds.length,
      [team1]: team1Wins,
      [team2]: team2Wins,
      draws,
      top_scorer: topScorer ? `${topScorer.player_name} (${topScorer.total_runs} runs)` : null,
      top_bowler: topBowler ? `${topBowler.player_name} (${topBowler.total_wickets} wickets)` : null
    });

  } catch (error) {
    console.error("❌ Error in /api/h2h/summary:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ GET /api/h2h/teams - Return team list from match_history
router.get("/teams", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT team FROM (
        SELECT LOWER(TRIM(team1)) AS team FROM match_history
        UNION
        SELECT LOWER(TRIM(team2)) AS team FROM match_history
      ) AS all_teams
      ORDER BY team`
    );

    const teamList = result.rows.map(row =>
      row.team.charAt(0).toUpperCase() + row.team.slice(1)
    );

    res.json(teamList);
  } catch (error) {
    console.error("❌ Error in /api/h2h/teams:", error);
    res.status(500).json({ error: "Failed to fetch team names" });
  }
});

module.exports = router;
