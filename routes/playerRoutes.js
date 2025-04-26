// ✅ POST /api/add-player
const router = require("express").Router(); // ✅ You missed this line!
const pool = require("../db");

router.post("/add-player", async (req, res) => {
    const {
      lineup_type,
      player_name,
      team_name,
      skill_type,
      bowling_type,
      batting_style,
      is_captain,
      is_vice_captain
    } = req.body;
  
    try {
      // Basic validations
      if (!player_name || !team_name || !lineup_type || !skill_type) {
        return res.status(400).json({ error: "Required fields missing" });
      }
      // 🔒 Restrict to 15 players in same team + format
      const checkCount = await pool.query(
        `SELECT COUNT(*) FROM players WHERE team_name = $1 AND lineup_type = $2`,
        [team_name, lineup_type]
      );
  
      if (parseInt(checkCount.rows[0].count) >= 15) {
        return res.status(400).json({ error: "Cannot add more than 15 players to this squad." });
      }
  
      const result = await pool.query(
        `INSERT INTO players 
          (lineup_type, player_name, team_name, skill_type, bowling_type, batting_style, is_captain, is_vice_captain)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [lineup_type, player_name, team_name, skill_type, bowling_type, batting_style, is_captain, is_vice_captain]
      );
  
      res.json({ message: "Player added successfully", player: result.rows[0] });
    } catch (err) {
      console.error("Add Player Error:", err.message);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ✅ GET all players for SquadLineup view
router.get("/players", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM players ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch Players Error:", err.message);
    res.status(500).json({ error: "Failed to fetch players" });
  }
});

// ✅ PUT: Update Player by ID
router.put('/players/:id', async (req, res) => {
  const { id } = req.params;
  const {
    player_name, team_name, lineup_type,
    skill_type, bowling_type, batting_style,
    is_captain, is_vice_captain
  } = req.body;

  try {
    const updateQuery = `
      UPDATE players SET
        player_name = $1,
        team_name = $2,
        lineup_type = $3,
        skill_type = $4,
        bowling_type = $5,
        batting_style = $6,
        is_captain = $7,
        is_vice_captain = $8
      WHERE id = $9
    `;
    await pool.query(updateQuery, [
      player_name, team_name, lineup_type,
      skill_type, bowling_type, batting_style,
      is_captain, is_vice_captain, id
    ]);

    res.json({ message: "Player updated successfully" });
  } catch (err) {
    console.error("Update Player Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ STEP 1: Backend API for Deleting a Player Ranaj Parida 24-04-2025
// ✅ File: playerRoutes.js
router.delete("/delete-player/:id", async (req, res) => {
  const playerId = req.params.id;
  try {
    await pool.query("DELETE FROM players WHERE id = $1", [playerId]);
    res.json({ message: "Player deleted successfully" });
  } catch (err) {
    console.error("Delete Player Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ STEP 2: Frontend - SquadLineup.js additions
// ✅ Add this above return in SquadLineup component

// ✅ PUT /api/update-player
router.put("/update-player", async (req, res) => {
  const {
    id,
    player_name,
    team_name,
    skill_type,
    lineup_type
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE players 
       SET player_name = $1, team_name = $2, skill_type = $3, lineup_type = $4
       WHERE id = $5 RETURNING *`,
      [player_name, team_name, skill_type, lineup_type, id]
    );

    res.json({ message: "Player updated", player: result.rows[0] });
  } catch (err) {
    console.error("Update Player Error:", err);
    res.status(500).json({ error: "Failed to update player" });
  }
});

// fetching player performance data in playerperformace page -- Ranaj Parida 26-04-2025
// ✅ GET Player Performances for Player Stats Page
router.get("/player-stats", async (req, res) => {
  try {
    const { playerName, teamName, matchType } = req.query;

    let baseQuery = `SELECT pp.*, p.player_name 
                     FROM player_performance pp 
                     JOIN players p ON pp.player_id = p.id 
                     WHERE 1=1`;
    const queryParams = [];

    if (playerName) {
      queryParams.push(`%${playerName}%`);
      baseQuery += ` AND p.player_name ILIKE $${queryParams.length}`;
    }

    if (teamName) {
      queryParams.push(`%${teamName}%`);
      baseQuery += ` AND pp.team_name ILIKE $${queryParams.length}`;
    }

    if (matchType && matchType !== "All") {
      queryParams.push(matchType);
      baseQuery += ` AND pp.match_type = $${queryParams.length}`;
    }

    baseQuery += ` ORDER BY pp.created_at DESC`;

    const result = await pool.query(baseQuery, queryParams);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching player stats:", err);
    res.status(500).json({ message: "❌ Server error while fetching player stats." });
  }
});

  module.exports = router;

  