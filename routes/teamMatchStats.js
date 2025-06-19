const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/team-match-stats?user_id=..&team_name=..&match_type=..
router.get('/', async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id, 10);
    const teamName = (req.query.team_name || '').trim().toLowerCase();
    const matchType = (req.query.match_type || 'All').trim();

    if (!userId || !teamName) {
      return res.status(400).json({ error: "Missing or invalid user_id/team_name" });
    }
    const validTypes = ['ODI', 'T20', 'Test', 'All'];
    if (!validTypes.includes(matchType)) {
      return res.status(400).json({ error: "Invalid match_type" });
    }

    // --------------------------------------------------------------------------------------
    // [IMPORTANT] Ownership validation for dropdown filtering (do NOT remove this!)
    // This ensures that only teams created/owned by this user show in the dropdown
    // --------------------------------------------------------------------------------------
    const teamRow = await pool.query(
      "SELECT 1 FROM players WHERE user_id = $1 AND LOWER(TRIM(team_name)) = $2 LIMIT 1",
      [userId, teamName]
    );
    if (teamRow.rowCount === 0) {
      // Team not in "players" for this user → dashboard/pallet stats stay 0, not shown in dropdown
      return res.json({
        matches_played: 0,
        matches_won: 0,
        matches_lost: 0,
        matches_draw: 0,
        total_runs: 0,
        total_wickets: 0
      });
    }
    // Only teams in "players" for this user reach here.
    // All match data below will only show for teams the user has actually created/owns.

    // ODI/T20 (match_history) - filtered by user_id and team_name
    let statsOdiT20 = {
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      matches_draw: 0,
      total_runs: 0,
      total_wickets: 0
    };
    if (matchType === 'All' || matchType === 'ODI' || matchType === 'T20') {
      let sql = `
        SELECT
          COUNT(*) AS matches_played,
          SUM(
            CASE
              WHEN LOWER(TRIM(winner)) = $1
                OR LOWER(TRIM(winner)) = $1 || ' won the match!'
              THEN 1 ELSE 0
            END
          ) AS matches_won,
          SUM(
            CASE
              WHEN LOWER(TRIM(winner)) IN ('draw', 'match draw')
                OR LOWER(TRIM(winner)) = 'match draw'
              THEN 1 ELSE 0
            END
          ) AS matches_draw,
          SUM(
            CASE
              WHEN winner IS NOT NULL AND winner <> ''
                AND LOWER(TRIM(winner)) NOT IN ($1, $1 || ' won the match!', 'draw', 'match draw')
              THEN 1 ELSE 0
            END
          ) AS matches_lost,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $1 THEN runs1
              WHEN LOWER(TRIM(team2)) = $1 THEN runs2
              ELSE 0
            END
          ) AS total_runs,
          SUM(
            CASE
              WHEN LOWER(TRIM(team1)) = $1 THEN wickets1
              WHEN LOWER(TRIM(team2)) = $1 THEN wickets2
              ELSE 0
            END
          ) AS total_wickets
        FROM match_history
        WHERE (LOWER(TRIM(team1)) = $1 OR LOWER(TRIM(team2)) = $1)
          AND user_id = $2
      `;
      let params = [teamName, userId];
      if (matchType !== 'All') {
        sql += ' AND match_type = $3';
        params.push(matchType);
      }
      const r = await pool.query(sql, params);
      statsOdiT20 = r.rows[0];
    }

    // Test matches (test_match_results) - filtered by user_id and team_name
    let statsTest = {
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      matches_draw: 0,
      total_runs: 0,
      total_wickets: 0
    };
    if (matchType === 'All' || matchType === 'Test') {
      const sql = `
        SELECT 
          team1, team2, winner,
          SUM(runs1) AS runs1, SUM(wickets1) AS wickets1,
          SUM(runs2) AS runs2, SUM(wickets2) AS wickets2,
          SUM(runs1_2) AS runs1_2, SUM(wickets1_2) AS wickets1_2,
          SUM(runs2_2) AS runs2_2, SUM(wickets2_2) AS wickets2_2
        FROM test_match_results
        WHERE (LOWER(TRIM(team1)) = $1 OR LOWER(TRIM(team2)) = $1)
          AND user_id = $2
        GROUP BY team1, team2, winner
      `;
      const params = [teamName, userId];

      const result = await pool.query(sql, params);

      let played = 0, won = 0, lost = 0, draw = 0, runs = 0, wickets = 0;
      result.rows.forEach(row => {
        const userTeamIsTeam1 = row.team1.trim().toLowerCase() === teamName;
        const userTeamIsTeam2 = row.team2.trim().toLowerCase() === teamName;
        if (userTeamIsTeam1 || userTeamIsTeam2) played += 1;

        if (
          row.winner &&
          ['draw', 'match draw'].includes(row.winner.trim().toLowerCase())
        ) draw += 1; // Handled for Draw in Test Match.
        else if (row.winner && row.winner.trim().toLowerCase() === teamName) won += 1;
        else if (row.winner && row.winner !== '' && row.winner.trim().toLowerCase() !== teamName && row.winner.trim().toLowerCase() !== 'draw') lost += 1;

        if (userTeamIsTeam1) {
          runs += Number(row.runs1 || 0) + Number(row.runs1_2 || 0);
          wickets += Number(row.wickets1 || 0) + Number(row.wickets1_2 || 0);
        }
        if (userTeamIsTeam2) {
          runs += Number(row.runs2 || 0) + Number(row.runs2_2 || 0);
          wickets += Number(row.wickets2 || 0) + Number(row.wickets2_2 || 0);
        }
      });
      statsTest = {
        matches_played: played,
        matches_won: won,
        matches_lost: lost,
        matches_draw: draw,
        total_runs: runs,
        total_wickets: wickets
      };
    }

    // Combine results for the response
    let stats = {
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      matches_draw: 0,
      total_runs: 0,
      total_wickets: 0
    };
    if (matchType === 'All') {
      stats = {
        matches_played: Number(statsOdiT20.matches_played || 0) + Number(statsTest.matches_played || 0),
        matches_won: Number(statsOdiT20.matches_won || 0) + Number(statsTest.matches_won || 0),
        matches_lost: Number(statsOdiT20.matches_lost || 0) + Number(statsTest.matches_lost || 0),
        matches_draw: Number(statsOdiT20.matches_draw || 0) + Number(statsTest.matches_draw || 0),
        total_runs: Number(statsOdiT20.total_runs || 0) + Number(statsTest.total_runs || 0),
        total_wickets: Number(statsOdiT20.total_wickets || 0) + Number(statsTest.total_wickets || 0),
      };
    } else if (matchType === 'Test') {
      stats = statsTest;
    } else {
      stats = statsOdiT20;
    }

    // Always send numbers (never null)
    res.json({
      matches_played: Number(stats.matches_played) || 0,
      matches_won: Number(stats.matches_won) || 0,
      matches_lost: Number(stats.matches_lost) || 0,
      matches_draw: Number(stats.matches_draw) || 0,
      total_runs: Number(stats.total_runs) || 0,
      total_wickets: Number(stats.total_wickets) || 0,
    });

  } catch (err) {
    console.error("TEAM MATCH STATS ERROR", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
