// routes/userRecentMatchesV2Routes.js

const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/user-recent-matches-v2?user_id=22&limit=5
router.get("/user-recent-matches-v2", async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    const limit = parseInt(req.query.limit, 10) || 5;
    if (!userId) return res.status(400).json({ error: "Missing or invalid user_id" });

    // Get all teams for this user
    const teamRes = await pool.query(
      "SELECT DISTINCT team_name FROM players WHERE user_id = $1",
      [userId]
    );
    if (teamRes.rowCount === 0) return res.json([]);

    const userTeams = teamRes.rows.map(r => r.team_name.trim());

    // Query: Fetch most recent matches (across match_history) where user’s team participated
    const matchRes = await pool.query(
      `
      SELECT
        id, match_name, match_type, team1, team2, winner, match_time, runs1, runs2, wickets1, wickets2
      FROM match_history
      WHERE LOWER(TRIM(team1)) = ANY($1) OR LOWER(TRIM(team2)) = ANY($1)
      ORDER BY match_time DESC
      LIMIT $2
      `,
      [userTeams.map(t => t.toLowerCase()), limit]
    );

    // Helper: returns true if winner text contains any of the user teams as a substring (case-insensitive)
    const didUserTeamWin = (winnerText, teams) => {
      if (!winnerText) return false;
      const winnerLower = winnerText.toLowerCase();
      return teams.some(team =>
        winnerLower.includes(team.trim().toLowerCase())
      );
    };

    // Format the data (add opponent, is_win, etc.)
    const matches = matchRes.rows.map(row => {
      const isTeam1 = userTeams.map(t => t.toLowerCase()).includes(row.team1.trim().toLowerCase());
      const opponent = isTeam1 ? row.team2 : row.team1;

      let result = "Lost";
      if (!row.winner || row.winner.trim() === "") {
        result = "Draw";
      } else if (didUserTeamWin(row.winner, userTeams)) {
        result = "Won";
      }

      return {
        match_id: row.id,
        match_name: row.match_name,
        match_type: row.match_type,
        opponent,
        result,
        match_time: row.match_time,
        runs: isTeam1 ? row.runs1 : row.runs2,
        wickets: isTeam1 ? row.wickets1 : row.wickets2,
      };
    });

    res.json(matches);
  } catch (err) {
    console.error("❌ Recent matches V2 error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
