// routes/aiRoutes.js (✅ CrickEdge Smart Analyzer - Full Natural Language + SQL Logic)
const express = require("express");
const router = express.Router();
const pool = require("../db");

// Utility to normalize user questions
function normalizeQuestion(question) {
  const q = question.toLowerCase();
  if (q.includes("highest") && q.includes("century")) return "most centuries for";
  if (q.includes("top") && q.includes("run")) return "top scorer for";
  if (q.includes("top") && q.includes("wicket")) return "top wicket taker for";
  if (q.includes("best") && q.includes("bowling")) return "top wicket taker for";
  if (q.includes("top") && q.includes("batsman")) return "most centuries for";
  return q;
}

// POST /api/analyzer/query
router.post("/query", async (req, res) => {
  const { question } = req.body;
  if (!question || question.trim().length < 5) {
    return res.status(400).json({ result: "❗ Please enter a valid question." });
  }

  try {
    const original = question;
    const q = normalizeQuestion(question);

    // 1. Most Centuries
    if (q.includes("most centuries") && q.includes("for")) {
      const team = q.split("for")[1].trim();
      const sql = `
        SELECT p.player_name, SUM(pp.hundreds) AS total_centuries
        FROM player_performance pp
        JOIN players p ON pp.player_id = p.id
        WHERE pp.team_name ILIKE $1
        GROUP BY p.player_name
        ORDER BY total_centuries DESC
        LIMIT 1`;
      const result = await pool.query(sql, [team]);
      if (result.rows.length === 0)
        return res.json({ result: `<strong>No data</strong> found for team <em>${team}</em>.` });
      const row = result.rows[0];
      return res.json({
        result: `<h3>🏏 Most Centuries</h3><p><strong>${row.player_name}</strong> has scored <strong>${row.total_centuries} centuries</strong> for <em>${team}</em>.</p>`
      });
    }

    // 2. Top Wicket Taker
    if (q.includes("top wicket") || q.includes("most wickets")) {
      const match = q.match(/for ([a-zA-Z ]+)(?: in ([a-zA-Z]+))?/);
      if (match) {
        const team = match[1].trim();
        const format = match[2] ? match[2].trim().toUpperCase() : null;
        const sql = `
          SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets
          FROM player_performance pp
          JOIN players p ON pp.player_id = p.id
          WHERE pp.team_name ILIKE $1 ${format ? "AND pp.match_type = $2" : ""}
          GROUP BY p.player_name
          ORDER BY total_wickets DESC
          LIMIT 1`;
        const result = await pool.query(sql, format ? [team, format] : [team]);
        if (result.rows.length === 0)
          return res.json({ result: `No data for ${team}${format ? " in " + format : ""}` });
        const row = result.rows[0];
        return res.json({
          result: `<h3>🎯 Top Wicket Taker</h3><p><strong>${row.player_name}</strong> has taken <strong>${row.total_wickets}</strong> wickets for <em>${team}</em>${format ? ` in <strong>${format}</strong>` : ""}.</p>`
        });
      }
    }

    // 3. Top Scorer
    if (q.includes("top scorer") || q.includes("most runs")) {
      const match = q.match(/for ([a-zA-Z ]+)(?: in ([a-zA-Z]+))?/);
      if (match) {
        const team = match[1].trim();
        const format = match[2] ? match[2].trim().toUpperCase() : null;
        const sql = `
          SELECT p.player_name, SUM(pp.run_scored) AS total_runs
          FROM player_performance pp
          JOIN players p ON pp.player_id = p.id
          WHERE pp.team_name ILIKE $1 ${format ? "AND pp.match_type = $2" : ""}
          GROUP BY p.player_name
          ORDER BY total_runs DESC
          LIMIT 1`;
        const result = await pool.query(sql, format ? [team, format] : [team]);
        if (result.rows.length === 0)
          return res.json({ result: `No scorer data for ${team}${format ? " in " + format : ""}` });
        const row = result.rows[0];
        return res.json({
          result: `<h3>🏆 Top Scorer</h3><p><strong>${row.player_name}</strong> scored <strong>${row.total_runs} runs</strong> for <em>${team}</em>${format ? ` in <strong>${format}</strong>` : ""}.</p>`
        });
      }
    }

    // 4. Tournament Winner
    if (q.includes("winner") && (q.includes("world cup") || q.includes("asia cup"))) {
      const year = q.match(/\d{4}/)?.[0];
      const cup = q.includes("asia") ? "Asia Cup" : "World Cup";
      const sql = `SELECT winner FROM match_history WHERE match_name ILIKE $1 ${year ? "AND match_time::text LIKE $2" : ""} ORDER BY match_time DESC LIMIT 1`;
      const result = await pool.query(sql, year ? [`%${cup}%`, `${year}%`] : [`%${cup}%`]);
      if (result.rows.length === 0)
        return res.json({ result: `No result for ${cup}${year ? ` in ${year}` : ""}` });
      return res.json({
        result: `<h3>🏆 ${cup} Winner</h3><p>The winner was <strong>${result.rows[0].winner}</strong>${year ? ` in ${year}` : ""}.</p>`
      });
    }

    // 5. Rating (optional)
    if (q.includes("highest rated") || q.includes("top rated")) {
      const type = q.match(/batting|bowling|allrounder/)?.[0];
      const matchType = q.match(/in ([a-zA-Z]+)/)?.[1]?.toUpperCase();
      if (type && matchType) {
        const column = `${type}_rating`;
        const sql = `SELECT p.player_name, pr.${column} FROM player_ratings pr JOIN players p ON p.id = pr.player_id WHERE pr.match_type = $1 ORDER BY pr.${column} DESC LIMIT 1`;
        const result = await pool.query(sql, [matchType]);
        if (result.rows.length === 0)
          return res.json({ result: `No rating data.` });
        return res.json({
          result: `<h3>⭐ Highest Rated ${type}</h3><p><strong>${result.rows[0].player_name}</strong> with rating <strong>${result.rows[0][column]}</strong> in ${matchType}.</p>`
        });
      }
    }

    // ❌ Default fallback
    return res.json({
      result: `❓ I couldn't understand the question.<br/><br/>Try asking:<ul>
      <li>Top scorer for India in ODI</li>
      <li>Top wicket taker for Australia</li>
      <li>Most centuries for India</li>
      <li>Who won World Cup 2023?</li>
      <li>Highest rated batsman in T20</li>
    </ul>`
    });
  } catch (err) {
    console.error("❌ AI Query Error:", err.message);
    res.status(500).json({ result: "Server error while analyzing query." });
  }
});

module.exports = router;
