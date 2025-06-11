// routes/teamListRoutes.js
// Last Modified: 12-June-2025 by Ranaj Parida (user_id automation for teams)

const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * Get all user teams for dropdown (optionally filter by user_id)
 * - If user_id is given, only teams belonging to that user are returned.
 * - Otherwise, returns all teams.
 */
router.get('/user-teams', async (req, res) => {
  try {
    const { user_id } = req.query;
    let query = `
      SELECT DISTINCT name
      FROM teams
    `;
    let params = [];
    if (user_id) {
      query += ` WHERE user_id = $1`;
      params.push(user_id);
    }
    query += ` ORDER BY name`;
    const { rows } = await pool.query(query, params);
    res.json({ teams: rows.map(r => r.name) });
  } catch (err) {
    console.error("Error in /user-teams:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Add a new team (always requires user_id)
 */
router.post('/add-team', async (req, res) => {
  const { name, user_id } = req.body;
  if (!name || !user_id) {
    return res.status(400).json({ error: "Team name and user_id required" });
  }
  try {
    // Prevent duplicate team names per user
    const exists = await pool.query(
      `SELECT * FROM teams WHERE name = $1 AND user_id = $2`,
      [name, user_id]
    );
    if (exists.rows.length > 0) {
      return res.status(400).json({ error: "Team name already exists for this user" });
    }
    const result = await pool.query(
      `INSERT INTO teams (name, user_id) VALUES ($1, $2) RETURNING *`,
      [name, user_id]
    );
    res.status(201).json({ message: "Team created", team: result.rows[0] });
  } catch (err) {
    console.error("Add Team Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
