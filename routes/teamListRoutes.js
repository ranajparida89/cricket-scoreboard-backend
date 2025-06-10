// routes/teamListRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/user-teams', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT name
      FROM teams
      ORDER BY name
    `;
    const { rows } = await pool.query(query);
    res.json({ teams: rows.map(r => r.name) });
  } catch (err) {
    console.error("Error in /user-teams:", err); // <--- This will help you debug in logs!
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
