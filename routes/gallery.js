// routes/gallery.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db');
const fs = require('fs');
const path = require('path');

// Ensure upload dir exists
const uploadPath = path.join(__dirname, '..', 'uploads', 'gallery');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// Multer config: limit size & check file type (images only)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Keep unique filenames
    const ext = file.originalname.split('.').pop();
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
  }
});
function fileFilter(req, file, cb) {
  if (!file.mimetype.startsWith('image/')) return cb(new Error('File must be an image.'), false);
  cb(null, true);
}
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB max
});

// Basic auth middleware (not secure for production, demo only)
function requireAuth(req, res, next) {
  // In production, use JWT/session/etc.
  const user = req.body.user_id ? { id: Number(req.body.user_id), name: req.body.user_name } : null;
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.currentUser = user;
  next();
}

// Upload endpoint
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const { comment, user_id, user_name } = req.body;
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const imageUrl = `/uploads/gallery/${req.file.filename}`;
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

// Delete photo (only uploader can delete)
router.delete('/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  const user_id = req.currentUser.id;
  const img = await pool.query(`SELECT * FROM gallery_images WHERE id=$1`, [id]);
  if (!img.rows.length) return res.status(404).json({ error: "Not found" });
  if (img.rows[0].uploaded_by !== user_id)
    return res.status(403).json({ error: "You can't delete this photo." });
  // Remove file from disk (optional)
  const filePath = path.join(uploadPath, path.basename(img.rows[0].image_url));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await pool.query(`DELETE FROM gallery_images WHERE id=$1`, [id]);
  res.json({ success: true });
});

module.exports = router;
