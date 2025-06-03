const router = require("express").Router();
const pool = require("../db");

/**
 * ADD PLAYER
 * Only allows adding to current user's squad
 */
router.post("/add-player", async (req, res) => {
  const {
    lineup_type,
    player_name,
    team_name,
    skill_type,
    bowling_type,
    batting_style,
    is_captain,
    is_vice_captain,
    user_id // Required!
  } = req.body;

  try {
    // Basic validations
    if (!player_name || !team_name || !lineup_type || !skill_type) {
      return res.status(400).json({ error: "Required fields missing" });
    }
    if (!user_id) {
      return res.status(400).json({ error: "User not found. Please login again." });
    }
    // Only allow up to 15 per team/format for this user
    const checkCount = await pool.query(
      `SELECT COUNT(*) FROM players WHERE team_name = $1 AND lineup_type = $2 AND user_id = $3`,
      [team_name, lineup_type, user_id]
    );
    if (parseInt(checkCount.rows[0].count) >= 15) {
      return res.status(400).json({ error: "Cannot add more than 15 players to this squad." });
    }
    // Insert for this user only
    const result = await pool.query(
      `INSERT INTO players 
        (lineup_type, player_name, team_name, skill_type, bowling_type, batting_style, is_captain, is_vice_captain, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [lineup_type, player_name, team_name, skill_type, bowling_type, batting_style, is_captain, is_vice_captain, user_id]
    );
    res.json({ message: "Player added successfully", player: result.rows[0] });
  } catch (err) {
    console.error("Add Player Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET ALL PLAYERS
 * Now ALWAYS requires user_id and only returns current user's players
 */
router.get("/players", async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: "User ID is required." });
    const query = `SELECT * FROM players WHERE user_id = $1 ORDER BY id DESC`;
    const result = await pool.query(query, [user_id]);
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch Players Error:", err.message);
    res.status(500).json({ error: "Failed to fetch players" });
  }
});

/**
 * ADD PLAYER PERFORMANCE
 * Only allows adding performance for user's own player
 */
router.post("/player-performance", async (req, res) => {
  const {
    match_name,
    player_id,
    team_name,
    match_type,
    against_team,
    run_scored,
    balls_faced,
    wickets_taken,
    runs_given,
    fifties,
    hundreds,
    dismissed,
    user_id // REQUIRED!
  } = req.body;
  try {
    if (!player_id || !team_name || !match_type || !against_team || !user_id) {
      return res.status(400).json({ message: "⚠️ Missing required fields (must include user_id)." });
    }
    // Only allow if player belongs to this user
    const playerCheck = await pool.query(
      `SELECT * FROM players WHERE id = $1 AND user_id = $2`,
      [player_id, user_id]
    );
    if (playerCheck.rows.length === 0) {
      return res.status(404).json({ message: "❌ Player not found or does not belong to current user." });
    }
    const insertResult = await pool.query(
      `INSERT INTO player_performance 
        (match_name, player_id, team_name, match_type, against_team, run_scored, balls_faced, wickets_taken, runs_given, fifties, hundreds, dismissed)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
      [
        match_name,
        player_id,
        team_name,
        match_type,
        against_team,
        run_scored,
        balls_faced,
        wickets_taken,
        runs_given,
        fifties,
        hundreds,
        dismissed
      ]
    );
    res.status(201).json({
      message: "✅ Player performance saved successfully.",
      data: insertResult.rows[0]
    });
  } catch (err) {
    console.error("❌ Server error while saving performance:", err);
    res.status(500).json({ message: "❌ Server error occurred." });
  }
});

/**
 * UPDATE PLAYER BY ID (User only updates their own player)
 */
