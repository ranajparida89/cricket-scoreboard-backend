const express = require('express');
const router = express.Router();
const pool = require('../db'); // Ensure this path matches your project structure

// Debug route to confirm API health (keep or remove as needed)
router.get('/test', (req, res) => {
  res.send('WinLossTrend TEST route is working!');
});

// Helper: Determine result for ODI/T20
function parseOdiT20Result(winnerString, teamName, opponentName) {
  if (!winnerString) return 'No Result';
  const winnerLower = winnerString.toLowerCase();
  if (winnerLower.includes('draw') || winnerLower.includes('tie')) return 'Draw';
  if (winnerLower.includes(teamName.toLowerCase())) return 'Win';
  if (winnerLower.includes(opponentName.toLowerCase())) return 'Loss';
  return 'No Result';
}

// Main Win/Loss Trend Endpoint
router.get('/', async (req, res) => {
  try {
    const teamName = req.query.team_name;
    const matchType = req.query.match_type; // Capture match_type from the request

    if (!teamName) return res.status(400).json({ error: "team_name is required" });
    if (!matchType) return res.status(400).json({ error: "match_type is required" }); // Match type check

    // Define the SQL query based on the match_type
    let matchQuery = `
      SELECT   
        id as match_id,  
        match_type,  
        match_name,  
        team1,  
        team2,  
        winner,  
        match_time as match_date  
      FROM match_history  
      WHERE (team1 = $1 OR team2 = $1) AND match_type = $2
      ORDER BY match_time DESC
      LIMIT 10
    `;

    // Fetch data based on match_type
    const { rows: matches } = await pool.query(matchQuery, [teamName, matchType]);

    // Map match results for ODI/T20
    const matchData = matches.map(row => {
      const opponent = row.team1 === teamName ? row.team2 : row.team1;
      return {
        match_id: row.match_id,
        match_type: row.match_type,
        match_name: row.match_name,
        opponent,
        result: parseOdiT20Result(row.winner, teamName, opponent),
        match_date: row.match_date
      };
    });

    // Final JSON response
    res.json({
      team_name: teamName,
      data: matchData
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;