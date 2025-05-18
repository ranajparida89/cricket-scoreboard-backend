// routes/aiRoutes.js (✅ CrickEdge Smart Analyzer - Dynamic SQL Mapping + NLP Fallback)
const express = require("express");
const router = express.Router();
const pool = require("../db");
const queryMappings = require("./QuerySQLMappings"); // ✅ Ensure correct path

// ✅ Synonym maps to translate natural queries to SQL intent
const synonyms = [
  { pattern: /\bhighest .*centur(y|ies)|most .*hundreds/i, rewrite: "most centuries for" },
  { pattern: /top.*run.*(getter|scorer)?|most runs/i, rewrite: "top scorer for" },
  { pattern: /top.*wicket.*(taker)?|best bowling|most wickets/i, rewrite: "top wicket taker for" },
  { pattern: /who.*won.*world cup|asia cup/i, rewrite: "winner of" },
  { pattern: /highest rated .*batsman/i, rewrite: "highest rated batsman in" },
  { pattern: /rating.*bowler/i, rewrite: "highest rated bowler in" },
];

// ✅ Default fallback suggestions
const suggestions = [
  "Top scorer for India in ODI",
  "Top wicket taker for Australia",
  "Most centuries for India",
  "Who won World Cup 2023?",
  "Highest rated batsman in T20",
  "Who took most wickets for Pakistan in Asia Cup?",
  "Top allrounder rating in ODI",
  "Top bowler for India in Test"
];

// ✅ Normalizer
function normalizeQuestion(q) {
  for (const rule of synonyms) {
    if (rule.pattern.test(q)) return rule.rewrite + q.replace(rule.pattern, "").trim();
  }
  return q.toLowerCase();
}

