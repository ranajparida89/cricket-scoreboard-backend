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

// Helper: Determine result for Test matches
function parseTestResult(row, teamName, opponent) {
  if (!row.winner) return 'No Result';
  if (row.winner.toLowerCase() === teamName.toLowerCase()) return 'Win';
  if (row.winner.toLowerCase() === opponent.toLowerCase()) return 'Loss';
  if (row.winner.toLowerCase().includes('draw') || row.winner.toLowerCase().includes('tie')) return 'Draw';
  return 'No Result';
}

// Main Win/Loss Trend Endpoint
router.get('/', async (req, res) => {
  try {
    const teamName = req.query.team_name;
    const matchType = req.query.match_type; // 'ODI', 'T20', 'Test', or 'All'

    if (!teamName) return res.status(400).json({ error: "team_name is required" });
    if (!matchType) return res.status(400).json({ error: "match_type is required" });

    let allMatches = [];

    if (matchType === "ODI" || matchType === "T20") {
      // Only ODI or T20 matches
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
        WHERE (team1 = $1 OR team2 = $1) AND match_type = $2
        ORDER BY match_time DESC
        LIMIT 10
      `;
      const { rows } = await pool.query(odiT20Query, [teamName, matchType]);
      allMatches = rows.map(row => {
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
    } else if (matchType === "Test") {
      // Only Test matches
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
      const { rows } = await pool.query(testQuery, [teamName]);
      allMatches = rows.map(row => {
        const opponent = row.team1 === teamName ? row.team2 : row.team1;
        return {
          match_id: row.match_id,
          match_type: row.match_type,
          match_name: row.match_name,
          opponent,
          result: parseTestResult(row, teamName, opponent),
          match_date: row.match_date
        };
      });
    } else if (matchType === "All") {
      // Both ODI/T20 and Test: combine both tables
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
      const [{ rows: odiT20Rows }, { rows: testRows }] = await Promise.all([
        pool.query(odiT20Query, [teamName]),
        pool.query(testQuery, [teamName])
      ]);
      const odiT20Data = odiT20Rows.map(row => {
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
      const testData = testRows.map(row => {
        const opponent = row.team1 === teamName ? row.team2 : row.team1;
        return {
          match_id: row.match_id,
          match_type: row.match_type,
          match_name: row.match_name,
          opponent,
          result: parseTestResult(row, teamName, opponent),
          match_date: row.match_date
        };
      });
      allMatches = [...odiT20Data, ...testData];
      // Sort and limit to last 10 matches by date
      allMatches.sort((a, b) => new Date(b.match_date) - new Date(a.match_date));
      allMatches = allMatches.slice(0, 10);
    } else {
      // Invalid matchType
      return res.status(400).json({ error: "Invalid match_type" });
    }

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
