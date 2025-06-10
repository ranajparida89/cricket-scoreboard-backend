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
    if (!teamName) return res.status(400).json({ error: "team_name is required" });

    // Fetch last 10 ODI & T20 matches for the team
    const odiT20Query = `
      SELECT 
        id as match_id,
        match_type,
        match_name,
        team1,
        team2,
        winner,
        match_time as match_date
      FROM match_history
      WHERE team1 = $1 OR team2 = $1
      ORDER BY match_time DESC
      LIMIT 10
    `;
    const { rows: odiT20Matches } = await pool.query(odiT20Query, [teamName]);

    // Map ODI/T20 results
    const odiT20Data = odiT20Matches.map(row => {
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

    // Fetch last 10 Test matches for the team
    const testQuery = `
      SELECT 
        id as match_id,
        match_type,
        match_name,
        team1,
        team2,
        winner,
        created_at as match_date
      FROM test_match_results
      WHERE team1 = $1 OR team2 = $1
      ORDER BY created_at DESC
      LIMIT 10
    `;
    const { rows: testMatches } = await pool.query(testQuery, [teamName]);

    // Map Test match results
    const testData = testMatches.map(row => {
      const opponent = row.team1 === teamName ? row.team2 : row.team1;
      let result;
      if (!row.winner) result = 'No Result';
      else if (row.winner.toLowerCase() === teamName.toLowerCase()) result = 'Win';
      else if (row.winner.toLowerCase() === opponent.toLowerCase()) result = 'Loss';
      else if (row.winner.toLowerCase().includes('draw') || row.winner.toLowerCase().includes('tie')) result = 'Draw';
      else result = 'No Result';
      return {
        match_id: row.match_id,
        match_type: row.match_type,
        match_name: row.match_name,
        opponent,
        result,
        match_date: row.match_date
      };
    });

    // Combine both, sort by match_date descending, take the latest 10 matches overall
    let allMatches = [...odiT20Data, ...testData];
    allMatches.sort((a, b) => new Date(b.match_date) - new Date(a.match_date));
    allMatches = allMatches.slice(0, 10);

    // Final JSON response
    res.json({
      team_name: teamName,
      data: allMatches
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
