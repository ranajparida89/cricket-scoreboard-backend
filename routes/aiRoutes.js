// routes/aiRoutes.js (✅ Step 5: Fully Functional SQL-based AI Analyzer - 17 May 2025)
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ POST /api/analyzer/query - Keyword-Based Cricket Logic Handler
router.post("/query", async (req, res) => {
  const { question } = req.body;

  if (!question || question.trim().length < 5) {
    return res.status(400).json({ result: "❗ Please enter a valid question." });
  }

  try {
    const q = question.toLowerCase();

    // ✅ Most centuries by team (e.g., India)
    if (q.includes("most centuries") && q.includes("for")) {
      const team = q.split("for")[1].trim();
      const sql = `
        SELECT p.player_name, SUM(pp.hundreds) AS total_centuries
        FROM player_performance pp
        JOIN players p ON pp.player_id = p.id
        WHERE pp.team_name ILIKE $1
        GROUP BY p.player_name
        ORDER BY total_centuries DESC
        LIMIT 1
      `;
      const result = await pool.query(sql, [team]);
      if (result.rows.length === 0) {
        return res.json({ result: `No centuries found for ${team}?` });
      }
      return res.json({ result: `${result.rows[0].player_name} has scored the most centuries (${result.rows[0].total_centuries}) for ${team}.` });
    }

    // ✅ Top wicket-taker by team + match type
    if (q.includes("top wicket") || q.includes("most wickets")) {
      const teamMatch = q.match(/for ([a-zA-Z ]+)(?: in ([a-zA-Z]+))?/);
      if (teamMatch) {
        const team = teamMatch[1].trim();
        const matchType = teamMatch[2] ? teamMatch[2].trim().toUpperCase() : null;

        const sql = `
          SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets
          FROM player_performance pp
          JOIN players p ON pp.player_id = p.id
          WHERE pp.team_name ILIKE $1 ${matchType ? "AND pp.match_type = $2" : ""}
          GROUP BY p.player_name
          ORDER BY total_wickets DESC
          LIMIT 1
        `;
        const values = matchType ? [team, matchType] : [team];
        const result = await pool.query(sql, values);

        if (result.rows.length === 0) {
          return res.json({ result: `No wicket data found for ${team} ${matchType || ""}` });
        }
        return res.json({ result: `${result.rows[0].player_name} took the most wickets (${result.rows[0].total_wickets}) for ${team}${matchType ? ` in ${matchType}` : ""}.` });
      }
    }

    // ✅ Top scorer by team
    if (q.includes("top scorer") || q.includes("most runs")) {
      const teamMatch = q.match(/for ([a-zA-Z ]+)(?: in ([a-zA-Z]+))?/);
      if (teamMatch) {
        const team = teamMatch[1].trim();
        const matchType = teamMatch[2] ? teamMatch[2].trim().toUpperCase() : null;

        const sql = `
          SELECT p.player_name, SUM(pp.run_scored) AS total_runs
          FROM player_performance pp
          JOIN players p ON pp.player_id = p.id
          WHERE pp.team_name ILIKE $1 ${matchType ? "AND pp.match_type = $2" : ""}
          GROUP BY p.player_name
          ORDER BY total_runs DESC
          LIMIT 1
        `;
        const values = matchType ? [team, matchType] : [team];
        const result = await pool.query(sql, values);

        if (result.rows.length === 0) {
          return res.json({ result: `No scoring data found for ${team}` });
        }
        return res.json({ result: `${result.rows[0].player_name} is the top scorer with ${result.rows[0].total_runs} runs for ${team}${matchType ? ` in ${matchType}` : ""}.` });
      }
    }

    // ✅ Fallback
    return res.json({
      result:
        "❓ I couldn't understand the question. Try asking things like:\n• Most centuries for India\n• Top wicket-taker for Australia\n• Total runs by Virat Kohli"
    });
  } catch (err) {
    console.error("❌ AI Query Error:", err);
    res.status(500).json({ result: "Server error while analyzing query." });
  }
});

module.exports = router;
