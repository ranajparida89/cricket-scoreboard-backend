// ✅ QuerySQLMappings.js - 105+ Natural Language Cricket Queries with SQL

const queryMappings = {
  // 🏏 Centuries
  "Who has the most centuries for India?": {
    sql: `SELECT p.player_name, SUM(pp.hundreds) AS total_centuries FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'India' GROUP BY p.player_name ORDER BY total_centuries DESC LIMIT 1;`
  },
  "Most centuries for Australia": {
    sql: `SELECT p.player_name, SUM(pp.hundreds) AS total_centuries FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'Australia' GROUP BY p.player_name ORDER BY total_centuries DESC LIMIT 1;`
  },
  "Top century scorer for Pakistan": {
    sql: `SELECT p.player_name, SUM(pp.hundreds) AS total_centuries FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'Pakistan' GROUP BY p.player_name ORDER BY total_centuries DESC LIMIT 1;`
  },
  "England player with most centuries": {
    sql: `SELECT p.player_name, SUM(pp.hundreds) AS total_centuries FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'England' GROUP BY p.player_name ORDER BY total_centuries DESC LIMIT 1;`
  },
  "Top 100 scorer for Bangladesh": {
    sql: `SELECT p.player_name, SUM(pp.hundreds) AS total_centuries FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'Bangladesh' GROUP BY p.player_name ORDER BY total_centuries DESC LIMIT 1;`
  },
  "Most centuries by a Sri Lankan batsman": {
    sql: `SELECT p.player_name, SUM(pp.hundreds) AS total_centuries FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'Sri Lanka' GROUP BY p.player_name ORDER BY total_centuries DESC LIMIT 1;`
  },

  // 🏏 Total Runs
  "Top scorer for India in ODIs": {
    sql: `SELECT p.player_name, SUM(pp.run_scored) AS total_runs FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'India' AND pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY total_runs DESC LIMIT 1;`
  },
  "Top scorer for Australia in T20s": {
    sql: `SELECT p.player_name, SUM(pp.run_scored) AS total_runs FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'Australia' AND pp.match_type = 'T20' GROUP BY p.player_name ORDER BY total_runs DESC LIMIT 1;`
  },
  "Top scorer for England in Test matches": {
    sql: `SELECT p.player_name, SUM(pp.run_scored) AS total_runs FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'England' AND pp.match_type = 'TEST' GROUP BY p.player_name ORDER BY total_runs DESC LIMIT 1;`
  },
  "Top ODI scorer for South Africa": {
    sql: `SELECT p.player_name, SUM(pp.run_scored) AS total_runs FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'South Africa' AND pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY total_runs DESC LIMIT 1;`
  },
  "Top Test scorer from New Zealand": {
    sql: `SELECT p.player_name, SUM(pp.run_scored) AS total_runs FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'New Zealand' AND pp.match_type = 'TEST' GROUP BY p.player_name ORDER BY total_runs DESC LIMIT 1;`
  },
  "Top run scorer in T20s for Pakistan": {
    sql: `SELECT p.player_name, SUM(pp.run_scored) AS total_runs FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'Pakistan' AND pp.match_type = 'T20' GROUP BY p.player_name ORDER BY total_runs DESC LIMIT 1;`
  },

  // 🎯 Bowling
  "Top wicket taker for India in T20s": {
    sql: `SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'India' AND pp.match_type = 'T20' GROUP BY p.player_name ORDER BY total_wickets DESC LIMIT 1;`
  },
  "Top wicket taker for South Africa in ODIs": {
    sql: `SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'South Africa' AND pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY total_wickets DESC LIMIT 1;`
  },
  "Most wickets taken by Pakistan in Tests": {
    sql: `SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'Pakistan' AND pp.match_type = 'TEST' GROUP BY p.player_name ORDER BY total_wickets DESC LIMIT 1;`
  },
  "Top West Indies bowler in T20 cricket": {
    sql: `SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'West Indies' AND pp.match_type = 'T20' GROUP BY p.player_name ORDER BY total_wickets DESC LIMIT 1;`
  },
  "Sri Lanka’s highest ODI wicket taker": {
    sql: `SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'Sri Lanka' AND pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY total_wickets DESC LIMIT 1;`
  },
  "Most wickets by an Australian in Test matches": {
    sql: `SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE 'Australia' AND pp.match_type = 'TEST' GROUP BY p.player_name ORDER BY total_wickets DESC LIMIT 1;`
  },

  // ⭐ Player Ratings
  "Highest rated batsman in ODI": {
    sql: `SELECT p.player_name, pr.batting_rating FROM player_ratings pr JOIN players p ON pr.player_id = p.id WHERE pr.match_type = 'ODI' ORDER BY pr.batting_rating DESC LIMIT 1;`
  },
  "Top bowling rating in Test matches": {
    sql: `SELECT p.player_name, pr.bowling_rating FROM player_ratings pr JOIN players p ON pr.player_id = p.id WHERE pr.match_type = 'TEST' ORDER BY pr.bowling_rating DESC LIMIT 1;`
  },
  "Top allrounder in T20s by rating": {
    sql: `SELECT p.player_name, pr.allrounder_rating FROM player_ratings pr JOIN players p ON pr.player_id = p.id WHERE pr.match_type = 'T20' ORDER BY pr.allrounder_rating DESC LIMIT 1;`
  },
  "Best rated allrounder in ODI": {
    sql: `SELECT p.player_name, pr.allrounder_rating FROM player_ratings pr JOIN players p ON pr.player_id = p.id WHERE pr.match_type = 'ODI' ORDER BY pr.allrounder_rating DESC LIMIT 1;`
  },
  "Highest rated T20 bowler": {
    sql: `SELECT p.player_name, pr.bowling_rating FROM player_ratings pr JOIN players p ON pr.player_id = p.id WHERE pr.match_type = 'T20' ORDER BY pr.bowling_rating DESC LIMIT 1;`
  },

  // 🏆 Tournament Winners
  "Who won Asia Cup 2023?": {
    sql: `SELECT winner FROM match_history WHERE match_name ILIKE '%Asia Cup%' AND match_time::text LIKE '2023%' ORDER BY match_time DESC LIMIT 1;`
  },
  "Winner of World Cup 2023": {
    sql: `SELECT winner FROM match_history WHERE match_name ILIKE '%World Cup%' AND match_time::text LIKE '2023%' ORDER BY match_time DESC LIMIT 1;`
  },
  "Latest World Cup winner": {
    sql: `SELECT winner FROM match_history WHERE match_name ILIKE '%World Cup%' ORDER BY match_time DESC LIMIT 1;`
  },
  "Asia Cup 2022 winner?": {
    sql: `SELECT winner FROM match_history WHERE match_name ILIKE '%Asia Cup%' AND match_time::text LIKE '2022%' ORDER BY match_time DESC LIMIT 1;`
  },
  "WTC Final 2023 winner?": {
    sql: `SELECT winner FROM match_history WHERE match_name ILIKE '%WTC%' AND match_time::text LIKE '2023%' ORDER BY match_time DESC LIMIT 1;`
  },
  "Champions Trophy 2017 winner": {
    sql: `SELECT winner FROM match_history WHERE match_name ILIKE '%Champions Trophy%' AND match_time::text LIKE '2017%' ORDER BY match_time DESC LIMIT 1;`
  },

  // 📊 Team Stats
  "Which team has the highest number of centuries?": {
    sql: `SELECT team_name, SUM(hundreds) AS total_centuries FROM player_performance GROUP BY team_name ORDER BY total_centuries DESC LIMIT 1;`
  },
  "Which team took most wickets in ODIs?": {
    sql: `SELECT team_name, SUM(wickets_taken) AS total_wickets FROM player_performance WHERE match_type = 'ODI' GROUP BY team_name ORDER BY total_wickets DESC LIMIT 1;`
  },
  "Which team has the best batting average in T20s?": {
    sql: `SELECT team_name, AVG(batting_avg) AS avg_batting FROM player_performance WHERE match_type = 'T20' GROUP BY team_name ORDER BY avg_batting DESC LIMIT 1;`
  },
  "Best bowling average among teams in ODI": {
    sql: `SELECT team_name, AVG(bowling_avg) AS avg_bowling FROM player_performance WHERE match_type = 'ODI' GROUP BY team_name ORDER BY avg_bowling ASC LIMIT 1;`
  },
  "Team with most runs in Test cricket": {
    sql: `SELECT team_name, SUM(run_scored) AS total_runs FROM player_performance WHERE match_type = 'TEST' GROUP BY team_name ORDER BY total_runs DESC LIMIT 1;`
  },

  // 🔥 Milestones
  "Who hit the fastest century in T20s?": {
    sql: `SELECT p.player_name, MIN(pp.balls_faced) AS balls FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.hundreds > 0 AND pp.match_type = 'T20' GROUP BY p.player_name ORDER BY balls ASC LIMIT 1;`
  },
  "Which player has most fifties in ODIs?": {
    sql: `SELECT p.player_name, SUM(pp.fifties) AS total_fifties FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY total_fifties DESC LIMIT 1;`
  },
  "Best strike rate in T20 cricket": {
    sql: `SELECT p.player_name, MAX(pp.strike_rate) AS best_strike_rate FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'T20' GROUP BY p.player_name ORDER BY best_strike_rate DESC LIMIT 1;`
  },
  "Fastest fifty in ODI history?": {
    sql: `SELECT p.player_name, MIN(pp.balls_faced) AS balls FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.fifties > 0 AND pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY balls ASC LIMIT 1;`
  },
  "Highest individual score in any format": {
    sql: `SELECT p.player_name, MAX(pp.highest) AS highest_score FROM player_performance pp JOIN players p ON pp.player_id = p.id GROUP BY p.player_name ORDER BY highest_score DESC LIMIT 1;`
  },
  "Most sixes hit in T20 internationals": {
    sql: `SELECT p.player_name, SUM(pp.sixes) AS total_sixes FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'T20' GROUP BY p.player_name ORDER BY total_sixes DESC LIMIT 1;`
  },

  // 🎖️ Fun / Trivia
  "Who played the most matches in ODIs?": {
    sql: `SELECT p.player_name, COUNT(*) AS match_count FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY match_count DESC LIMIT 1;`
  },
  "Youngest player to score a century in ODI?": {
    sql: `SELECT p.player_name, MIN(p.age) AS youngest_age FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.hundreds > 0 AND pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY youngest_age ASC LIMIT 1;`
  },
  "Highest total score in a Test match?": {
    sql: `SELECT match_name, GREATEST(runs1 + COALESCE(runs1_2,0), runs2 + COALESCE(runs2_2,0)) AS total_score FROM match_history WHERE match_type = 'TEST' ORDER BY total_score DESC LIMIT 1;`
  },
  "Highest partnership ever in international cricket?": {
    sql: `SELECT p1.player_name AS batsman1, p2.player_name AS batsman2, MAX(pp.partnership) AS max_partnership FROM player_performance pp JOIN players p1 ON pp.player_id = p1.id JOIN players p2 ON pp.partner_id = p2.id GROUP BY batsman1, batsman2 ORDER BY max_partnership DESC LIMIT 1;`
  },
  "Wicketkeeper with most dismissals in ODI": {
    sql: `SELECT p.player_name, SUM(pp.dismissals) AS total_dismissals FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY total_dismissals DESC LIMIT 1;`
  },
  "Which player has most ducks in career?": {
    sql: `SELECT p.player_name, SUM(pp.ducks) AS total_ducks FROM player_performance pp JOIN players p ON pp.player_id = p.id GROUP BY p.player_name ORDER BY total_ducks DESC LIMIT 1;`
  },

  // 💡 Player + Format + Team combos
  "How many centuries has Rohit Sharma scored in T20s?": {
    sql: `SELECT SUM(pp.hundreds) AS t20_centuries FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE p.player_name ILIKE 'Rohit Sharma' AND pp.match_type = 'T20';`
  },
  "Wickets taken by Ashwin in Test cricket?": {
    sql: `SELECT SUM(pp.wickets_taken) AS test_wickets FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE p.player_name ILIKE 'Ashwin' AND pp.match_type = 'TEST';`
  },
  "Total ODI runs by Virat Kohli?": {
    sql: `SELECT SUM(pp.run_scored) AS odi_runs FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE p.player_name ILIKE 'Virat Kohli' AND pp.match_type = 'ODI';`
  },
  "What is the batting rating of Steve Smith in Test?": {
    sql: `SELECT pr.batting_rating FROM player_ratings pr JOIN players p ON pr.player_id = p.id WHERE p.player_name ILIKE 'Steve Smith' AND pr.match_type = 'TEST' ORDER BY pr.batting_rating DESC LIMIT 1;`
  },
  "Batting average of Babar Azam in ODI?": {
    sql: `SELECT AVG(pp.batting_avg) AS avg_batting FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE p.player_name ILIKE 'Babar Azam' AND pp.match_type = 'ODI';`
  },

  // 🧠 ICC Stats (Advanced)
  "Top 3 ranked teams in T20s?": {
    sql: `SELECT team_name, rating FROM teams WHERE match_type = 'T20' ORDER BY rating DESC LIMIT 3;`
  },
  "Current ICC points table for ODI?": {
    sql: `SELECT team_name, matches, points, rating FROM teams WHERE match_type = 'ODI' ORDER BY rating DESC;`
  },
  "Which team has the highest NRR in T20?": {
    sql: `SELECT team_name, nrr FROM teams WHERE match_type = 'T20' ORDER BY nrr DESC LIMIT 1;`
  },
  "India's position in ICC Test ranking?": {
    sql: `SELECT rank FROM (SELECT team_name, RANK() OVER (ORDER BY rating DESC) AS rank FROM teams WHERE match_type = 'TEST') ranked WHERE team_name = 'India';`
  },

  // 🔁 Recent Events
  "Who won the last ODI match?": {
    sql: `SELECT winner FROM match_history WHERE match_type = 'ODI' ORDER BY match_time DESC LIMIT 1;`
  },
  "Top scorer in last T20 match?": {
    sql: `SELECT p.player_name, pp.run_scored FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'T20' AND pp.match_id = (SELECT id FROM match_history WHERE match_type = 'T20' ORDER BY match_time DESC LIMIT 1) ORDER BY pp.run_scored DESC LIMIT 1;`
  },
  "Top wicket taker in last Test match?": {
    sql: `SELECT p.player_name, pp.wickets_taken FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'TEST' AND pp.match_id = (SELECT id FROM match_history WHERE match_type = 'TEST' ORDER BY match_time DESC LIMIT 1) ORDER BY pp.wickets_taken DESC LIMIT 1;`
  },

  // 📅 Date-specific
  "Who won on 10 April 2024?": {
    sql: `SELECT winner FROM match_history WHERE match_time::date = '2024-04-10' ORDER BY match_time DESC LIMIT 1;`
  },
  "What were Kohli's stats on 15 March 2023?": {
    sql: `SELECT pp.*, m.match_name FROM player_performance pp JOIN players p ON pp.player_id = p.id JOIN match_history m ON pp.match_id = m.id WHERE p.player_name ILIKE '%Kohli%' AND m.match_time::date = '2023-03-15';`
  },

  // 💥 Strike Rate + Avg
  "Player with highest strike rate in T20s?": {
    sql: `SELECT p.player_name, MAX(pp.strike_rate) AS best_strike_rate FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'T20' GROUP BY p.player_name ORDER BY best_strike_rate DESC LIMIT 1;`
  },
  "Best batting average in Test cricket": {
    sql: `SELECT p.player_name, AVG(pp.batting_avg) AS best_avg FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'TEST' GROUP BY p.player_name ORDER BY best_avg DESC LIMIT 1;`
  },
  "Lowest bowling average in ODI": {
    sql: `SELECT p.player_name, AVG(pp.bowling_avg) AS best_bowl_avg FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY best_bowl_avg ASC LIMIT 1;`
  },

  // ⏳ Career Records
  "Player with longest international career": {
    sql: `SELECT p.player_name, (MAX(m.match_time)::date - MIN(m.match_time)::date) AS career_span FROM player_performance pp JOIN players p ON pp.player_id = p.id JOIN match_history m ON pp.match_id = m.id GROUP BY p.player_name ORDER BY career_span DESC LIMIT 1;`
  },
  "Who has played most matches as captain?": {
    sql: `SELECT p.player_name, COUNT(*) AS captain_matches FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.is_captain = true GROUP BY p.player_name ORDER BY captain_matches DESC LIMIT 1;`
  },
  "Player with most not outs in ODI": {
    sql: `SELECT p.player_name, SUM(pp.not_outs) AS total_not_outs FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY total_not_outs DESC LIMIT 1;`
  },

  // 📈 Win %
  "India's win percentage in T20s?": {
    sql: `
SELECT ROUND(100.0 * SUM(CASE WHEN winner like 'India%' THEN 1 ELSE 0 END)::numeric / COUNT(*), 2) AS win_percentage
FROM match_history WHERE match_type = 'T20' AND (team1 = 'India' OR team2 = 'India');`
  },
  "Australia win % in Test": {
    sql: `SELECT ROUND(100.0 * SUM(CASE WHEN winner = 'Australia' THEN 1 ELSE 0 END)::numeric / COUNT(*), 2) AS win_percentage 
FROM match_history WHERE match_type = 'Test' AND (team1 = 'Australia' OR team2 = 'Australia');`
  },
  "Pakistan win % in ODIs?": {
    sql: `SELECT ROUND(100.0 * SUM(CASE WHEN winner like 'Pakistan%' THEN 1 ELSE 0 END)::numeric / COUNT(*), 2) AS win_percentage 
FROM match_history WHERE match_type = 'ODI' AND (team1 = 'Pakistan' OR team2 = 'Pakistan');`
  },

  // 🎯 Economy + Bowling
  "Bowler with best economy in T20": {
    sql: `SELECT p.player_name, MIN(pp.economy) AS best_economy FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'T20' GROUP BY p.player_name ORDER BY best_economy ASC LIMIT 1;`
  },
  "Bowler with most dot balls in ODI?": {
    sql: `SELECT p.player_name, SUM(pp.dot_balls) AS total_dot_balls FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'ODI' GROUP BY p.player_name ORDER BY total_dot_balls DESC LIMIT 1;`
  },
  "Most maiden overs bowled in Test cricket?": {
    sql: `SELECT p.player_name, SUM(pp.maidens) AS total_maidens FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.match_type = 'TEST' GROUP BY p.player_name ORDER BY total_maidens DESC LIMIT 1;`
  },

  // 📉 Failures
  "Worst loss margin in ODI history?": {
    sql: `SELECT match_name, ABS(runs1 - runs2) AS margin FROM match_history WHERE match_type = 'ODI' ORDER BY margin DESC LIMIT 1;`
  },
  "Biggest batting collapse ever?": {
    sql: `SELECT match_name, MIN(wickets1), MIN(wickets2) FROM match_history WHERE wickets1 > 0 OR wickets2 > 0 ORDER BY MIN(wickets1), MIN(wickets2) ASC LIMIT 1;`
  },

  // 🏏 Enhanced Test/Generic Questions
"Wickets taken by [Player] in Test cricket": {
  sql: `SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets 
        FROM player_performance pp 
        JOIN players p ON pp.player_id = p.id 
        WHERE pp.match_type = 'TEST' AND p.player_name ILIKE $1
        GROUP BY p.player_name;`
},

  "Highest total score in a Test match": {
    sql: `SELECT match_name, 
                 GREATEST(COALESCE(runs1,0) + COALESCE(runs1_2,0), COALESCE(runs2,0) + COALESCE(runs2_2,0)) AS total_score 
          FROM test_match_results 
          ORDER BY total_score DESC 
          LIMIT 1;`
  },

  "Team with most runs in Test Match": {
    sql: `SELECT team_name, SUM(runs_scored) AS total_runs
          FROM (
            SELECT team1 AS team_name, COALESCE(runs1,0) + COALESCE(runs1_2,0) AS runs_scored FROM test_match_results
            UNION ALL
            SELECT team2 AS team_name, COALESCE(runs2,0) + COALESCE(runs2_2,0) AS runs_scored FROM test_match_results
          ) AS combined
          GROUP BY team_name
          ORDER BY total_runs DESC
          LIMIT 1;`
  },

  "Top Bowling ratings in Test Match": {
    sql: `SELECT p.player_name, pr.bowling_rating
          FROM player_ratings pr
          JOIN players p ON pr.player_id = p.id
          WHERE pr.match_type = 'TEST'
          ORDER BY pr.bowling_rating DESC
          LIMIT 5;`
  },

  "Most wickets by an Australian in Test matches": {
    sql: `WITH wicket_counts AS (
            SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets
            FROM player_performance pp
            JOIN players p ON pp.player_id = p.id
            WHERE pp.team_name ILIKE 'Australia' AND pp.match_type = 'TEST'
            GROUP BY p.player_name
          )
          SELECT player_name, total_wickets
          FROM wicket_counts
          WHERE total_wickets = (SELECT MAX(total_wickets) FROM wicket_counts);`
  },

  "Most Wicket Taken By Pakistan in Test Match": {
    sql: `WITH wicket_counts AS (
            SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets
            FROM player_performance pp
            JOIN players p ON pp.player_id = p.id
            WHERE pp.team_name ILIKE 'Pakistan' AND pp.match_type = 'TEST'
            GROUP BY p.player_name
          )
          SELECT player_name, total_wickets
          FROM wicket_counts
          WHERE total_wickets = (SELECT MAX(total_wickets) FROM wicket_counts);`
  },

  "Top Scorer for England in Test Match": {
    sql: `WITH run_counts AS (
            SELECT p.player_name, SUM(pp.run_scored) AS total_runs
            FROM player_performance pp
            JOIN players p ON pp.player_id = p.id
            WHERE pp.team_name ILIKE 'England' AND pp.match_type = 'TEST'
            GROUP BY p.player_name
          )
          SELECT player_name, total_runs
          FROM run_counts
          WHERE total_runs = (SELECT MAX(total_runs) FROM run_counts);`
  },

  "Highest individual score in any format": {
    sql: `WITH individual_scores AS (
            SELECT p.player_name, pp.team_name, pp.match_type, MAX(pp.run_scored) AS top_score
            FROM player_performance pp
            JOIN players p ON pp.player_id = p.id
            GROUP BY p.player_name, pp.team_name, pp.match_type
          )
          SELECT player_name, team_name, match_type, top_score
          FROM individual_scores
          WHERE top_score = (SELECT MAX(top_score) FROM individual_scores);`
  },

  // 🏏 Enhanced Test Match Analytics

"Top Run Scorer for a Team in Test Matches": {
  sql: `
    WITH team_run_totals AS (
      SELECT pp.team_name, p.player_name, SUM(pp.run_scored) AS total_runs
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE pp.match_type = 'Test'
      GROUP BY pp.team_name, p.player_name
    )
    SELECT team_name, player_name, total_runs
    FROM team_run_totals
    WHERE (team_name, total_runs) IN (
      SELECT team_name, MAX(total_runs) AS max_runs
      FROM team_run_totals
      GROUP BY team_name
    )
    ORDER BY team_name, player_name;
  `
},

"Top Wicket Taker for a Team in Test Matches": {
  sql: `
    WITH team_wicket_totals AS (
      SELECT pp.team_name, p.player_name, SUM(pp.wickets_taken) AS total_wickets
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE pp.match_type = 'Test'
      GROUP BY pp.team_name, p.player_name
    )
    SELECT team_name, player_name, total_wickets
    FROM team_wicket_totals
    WHERE (team_name, total_wickets) IN (
      SELECT team_name, MAX(total_wickets) AS max_wickets
      FROM team_wicket_totals
      GROUP BY team_name
    )
    AND total_wickets >= 1
    ORDER BY team_name, player_name;
  `
},

"Most Centuries by a Player in Test Matches": {
  sql: `
    WITH century_counts AS (
      SELECT p.player_name, SUM(pp.hundreds) AS total_centuries
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE pp.match_type = 'Test'
      GROUP BY p.player_name
    )
    SELECT player_name, total_centuries
    FROM century_counts
    WHERE total_centuries = (
      SELECT MAX(total_centuries) FROM century_counts
    );
  `
},

"Total Runs Scored by a Team in Test Matches": {
  sql: `
    SELECT team_name, SUM(runs_scored) AS total_runs
    FROM (
      SELECT team1 AS team_name, COALESCE(runs1,0) + COALESCE(runs1_2,0) AS runs_scored FROM test_match_results
      UNION ALL
      SELECT team2 AS team_name, COALESCE(runs2,0) + COALESCE(runs2_2,0) AS runs_scored FROM test_match_results
    ) AS combined
    GROUP BY team_name
    ORDER BY total_runs DESC;
  `
},

"Highest Individual Test Score (All Time)": {
  sql: `
    SELECT p.player_name AS player, pp.team_name AS team, MAX(pp.run_scored) AS top_score
    FROM player_performance pp
    JOIN players p ON pp.player_id = p.id
    WHERE pp.match_type = 'Test'
    GROUP BY p.player_name, pp.team_name
    ORDER BY top_score DESC
    LIMIT 1;
  `
},

"Total Wickets by a Player in Test Matches": {
  sql: `
    SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets
    FROM player_performance pp
    JOIN players p ON pp.player_id = p.id
    WHERE pp.match_type = 'Test'
    GROUP BY p.player_name
    ORDER BY total_wickets DESC;
  `
},

"Last Test Match Winner": {
  sql: `
    SELECT winner
    FROM test_match_results
    ORDER BY created_at DESC
    LIMIT 1;
  `
},

"Team with Most Test Wins": {
  sql: `
    SELECT team, wins
    FROM (
      SELECT winner AS team, COUNT(*) AS wins
      FROM test_match_results
      WHERE match_type ILIKE 'Test'
        AND winner IS NOT NULL
        AND winner <> ''
      GROUP BY winner
    ) AS win_counts
    WHERE wins = (
      SELECT MAX(wins)
      FROM (
        SELECT COUNT(*) AS wins
        FROM test_match_results
        WHERE match_type ILIKE 'Test'
          AND winner IS NOT NULL
          AND winner <> ''
        GROUP BY winner
      ) AS all_win_counts
    );
  `
},

"Most Fifties by a Player in Test Matches": {
  sql: `
    WITH fifty_counts AS (
      SELECT p.player_name, SUM(pp.fifties) AS total_fifties
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE pp.match_type = 'Test'
      GROUP BY p.player_name
    )
    SELECT player_name, total_fifties
    FROM fifty_counts
    WHERE total_fifties = (SELECT MAX(total_fifties) FROM fifty_counts);
  `
},

"Best Batting Average in Tests": {
  sql: `
    WITH batting_averages AS (
      SELECT
        p.player_name,
        ROUND(
          SUM(pp.run_scored)::decimal
          / NULLIF(SUM(CASE WHEN pp.dismissed <> 'Not Out' THEN 1 ELSE 0 END), 0),
          2
        ) AS batting_avg
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE pp.match_type = 'Test'
      GROUP BY p.player_name
      HAVING SUM(CASE WHEN pp.dismissed <> 'Not Out' THEN 1 ELSE 0 END) > 0
    )
    SELECT player_name, batting_avg
    FROM batting_averages
    WHERE batting_avg = (SELECT MAX(batting_avg) FROM batting_averages);
  `
},
"Top 3 ranked teams in T20s?": {
  sql: `SELECT name AS team_name, matches_played, wins, losses, points, nrr
        FROM teams
        WHERE match_id IS NOT NULL
        ORDER BY points DESC, nrr DESC
        LIMIT 3;`
},

"Current ICC points table for ODI?": {
  sql: `SELECT DISTINCT name AS team_name, m.match_type, matches_played, wins, losses, points, nrr
        FROM teams t
        JOIN matches m ON t.match_id = m.id
        WHERE m.match_type = 'ODI' AND match_id IS NOT NULL
        ORDER BY points DESC, nrr DESC;`
},

"Which team has the highest NRR in T20?": {
  sql: `SELECT name AS team_name, nrr
        FROM teams t
        JOIN matches m ON t.match_id = m.id
        WHERE m.match_type = 'T20' AND match_id IS NOT NULL
        ORDER BY nrr DESC
        LIMIT 1;`
},

"India's position in ICC Test ranking?": {
  sql: `SELECT team_name, position FROM (
          SELECT name AS team_name,
                 ROW_NUMBER() OVER (ORDER BY points DESC, nrr DESC) AS position
          FROM teams t
          JOIN matches m ON t.match_id = m.id
          WHERE m.match_type = 'Test' AND match_id IS NOT NULL
        ) ranked
        WHERE team_name = 'India';`
},
// 🏆 ICC Team Stats & Rankings

"Top 3 ranked teams in T20s?": {
  sql: `
    SELECT t.name AS team_name, t.matches_played, t.wins, t.losses, t.points, t.nrr
    FROM teams t
    JOIN matches m ON t.match_id = m.id
    WHERE m.match_type = 'T20' AND t.match_id IS NOT NULL
    ORDER BY t.points DESC, t.nrr DESC
    LIMIT 3;
  `
},

"Current ICC points table for ODI?": {
  sql: `
    SELECT DISTINCT t.name AS team_name, m.match_type, t.matches_played, t.wins, t.losses, t.points, t.nrr
    FROM teams t
    JOIN matches m ON t.match_id = m.id
    WHERE m.match_type = 'ODI' AND t.match_id IS NOT NULL
    ORDER BY t.points DESC, t.nrr DESC;
  `
},

"Which team has the highest NRR in T20?": {
  sql: `
    SELECT t.name AS team_name, t.nrr
    FROM teams t
    JOIN matches m ON t.match_id = m.id
    WHERE m.match_type = 'T20' AND t.match_id IS NOT NULL
    ORDER BY t.nrr DESC
    LIMIT 1;
  `
},

"India's position in ICC Test ranking?": {
  sql: `
    SELECT team_name, position FROM (
      SELECT t.name AS team_name,
             ROW_NUMBER() OVER (ORDER BY t.points DESC, t.nrr DESC) AS position
      FROM teams t
      JOIN matches m ON t.match_id = m.id
      WHERE m.match_type = 'Test' AND t.match_id IS NOT NULL
    ) ranked
    WHERE team_name ILIKE 'India';
  `
},


};


module.exports = queryMappings;
