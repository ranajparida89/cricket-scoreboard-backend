const express = require("express");
const router = express.Router();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

/* =====================================================
   HEALTH CHECK
===================================================== */
router.get("/health", async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      message: "Player Achievement API is working",
    });
  } catch (err) {
    console.error("Health Check Error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/* =====================================================
   GET ALL ACHIEVEMENT MASTER RECORDS
===================================================== */
router.get("/master", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM achievement_master
      WHERE is_active = TRUE
      ORDER BY achievement_category, achievement_name
    `);

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    console.error("Master Fetch Error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/* =====================================================
   GET ACHIEVEMENTS BY CATEGORY
===================================================== */
router.get("/master/:category", async (req, res) => {
  try {
    const { category } = req.params;

    const result = await pool.query(
      `
      SELECT *
      FROM achievement_master
      WHERE is_active = TRUE
      AND LOWER(achievement_category)=LOWER($1)
      ORDER BY achievement_name
      `,
      [category]
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    console.error("Category Fetch Error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;