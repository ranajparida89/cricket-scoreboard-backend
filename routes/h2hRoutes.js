// routes/h2hRoutes.js (✅ Updated on 16-May-2025 by Ranaj Parida | with debug logs + match_name filter fixes)
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
       WHERE LOWER(TRIM(match_type)) = LOWER($1)
       AND ((LOWER(TRIM(team1)) = LOWER($2) AND LOWER(TRIM(team2)) = LOWER($3))
         OR  (LOWER(TRIM(team1)) = LOWER($3) AND LOWER(TRIM(team2)) = LOWER($2)))`,
      [type, team1, team2]
    );

    const matches = matchResult.rows;
    const matchIds = matches.map(m => m.id);
    const matchNames = matches.map(m => m.match_name);

    // ✅ Debug Step 1: Log match names being passed to player query
    console.log("✅ Match Names for H2H:", matchNames);

    // ✅ Debug Step 3: Log match records
    console.log("✅ Total matches found between", team1, "and", team2, ":", matchIds.length);

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

    // ✅ Step 2: Top Scorer (with robust team filter)
    const scorerQuery = await pool.query(
      `SELECT p.player_name, SUM(pp.run_scored) AS total_runs
       FROM player_performance pp
       JOIN players p ON pp.player_id = p.id
       WHERE pp.match_name = ANY($1)
         AND LOWER(TRIM(pp.match_type)) = LOWER($2)
         AND (LOWER(TRIM(pp.team_name)) = LOWER($3) OR LOWER(TRIM(pp.team_name)) = LOWER($4))
       GROUP BY p.player_name
       ORDER BY total_runs DESC
       LIMIT 1`,
      [matchNames, type, team1, team2]
    );

    const topScorer = scorerQuery.rows[0] || null;

    // ✅ Step 2: Top Bowler (with tie breaker: least runs_given)
    const bowlerQuery = await pool.query(
      `SELECT p.player_name,
              SUM(pp.wickets_taken) AS total_wickets,
              SUM(pp.runs_given) AS total_runs_given
       FROM player_performance pp
       JOIN players p ON pp.player_id = p.id
       WHERE pp.match_name = ANY($1)
         AND LOWER(TRIM(pp.match_type)) = LOWER($2)
         AND (LOWER(TRIM(pp.team_name)) = LOWER($3) OR LOWER(TRIM(pp.team_name)) = LOWER($4))
       GROUP BY p.player_name
       ORDER BY total_wickets DESC, total_runs_given ASC
       LIMIT 1`,
      [matchNames, type, team1, team2]
    );

    const topBowler = bowlerQuery.rows[0] || null;

    // ✅ Debug Step 3: Log top player outputs
    console.log("🏏 Top Scorer:", topScorer);
    console.log("🔥 Top Bowler:", topBowler);

    // ✅ Step 3: Final response
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