// ✅ POST /api/analyzer/query
router.post("/query", async (req, res) => {
  const { question } = req.body;
  if (!question || question.trim().length < 4)
    return res.status(400).json({ result: "❗ Please enter a valid question." });

  const raw = question.trim();

  // 1️⃣ Direct SQL mapping for dropdown queries
  if (queryMappings[raw] && queryMappings[raw].sql) {
    try {
      const result = await pool.query(queryMappings[raw].sql);
      if (!result.rows.length) {
        return res.json({ result: "<p>No data found.</p>" });
      }
      // If a custom formatter is provided in mapping, use it
      if (queryMappings[raw].format) {
        return res.json({ result: queryMappings[raw].format(result.rows) });
      }
      // Otherwise, default output as table or JSON
      const keys = Object.keys(result.rows[0]);
      const table =
        "<table class='result-table'><thead><tr>" +
        keys.map(k => `<th>${k}</th>`).join("") +
        "</tr></thead><tbody>" +
        result.rows.map(row =>
          `<tr>${keys.map(k => `<td>${row[k]}</td>`).join("")}</tr>`
        ).join("") +
        "</tbody></table>";
      return res.json({ result: table });
    } catch (err) {
      return res.status(500).json({ result: "Server error while running query." });
    }
  }

  // 2️⃣ NLP fallback for custom or general queries
  const q = normalizeQuestion(raw);

  try {
    // 🏏 Most Centuries
    if (q.includes("most centuries") && q.includes("for")) {
      const team = q.split("for")[1].trim();
      const sql = `SELECT p.player_name, SUM(pp.hundreds) AS total_centuries FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE $1 GROUP BY p.player_name ORDER BY total_centuries DESC LIMIT 1`;
      const result = await pool.query(sql, [team]);
      if (result.rows.length === 0)
        return res.json({ result: `<p>No centuries found for <em>${team}</em>.</p>` });
      const r = result.rows[0];
      return res.json({
        result: `<h3>🏏 Most Centuries</h3><p><strong>${r.player_name}</strong> scored <strong>${r.total_centuries}</strong> centuries for <em>${team}</em>.</p>`
      });
    }

    // 🎯 Top Wicket Taker
    if (q.includes("top wicket") || q.includes("most wickets")) {
      const match = q.match(/for ([a-zA-Z ]+)(?: in ([a-zA-Z]+))?/);
      if (match) {
        const team = match[1].trim();
        const format = match[2]?.trim().toUpperCase();
        const sql = `SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE $1 ${format ? "AND pp.match_type = $2" : ""} GROUP BY p.player_name ORDER BY total_wickets DESC LIMIT 1`;
        const result = await pool.query(sql, format ? [team, format] : [team]);
        if (result.rows.length === 0)
          return res.json({ result: `<p>No data for ${team}${format ? " in " + format : ""}</p>` });
        const r = result.rows[0];
        return res.json({
          result: `<h3>🎯 Top Wicket Taker</h3><p><strong>${r.player_name}</strong> took <strong>${r.total_wickets}</strong> wickets for <em>${team}</em>${format ? ` in <strong>${format}</strong>` : ""}.</p>`
        });
      }
    }

    // 🏆 Top Scorer
    if (q.includes("top scorer") || q.includes("most runs")) {
      const match = q.match(/for ([a-zA-Z ]+)(?: in ([a-zA-Z]+))?/);
      if (match) {
        const team = match[1].trim();
        const format = match[2]?.trim().toUpperCase();
        const sql = `SELECT p.player_name, SUM(pp.run_scored) AS total_runs FROM player_performance pp JOIN players p ON pp.player_id = p.id WHERE pp.team_name ILIKE $1 ${format ? "AND pp.match_type = $2" : ""} GROUP BY p.player_name ORDER BY total_runs DESC LIMIT 1`;
        const result = await pool.query(sql, format ? [team, format] : [team]);
        if (result.rows.length === 0)
          return res.json({ result: `<p>No scorer data found for ${team}.</p>` });
        const r = result.rows[0];
        return res.json({
          result: `<h3>🏆 Top Scorer</h3><p><strong>${r.player_name}</strong> scored <strong>${r.total_runs}</strong> runs for <em>${team}</em>${format ? ` in <strong>${format}</strong>` : ""}.</p>`
        });
      }
    }

    // 🏆 Tournament Winner
    if (q.includes("winner") && (q.includes("world cup") || q.includes("asia cup"))) {
      const year = q.match(/\d{4}/)?.[0];
      const cup = q.includes("asia") ? "Asia Cup" : "World Cup";
      const sql = `SELECT winner FROM match_history WHERE match_name ILIKE $1 ${year ? "AND match_time::text LIKE $2" : ""} ORDER BY match_time DESC LIMIT 1`;
      const result = await pool.query(sql, year ? [`%${cup}%`, `${year}%`] : [`%${cup}%`]);
      if (result.rows.length === 0)
        return res.json({ result: `No result found for ${cup} ${year || ""}` });
      return res.json({
        result: `<h3>🏆 ${cup} Winner</h3><p><strong>${result.rows[0].winner}</strong> won the ${cup}${year ? ` in ${year}` : ""}.</p>`
      });
    }

    // 📊 Highest Rating
    if (q.includes("rated")) {
      const type = q.match(/batting|bowling|allrounder/)?.[0];
      const format = q.match(/in ([a-zA-Z]+)/)?.[1]?.toUpperCase();
      if (type && format) {
        const column = `${type}_rating`;
        const sql = `SELECT p.player_name, pr.${column} FROM player_ratings pr JOIN players p ON pr.player_id = p.id WHERE pr.match_type = $1 ORDER BY pr.${column} DESC LIMIT 1`;
        const result = await pool.query(sql, [format]);
        if (result.rows.length === 0)
          return res.json({ result: `<p>No rating data found.</p>` });
        return res.json({
          result: `<h3>📈 Highest ${type} Rating</h3><p><strong>${result.rows[0].player_name}</strong> rated <strong>${result.rows[0][column]}</strong> in ${format}.</p>`
        });
      }
    }

    // ❌ Fallback message
    return res.json({
      result: `<p>❓ I couldn't understand that query.</p>
        <p>Try asking:</p><ul>${suggestions.map(s => `<li>${s}</li>`).join("")}</ul>`
    });
  } catch (err) {
    console.error("❌ AI Analyzer Error:", err.message);
    res.status(500).json({ result: "Server error while analyzing query." });
  }
});

module.exports = router;
