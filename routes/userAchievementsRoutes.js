// routes/userAchievementsRoutes.js
// Aggregates user achievements + top ratings.
// GET /api/user-achievements?user_id=22&match_type=All|ODI|T20|Test

const express = require('express');
const router = express.Router();
const pool = require('../db');

// --- utils ---
const isAll = (s) => (s ?? 'All').trim() === 'All';

router.get('/', async (req, res) => {
  try {
    const userId = Number.parseInt(req.query.user_id, 10);
    const matchType = (req.query.match_type || 'All').trim();

    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Build filter snippet (used for player_performance & ratings)
    const mtClause = !isAll(matchType) ? `AND pp.match_type ILIKE $2` : '';
    const perfParams = !isAll(matchType) ? [userId, matchType] : [userId];

    // 1) Highest Run Scorer (sum across all innings for each player)
    const runsSql = `
      SELECT p.player_name, SUM(pp.run_scored)::int AS total_runs
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE p.user_id = $1
        ${mtClause}
      GROUP BY p.player_name
      ORDER BY total_runs DESC NULLS LAST
      LIMIT 1
    `;
    const { rows: runRows } = await pool.query(runsSql, perfParams);
    const highestRunScorer = runRows[0] || null;

    // 2) Most Centuries
    const hundredsSql = `
      SELECT p.id AS player_id, p.player_name, COALESCE(SUM(pp.hundreds),0)::int AS total_centuries
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE p.user_id = $1
        ${mtClause}
      GROUP BY p.id, p.player_name
      ORDER BY total_centuries DESC NULLS LAST
      LIMIT 1
    `;
    const { rows: hundRows } = await pool.query(hundredsSql, perfParams);
    const highestCenturies = hundRows[0] || null;

    // 3) Highest Wickets
    const wktsSql = `
      SELECT p.id AS player_id, p.player_name, COALESCE(SUM(pp.wickets_taken),0)::int AS total_wickets
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE p.user_id = $1
        ${mtClause}
      GROUP BY p.id, p.player_name
      ORDER BY total_wickets DESC NULLS LAST
      LIMIT 1
    `;
    const { rows: wktRows } = await pool.query(wktsSql, perfParams);
    const highestWicketTaker = wktRows[0] || null;

    // 4) Team with Most Wins
    // Test uses test_match_results; ODI/T20 use match_history — both filtered by user_id.
    let teamMostWins = null;

    if (matchType === 'Test') {
      const testWinsSql = `
        SELECT team_name, COUNT(*)::int AS wins
        FROM (
          SELECT team1 AS team_name
          FROM test_match_results
          WHERE user_id = $1 AND LOWER(TRIM(winner)) = LOWER(TRIM(team1))
          UNION ALL
          SELECT team2 AS team_name
          FROM test_match_results
          WHERE user_id = $1 AND LOWER(TRIM(winner)) = LOWER(TRIM(team2))
        ) w
        GROUP BY team_name
        ORDER BY wins DESC, team_name ASC
        LIMIT 1
      `;
      const { rows } = await pool.query(testWinsSql, [userId]);
      if (rows.length) {
        teamMostWins = {
          team_id: null,
          team_name: rows[0].team_name,
          wins: Number(rows[0].wins) || 0
        };
      }
    } else {
      // ODI/T20 or All → match_history (optionally filter by match_type)
      const mhWinsSql = `
        WITH base AS (
          SELECT team1, team2, winner
          FROM match_history
          WHERE user_id = $1
            ${!isAll(matchType) ? 'AND match_type = $2' : ''}
        ),
        t1 AS (
          SELECT team1 AS team_name
          FROM base
          WHERE LOWER(TRIM(winner)) ILIKE LOWER(TRIM(team1)) || '%won the match%'
        ),
        t2 AS (
          SELECT team2 AS team_name
          FROM base
          WHERE LOWER(TRIM(winner)) ILIKE LOWER(TRIM(team2)) || '%won the match%'
        ),
        all_wins AS (
          SELECT * FROM t1
          UNION ALL
          SELECT * FROM t2
        )
        SELECT team_name, COUNT(*)::int AS wins
        FROM all_wins
        GROUP BY team_name
        ORDER BY wins DESC, team_name ASC
        LIMIT 1
      `;
      const mhParams = !isAll(matchType) ? [userId, matchType] : [userId];
      const { rows } = await pool.query(mhWinsSql, mhParams);
      if (rows.length) {
        teamMostWins = {
          team_id: null,
          team_name: rows[0].team_name,
          wins: Number(rows[0].wins) || 0
        };
      }
    }

    // 5) Top Ratings (batting/bowling/allrounder)
    // Pull candidate rows then slice per category to ensure top 5 for each.
    const ratingClause = !isAll(matchType) ? `AND pr.match_type = $2` : '';
    const ratingParams = !isAll(matchType) ? [userId, matchType] : [userId];
    const ratingSql = `
      SELECT
        p.id AS player_id,
        p.player_name,
        p.team_name,
        pr.match_type,
        COALESCE(pr.batting_rating,0)   AS batting_rating,
        COALESCE(pr.bowling_rating,0)   AS bowling_rating,
        COALESCE(pr.allrounder_rating,0) AS allrounder_rating
      FROM player_ratings pr
      JOIN players p ON p.id = pr.player_id
      WHERE p.user_id = $1
        ${ratingClause}
        AND pr.match_type IN ('ODI','T20','Test')
    `;
    const { rows: ratingRows } = await pool.query(ratingSql, ratingParams);

    const topBatting    = [...ratingRows].sort((a,b)=>b.batting_rating    - a.batting_rating   ).slice(0,5);
    const topBowling    = [...ratingRows].sort((a,b)=>b.bowling_rating    - a.bowling_rating   ).slice(0,5);
    const topAllrounder = [...ratingRows].sort((a,b)=>b.allrounder_rating - a.allrounder_rating).slice(0,5);

    res.json({
      match_type: matchType,
      achievements: {
        highest_run_scorer: highestRunScorer,
        highest_centuries:  highestCenturies,
        highest_wicket_taker: highestWicketTaker,
        team_most_wins: teamMostWins
      },
      top_ratings: {
        batting: topBatting,
        bowling: topBowling,
        allrounder: topAllrounder
      }
    });
  } catch (err) {
    console.error('Achievements API Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
