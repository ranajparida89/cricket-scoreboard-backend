// matchStoryRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// Utility function to generate story
function generateMatchStory(match) {
  const { team1, team2, runs1, wickets1, overs1, runs2, wickets2, overs2, winner, match_type, match_name, match_time } = match;

  const margin = Math.abs(runs1 - runs2);
  const battingFirst = runs1 > runs2 ? team1 : team2;
  const chasingTeam = runs1 > runs2 ? team2 : team1;

  const topLine = winner
    ? `${winner} defeated ${winner === team1 ? team2 : team1} by ${margin} runs in a thrilling ${match_type} match.`
    : `The ${match_type} match between ${team1} and ${team2} ended in a draw.`;

  const fullStory = `${topLine} ${battingFirst} batted first and posted ${runs1}/${wickets1} in ${overs1} overs. ` +
    `${chasingTeam} responded with ${runs2}/${wickets2} in ${overs2} overs.`;

  return {
    id: match.id,
    title: `${team1} vs ${team2}`,
    type: match_type.toUpperCase(),
    story: fullStory,
    date: new Date(match_time).toISOString().split("T")[0]
  };
}

// GET /api/match-stories
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM match_history
      ORDER BY match_time DESC
      LIMIT 10
    `);

    const stories = result.rows.map(generateMatchStory);
    res.json(stories);
  } catch (err) {
    console.error("Error generating match stories:", err);
    res.status(500).json({ error: "Failed to generate match stories" });
  }
});

module.exports = router;
