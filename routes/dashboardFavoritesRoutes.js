// routes/dashboardFavoritesRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // update if your db.js path is different

// GET: All favorites for a user (teams + players, detailed info)
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const result = await pool.query(`
      SELECT 
        uf.id, uf.type, uf.ref_id, uf.created_at,
        CASE 
          WHEN uf.type = 'team' THEN t.name
          WHEN uf.type = 'player' THEN p.player_name
          ELSE NULL
        END as name,
        CASE 
          WHEN uf.type = 'team' THEN t.name  -- Use name for frontend flag mapping
          WHEN uf.type = 'player' THEN p.player_name -- Use player name for frontend avatar mapping
          ELSE NULL
        END as image_ref
      FROM user_favorites uf
      LEFT JOIN teams t ON uf.type = 'team' AND uf.ref_id = t.id
      LEFT JOIN players p ON uf.type = 'player' AND uf.ref_id = p.id
      WHERE uf.user_id = $1
      ORDER BY uf.created_at DESC
    `, [userId]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch favorites", details: err.message });
  }
});

// POST: Add a favorite
router.post("/", async (req, res) => {
  try {
    const { userId, type, refId } = req.body;
    if (!userId || !type || !refId) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    // Check if already exists
    const exists = await pool.query(
      "SELECT 1 FROM user_favorites WHERE user_id = $1 AND type = $2 AND ref_id = $3",
      [userId, type, refId]
    );
    if (exists.rowCount > 0) {
      return res.status(409).json({ error: "Already in favorites" });
    }
    await pool.query(
      "INSERT INTO user_favorites (user_id, type, ref_id) VALUES ($1, $2, $3)",
      [userId, type, refId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to add favorite", details: err.message });
  }
});

// DELETE: Remove a favorite (by favorite id)
router.delete("/:favoriteId", async (req, res) => {
  try {
    const { userId } = req.body; // For extra security (user should match)
    const { favoriteId } = req.params;
    if (!favoriteId) return res.status(400).json({ error: "Missing favoriteId" });
    // Optionally check userId as well
    await pool.query(
      "DELETE FROM user_favorites WHERE id = $1",
      [favoriteId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove favorite", details: err.message });
  }
});

module.exports = router;