router.put('/players/:id', async (req, res) => {
  const { id } = req.params;
  const {
    player_name, team_name, lineup_type,
    skill_type, bowling_type, batting_style,
    is_captain, is_vice_captain,
    user_id // Must be sent
  } = req.body;

  if (!user_id) return res.status(400).json({ error: "User ID is required." });

  try {
    // Only update if belongs to user
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
      WHERE id = $9 AND user_id = $10
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [
      player_name, team_name, lineup_type,
      skill_type, bowling_type, batting_style,
      is_captain, is_vice_captain, id, user_id
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Player not found or does not belong to user." });
    }
    res.json({ message: "Player updated successfully", player: result.rows[0] });
  } catch (err) {
    console.error("Update Player Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE PLAYER (User can only delete their own player)
 */
router.delete("/delete-player/:id", async (req, res) => {
  const playerId = req.params.id;
  const { user_id } = req.query; // For deletes, use query param
  if (!user_id) return res.status(400).json({ error: "User ID is required." });
  try {
    const result = await pool.query(
      "DELETE FROM players WHERE id = $1 AND user_id = $2 RETURNING *",
      [playerId, user_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Player not found or does not belong to user." });
    }
    res.json({ message: "Player deleted successfully" });
  } catch (err) {
    console.error("Delete Player Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * UPDATE PLAYER (Admin or user can only update their own player)
 */
router.put("/update-player", async (req, res) => {
  const {
    id,
    player_name,
    team_name,
    skill_type,
    lineup_type,
    user_id
  } = req.body;
  if (!user_id) return res.status(400).json({ error: "User ID is required." });

  try {
    const result = await pool.query(
      `UPDATE players 
       SET player_name = $1, team_name = $2, skill_type = $3, lineup_type = $4
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [player_name, team_name, skill_type, lineup_type, id, user_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Player not found or does not belong to user." });
    }
    res.json({ message: "Player updated", player: result.rows[0] });
  } catch (err) {
    console.error("Update Player Error:", err);
    res.status(500).json({ error: "Failed to update player" });
  }
});

/**
 * PLAYER PERFORMANCE/PLAYER STATS - All stats filtered for current user's players only!
 */
router.get("/player-stats", async (req, res) => {
  try {
    const { playerName, teamName, matchType, user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: "User ID is required." });

    let baseQuery = `
      SELECT 
        pp.*, 
        p.player_name,
        pp.balls_faced,
        ROUND(CASE WHEN pp.balls_faced > 0 THEN (pp.run_scored::decimal / pp.balls_faced) * 100 ELSE 0 END, 2) AS strike_rate,
        MAX(
          CASE WHEN LOWER(pp.dismissed) = 'not out' THEN pp.run_scored ELSE pp.run_scored END
        ) OVER (PARTITION BY pp.player_id, pp.match_type) AS highest_score,
        CASE
          WHEN LOWER(pp.dismissed) = 'not out' THEN CONCAT(pp.run_scored, '*')
          ELSE pp.run_scored::text
        END AS formatted_run_scored
      FROM player_performance pp
      JOIN players p ON pp.player_id = p.id
      WHERE p.user_id = $1
    `;
    const queryParams = [user_id];

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

/**
 * PLAYER STATS SUMMARY - Only current user's players
 */
router.get("/player-stats-summary", async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: "User ID is required." });

    const result = await pool.query(`
      SELECT 
        pp.id,
        p.player_name,
        p.team_name,
        pp.match_type,
        pp.match_name,
        pp.against_team,
        pp.run_scored,
        pp.balls_faced,
        pp.wickets_taken,
        pp.runs_given,
        pp.fifties,
        pp.hundreds,
        pp.dismissed AS dismissed_status,
        ROUND(CASE 
          WHEN pp.balls_faced > 0 THEN (pp.run_scored::decimal / pp.balls_faced) * 100 
          ELSE 0 
        END, 2) AS strike_rate,
        MAX(
          CASE 
            WHEN LOWER(pp.dismissed) = 'not out' THEN pp.run_scored 
            ELSE pp.run_scored 
          END
        ) OVER (PARTITION BY pp.player_id, pp.match_type) AS highest_score,
        CASE 
          WHEN LOWER(pp.dismissed) = 'not out' THEN CONCAT(pp.run_scored, '*')
          ELSE pp.run_scored::text
        END AS formatted_run_scored,
        COUNT(*) OVER (PARTITION BY pp.player_id) AS total_matches,
        COUNT(*) OVER (PARTITION BY pp.player_id, pp.match_type) AS match_count
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE p.user_id = $1
      ORDER BY pp.player_id, pp.id;
    `, [user_id]);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching player stats summary:", err);
    res.status(500).json({ error: "Server error occurred while fetching stats." });
  }
});

/**
 * PLAYER MATCHES for floating popup (user’s own players only)
 */
router.get("/player-matches/:playerName", async (req, res) => {
  const { playerName } = req.params;
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: "User ID is required." });

  try {
    const result = await pool.query(`
      SELECT 
        pp.*,
        p.player_name,
        p.team_name,
        pp.against_team,
        pp.dismissed,
        ROUND(CASE WHEN pp.balls_faced > 0 THEN (pp.run_scored::decimal / pp.balls_faced) * 100 ELSE 0 END, 2) AS strike_rate,
        CASE
          WHEN LOWER(pp.dismissed) = 'not out' THEN CONCAT(pp.run_scored, '*')
          ELSE pp.run_scored::text
        END AS formatted_run_scored,
        TO_CHAR(pp.created_at, 'YYYY-MM-DD') AS match_display_date,
        TRIM(TO_CHAR(pp.created_at, 'FMDay')) AS match_display_day,
        TRIM(TO_CHAR(pp.created_at, 'HH12:MI AM')) AS match_display_time
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE LOWER(p.player_name) = LOWER($1) AND p.user_id = $2
      ORDER BY pp.created_at DESC;
    `, [playerName, user_id]);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching player match stats:", err);
    res.status(500).json({ error: "Server error occurred while fetching match data." });
  }
});

module.exports = router;
