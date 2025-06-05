const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/user-recent-matches-v2?user_id=22&limit=5
router.get("/user-recent-matches-v2", async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    const limit = parseInt(req.query.limit, 10) || 5;
    if (!userId) return res.status(400).json({ error: "Missing or invalid user_id" });

    // Get all match names for this user's player performances (case-insensitive, trimmed)
    const pfRes = await pool.query(
      `
      SELECT DISTINCT TRIM(LOWER(pp.match_name)) AS match_name
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE p.user_id = $1
      `,
      [userId]
    );
    const pfNames = pfRes.rows.map(r => r.match_name).filter(Boolean);

    if (pfNames.length === 0) return res.json([]);

    // Build a dynamic WHERE clause: OR-ed ILIKE fuzzy matching
    const whereClauses = pfNames.map((_, idx) => `TRIM(LOWER(mh.match_name)) ILIKE '%' || $${idx + 2} || '%'`).join(' OR ');

    const sql = `
      SELECT
        mh.id AS match_id,
        mh.match_name,
        mh.match_type,
        mh.team1,
        mh.team2,
        mh.winner,
        mh.match_time,
        mh.runs1,
        mh.runs2,
        mh.wickets1,
        mh.wickets2
      FROM match_history mh
      WHERE ${whereClauses}
      ORDER BY mh.match_time DESC
      LIMIT $${pfNames.length + 2}
    `;

    // Compose params: [userId, ...pfNames, limit]
    const params = [userId, ...pfNames, limit];

    const matchRes = await pool.query(sql, params);
    const matches = matchRes.rows;

    // Now, format the results as your frontend expects
    // Get user's teams for result/opponent calculation
    const teamRes = await pool.query(
      "SELECT DISTINCT team_name FROM players WHERE user_id = $1",
      [userId]
    );
    const userTeams = teamRes.rows.map(r => r.team_name.trim().toLowerCase());

    // Helper to detect win
    const didUserTeamWin = (winnerText, teams) => {
      if (!winnerText) return false;
      const winnerLower = winnerText.toLowerCase();
      return teams.some(team => winnerLower.includes(team));
    };

    const output = matches.map(row => {
      const isTeam1 = userTeams.includes(row.team1.trim().toLowerCase());
      const opponent = isTeam1 ? row.team2 : row.team1;

      let result = "Lost";
      if (!row.winner || row.winner.trim() === "") {
        result = "Draw";
      } else if (didUserTeamWin(row.winner, userTeams)) {
        result = "Won";
      }

      return {
        match_id: row.match_id,
        match_name: row.match_name,
        match_type: row.match_type,
        opponent,
        result,
        match_time: row.match_time,
        runs: isTeam1 ? row.runs1 : row.runs2,
        wickets: isTeam1 ? row.wickets1 : row.wickets2,
      };
    });

    res.json(output);

  } catch (err) {
    console.error("❌ Recent matches V2 error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
