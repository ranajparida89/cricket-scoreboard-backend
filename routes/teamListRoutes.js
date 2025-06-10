// routes/teamListRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/user-teams', async (req, res) => {
  try {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: "user_id is required" });

    const query = `
      SELECT DISTINCT name
      FROM teams
      WHERE user_id = $1
      ORDER BY name
    `;
    const { rows } = await pool.query(query, [userId]);
    res.json({ teams: rows.map(r => r.name) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
