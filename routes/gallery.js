const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db');

// Storage config (local folder 'uploads/')
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'uploads/'); },
  filename: function (req, file, cb) {
    const ext = file.originalname.split('.').pop();
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
  }
});
const upload = multer({ storage });

// Middleware to get user info from session/token/localStorage etc.
function requireAuth(req, res, next) {
  // This is pseudo code! You must adjust for your auth
  const user = req.user || req.body.user || null;
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.currentUser = user;
  next();
}

// Upload endpoint
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const { comment, user_id, user_name } = req.body;
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const imageUrl = `/uploads/${req.file.filename}`;
    const result = await pool.query(
      `INSERT INTO gallery_images (image_url, uploaded_by, uploaded_by_name, comment)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [imageUrl, user_id, user_name, comment]
    );
    res.json({ image: result.rows[0] });
  } catch (err) {
    console.error('UPLOAD ERROR:', err);
    res.status(500).json({ error: "Server error." });
  }
});

// List all images
router.get('/list', async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM gallery_images ORDER BY uploaded_at DESC`
  );
  res.json({ images: result.rows });
});

// Delete (only uploader can delete)
router.delete('/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  const user_id = req.currentUser.id;
  const img = await pool.query(`SELECT * FROM gallery_images WHERE id=$1`, [id]);
  if (!img.rows.length) return res.status(404).json({ error: "Not found" });
  if (img.rows[0].uploaded_by !== user_id)
    return res.status(403).json({ error: "You can't delete this photo." });
  await pool.query(`DELETE FROM gallery_images WHERE id=$1`, [id]);
  res.json({ success: true });
});

module.exports = router;
