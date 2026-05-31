const express = require("express");
const router = express.Router();
const pool = require("../db");

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
      error: err.message,
    });
  }
});

/* =====================================================
   DATABASE TEST
===================================================== */
router.get("/master-test", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) FROM achievement_master"
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("Master Test Error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
      detail: err.detail,
      code: err.code,
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
      detail: err.detail,
      code: err.code,
      stack: err.stack,
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
      AND LOWER(achievement_category) = LOWER($1)
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
      detail: err.detail,
      code: err.code,
      stack: err.stack,
    });
  }
});

/* =====================================================
   REGISTER PLAYER ACHIEVEMENT
===================================================== */
router.post("/register", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      match_type,
      match_name,
      board_name,
      team_name,
      player_name,
      achievement_category,
      achievement_name,
      achievement_date,
      innings_type,

      runs_scored,
      balls_faced,
      fours,
      sixes,

      wickets,
      runs_conceded,
      overs_bowled,

      consecutive_wickets,
      balls_for_wickets,

      catches,
      stumpings,
      run_outs,

      remarks,
      created_by,
    } = req.body;

    /* ==========================
       VALIDATION
    ========================== */

    const requiredFields = [
      "match_type",
      "match_name",
      "board_name",
      "team_name",
      "player_name",
      "achievement_category",
      "achievement_name",
      "achievement_date",
    ];

    const missingFields = [];

    requiredFields.forEach((field) => {
      if (!req.body[field]) {
        missingFields.push(field);
      }
    });

    if (missingFields.length > 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        missingFields,
      });
    }

    /* ==========================
       DUPLICATE CHECK
    ========================== */

    const duplicateCheck = await client.query(
      `
      SELECT id
      FROM player_achievements
      WHERE LOWER(player_name)=LOWER($1)
      AND LOWER(match_name)=LOWER($2)
      AND LOWER(achievement_name)=LOWER($3)
      AND achievement_date=$4
      LIMIT 1
      `,
      [
        player_name,
        match_name,
        achievement_name,
        achievement_date,
      ]
    );

    if (duplicateCheck.rows.length > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        message:
          "Duplicate achievement already exists for this player in this match.",
      });
    }

    /* ==========================
       FETCH MASTER DATA
    ========================== */

    const masterResult = await client.query(
      `
      SELECT *
      FROM achievement_master
      WHERE achievement_name = $1
      AND is_active = TRUE
      LIMIT 1
      `,
      [achievement_name]
    );

    if (masterResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Achievement not found in achievement_master.",
      });
    }

    const master = masterResult.rows[0];

    const achievement_points = master.points || 0;
    const rarity_level = master.rarity_level || "Common";

    /* ==========================
       GENERATE ACHIEVEMENT ID
    ========================== */

    const year = new Date().getFullYear();

    const countResult = await client.query(
      `
      SELECT COUNT(*) AS total
      FROM player_achievements
      `
    );

    const nextNumber =
      parseInt(countResult.rows[0].total || 0) + 1;

    const achievement_id =
      `PA-${year}-${String(nextNumber).padStart(6, "0")}`;

    /* ==========================
       INSERT RECORD
    ========================== */

    const insertResult = await client.query(
      `
      INSERT INTO player_achievements
      (
        achievement_id,

        match_type,
        match_name,

        board_name,
        team_name,

        player_name,

        achievement_category,
        achievement_name,

        achievement_date,

        innings_type,

        runs_scored,
        balls_faced,
        fours,
        sixes,

        wickets,
        runs_conceded,
        overs_bowled,

        consecutive_wickets,
        balls_for_wickets,

        catches,
        stumpings,
        run_outs,

        achievement_points,
        rarity_level,

        remarks,
        created_by
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,
        $18,$19,$20,$21,$22,
        $23,$24,$25,$26
      )
      RETURNING *
      `,
      [
        achievement_id,

        match_type,
        match_name,

        board_name,
        team_name,

        player_name,

        achievement_category,
        achievement_name,

        achievement_date,

        innings_type || null,

        runs_scored || 0,
        balls_faced || 0,
        fours || 0,
        sixes || 0,

        wickets || 0,
        runs_conceded || 0,
        overs_bowled || null,

        consecutive_wickets || 0,
        balls_for_wickets || 0,

        catches || 0,
        stumpings || 0,
        run_outs || 0,

        achievement_points,
        rarity_level,

        remarks || null,
        created_by || "System",
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Achievement registered successfully.",
      achievement: insertResult.rows[0],
    });

  } catch (err) {
    await client.query("ROLLBACK");

    console.error("Achievement Register Error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
      detail: err.detail,
      code: err.code,
    });
  } finally {
    client.release();
  }
});

/* =====================================================
   GET ALL ACHIEVEMENTS
===================================================== */
router.get("/all", async (req, res) => {
  try {
    const {
      playerName,
      matchType,
      achievement,
      category,
      status,
      rarity,
      page = 1,
      limit = 20,
    } = req.query;

    const conditions = [];
    const values = [];
    let idx = 1;

    if (playerName) {
      conditions.push(`LOWER(player_name) LIKE LOWER($${idx})`);
      values.push(`%${playerName}%`);
      idx++;
    }

    if (matchType) {
      conditions.push(`LOWER(match_type)=LOWER($${idx})`);
      values.push(matchType);
      idx++;
    }

    if (achievement) {
      conditions.push(`LOWER(achievement_name) LIKE LOWER($${idx})`);
      values.push(`%${achievement}%`);
      idx++;
    }

    if (category) {
      conditions.push(`LOWER(achievement_category)=LOWER($${idx})`);
      values.push(category);
      idx++;
    }

    if (status) {
      conditions.push(`LOWER(status)=LOWER($${idx})`);
      values.push(status);
      idx++;
    }

    if (rarity) {
      conditions.push(`LOWER(rarity_level)=LOWER($${idx})`);
      values.push(rarity);
      idx++;
    }

    const whereClause =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const offset =
      (parseInt(page) - 1) * parseInt(limit);

    const totalQuery = `
      SELECT COUNT(*) AS total
      FROM player_achievements
      ${whereClause}
    `;

    const totalResult = await pool.query(
      totalQuery,
      values
    );

    const dataQuery = `
      SELECT *
      FROM player_achievements
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx}
      OFFSET $${idx + 1}
    `;

    const dataResult = await pool.query(
      dataQuery,
      [
        ...values,
        parseInt(limit),
        parseInt(offset),
      ]
    );

    res.status(200).json({
      success: true,

      totalRecords:
        parseInt(totalResult.rows[0].total),

      currentPage:
        parseInt(page),

      pageSize:
        parseInt(limit),

      totalPages:
        Math.ceil(
          parseInt(totalResult.rows[0].total) /
          parseInt(limit)
        ),

      data: dataResult.rows,
    });

  } catch (err) {
    console.error(
      "Get All Achievements Error:",
      err
    );

    res.status(500).json({
      success: false,
      message: err.message,
      detail: err.detail,
      code: err.code,
    });
  }
});

module.exports = router;