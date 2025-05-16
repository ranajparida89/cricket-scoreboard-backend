// routes/aiRoutes.js (✅ Final AI + SQL Integration - 17 May 2025)
const express = require("express");
const router = express.Router();
const pool = require("../db");

// Utility: Clean and lowercase strings
const clean = (text) => text.trim().toLowerCase();

// ✅ POST /api/analyzer/query - Handles Natural Language Questions with Real DB Results
router.post("/query", async (req, res) => {
  const { question } = req.body;

  if (!question || question.trim().length < 5) {
    return res.status(400).json({ error: "Please enter a valid question." });
  }

  try {
    const q = clean(question);

    // ✅ 1. Most centuries for team
    if (q.includes("most centuries for")) {
      const team = q.split("for")[1].trim();
      const result = await pool.query(`
        SELECT p.player_name, COUNT(*) AS centuries
        FROM player_performance pp
        JOIN players p ON p.id = pp.player_id
        WHERE pp.team_name ILIKE $1 AND pp.run_scored >= 100
        GROUP BY p.player_name
        ORDER BY centuries DESC
        LIMIT 1
      `, [team]);

      if (result.rows.length === 0) return res.json({ result: `No centuries found for ${team}` });

      const { player_name, centuries } = result.rows[0];
      return res.json({ result: `${player_name} has the most centuries (${centuries}) for ${team}.` });
    }

    // ✅ 2. Top wicket-taker for team
    if (q.includes("top wicket") || q.includes("most wickets for")) {
      const team = q.split("for")[1].trim();
      const result = await pool.query(`
        SELECT p.player_name, SUM(pp.wickets_taken) AS total_wickets
        FROM player_performance pp
        JOIN players p ON p.id = pp.player_id
        WHERE pp.team_name ILIKE $1
        GROUP BY p.player_name
        ORDER BY total_wickets DESC
        LIMIT 1
      `, [team]);

      if (result.rows.length === 0) return res.json({ result: `No wicket data found for ${team}` });

      const { player_name, total_wickets } = result.rows[0];
      return res.json({ result: `${player_name} has taken the most wickets (${total_wickets}) for ${team}.` });
    }

    // ✅ 3. Total runs scored by player
    if (q.includes("total runs by") || q.includes("how many runs")) {
      const player = q.replace("total runs by", "").replace("how many runs", "").trim();
      const result = await pool.query(`
        SELECT SUM(run_scored) AS total_runs
        FROM player_performance pp
        JOIN players p ON pp.player_id = p.id
        WHERE LOWER(p.player_name) = LOWER($1)
      `, [player]);

      if (!result.rows[0].total_runs) return res.json({ result: `No run data found for ${player}` });

      return res.json({ result: `${player} has scored ${result.rows[0].total_runs} runs.` });
    }

    // ✅ 4. Unknown question fallback
    return res.json({
      result: "❓ I couldn't understand the question. Try asking things like:\n• Most centuries for India\n• Top wicket-taker for Australia\n• Total runs by Virat Kohli"
    });

  } catch (error) {
    console.error("❌ AI Analyzer Error:", error);
    res.status(500).json({ error: "Internal error while analyzing query" });
  }
});

module.exports = router;
