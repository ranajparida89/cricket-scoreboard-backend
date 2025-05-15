// routes/h2hRoutes.js (✅ Updated on 16-May-2025 with "ALL" filter support by Ranaj Parida)
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ GET /api/h2h/summary - Full Head-to-Head summary (supports ALL match types)
router.get("/summary", async (req, res) => {
  const { team1, team2, type } = req.query;

  if (!team1 || !team2 || !type || team1.toLowerCase() === team2.toLowerCase()) {
    return res.status(400).json({ error: "Please provide two different teams and a match type" });
  }

  try {
    // ✅ Step 1: Build dynamic match query (with optional match_type filtering)
    let matchQueryStr = `
      SELECT id, match_name, winner, match_type
      FROM match_history
      WHERE 
        ((LOWER(TRIM(team1)) = LOWER($1) AND LOWER(TRIM(team2)) = LOWER($2))
         OR 
         (LOWER(TRIM(team1)) = LOWER($2) AND LOWER(TRIM(team2)) = LOWER($1)))
    `;
    const queryParams = [team1, team2];

    if (type.toUpperCase() !== "ALL") {
      matchQueryStr += ` AND LOWER(TRIM(match_type)) = LOWER($3)`;
      queryParams.push(type);
    }

    const matchResult = await pool.query(matchQueryStr, queryParams);
    const matches = matchResult.rows;
    const matchIds = matches.map(m => m.id);
    const matchNames = matches.map(m => m.match_name);

    console.log("✅ Matched Names for H2H:", matchNames);
    console.log("✅ Total matches:", matchIds.length);

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

    // ✅ Step 2: Calculate win/draw counts
    let team1Wins = 0, team2Wins = 0, draws = 0;
    matches.forEach(m => {
      const w = m.winner?.toLowerCase();
      if (!w || w === "draw" || w.includes("draw")) draws++;
      else if (w.includes(team1.toLowerCase())) team1Wins++;
      else if (w.includes(team2.toLowerCase())) team2Wins++;
    });

    // ✅ Step 3: Top Scorer
    const scorerQueryStr = `
      SELECT p.player_name, SUM(pp.run_scored) AS total_runs
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE pp.match_name = ANY($1)
        AND (LOWER(TRIM(pp.team_name)) = LOWER($2) OR LOWER(TRIM(pp.team_name)) = LOWER($3))
        ${type.toUpperCase() !== "ALL" ? "AND LOWER(TRIM(pp.match_type)) = LOWER($4)" : ""}
      GROUP BY p.player_name
      ORDER BY total_runs DESC
      LIMIT 1
    `;

    const scorerParams = [matchNames, team1, team2];
    if (type.toUpperCase() !== "ALL") scorerParams.push(type);

    const scorerQuery = await pool.query(scorerQueryStr, scorerParams);
    const topScorer = scorerQuery.rows[0] || null;

    // ✅ Step 4: Top Bowler (by wickets + runs_given tiebreak)
    const bowlerQueryStr = `
      SELECT p.player_name,
             SUM(pp.wickets_taken) AS total_wickets,
             SUM(pp.runs_given) AS total_runs_given
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE pp.match_name = ANY($1)
        AND (LOWER(TRIM(pp.team_name)) = LOWER($2) OR LOWER(TRIM(pp.team_name)) = LOWER($3))
        ${type.toUpperCase() !== "ALL" ? "AND LOWER(TRIM(pp.match_type)) = LOWER($4)" : ""}
      GROUP BY p.player_name
      ORDER BY total_wickets DESC, total_runs_given ASC
      LIMIT 1
    `;

    const bowlerParams = [matchNames, team1, team2];
    if (type.toUpperCase() !== "ALL") bowlerParams.push(type);

    const bowlerQuery = await pool.query(bowlerQueryStr, bowlerParams);
    const topBowler = bowlerQuery.rows[0] || null;

    console.log("🏏 Top Scorer:", topScorer);
    console.log("🔥 Top Bowler:", topBowler);

    // ✅ Final response
    res.json({
      total_matches: matchIds.length,
      [team1]: team1Wins,
      [team2]: team2Wins,
      draws,
      win_percentage_team1: Math.round((team1Wins / matchIds.length) * 100),
      win_percentage_team2: Math.round((team2Wins / matchIds.length) * 100)
    });

  } catch (error) {
    console.error("❌ Error in /api/h2h/summary:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ GET /api/h2h/teams - Fetch all unique teams
router.get("/teams", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT team FROM (
        SELECT LOWER(TRIM(team1)) AS team FROM match_history
        UNION
        SELECT LOWER(TRIM(team2)) AS team FROM match_history
      ) AS all_teams
      ORDER BY team
    `);

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
