const express = require("express");
const router = express.Router();
const pool = require("../db");
const { v4: uuidv4 } = require("uuid");

// 📌 Email validation helper
const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ✅ 🔐 Admin-only middleware
const adminOnly = (req, res, next) => {
  if (!req.admin || req.admin.role !== "admin") {  // changes to admin 08/08/2025
    return res.status(403).json({ error: "Access denied. Admins only." });
  }
  next();
};

/**
 * ✅ API 1: Register a New Board
 */
router.post("/register", async (req, res) => {
  try {
    const {
      board_name,
      owner_name,
      registration_date,
      owner_email,
      teams,
    } = req.body;

    if (
      !board_name ||
      !owner_name ||
      !registration_date ||
      !owner_email ||
      !Array.isArray(teams) ||
      teams.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "All fields and at least one team are required." });
    }

    if (!isValidEmail(owner_email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    const now = new Date();
    const regDate = new Date(registration_date);
    if (regDate < now.setHours(0, 0, 0, 0)) {
      return res
        .status(400)
        .json({ error: "Registration date must be today or in the future." });
    }

    const registration_id = uuidv4();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const insertBoard = `
        INSERT INTO board_registration (registration_id, board_name, owner_name, registration_date, owner_email)
        VALUES ($1, $2, $3, $4, $5)
      `;
      await client.query(insertBoard, [
        registration_id,
        board_name,
        owner_name,
        registration_date,
        owner_email,
      ]);

      const insertTeam = `
        INSERT INTO board_teams (registration_id, team_name)
        VALUES ($1, $2)
      `;
      for (const team of teams) {
        await client.query(insertTeam, [registration_id, team]);
      }

      await client.query("COMMIT");
      res.status(201).json({
        message: "Board registered successfully.",
        registration_id,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Transaction error:", err);
      res.status(500).json({ error: "Error during registration." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * ✅ API 2: Get All Boards with Their Teams
 */
router.get("/all", async (req, res) => {
  try {
    const query = `
      SELECT 
        br.*,
        ARRAY_AGG(bt.team_name) AS teams
      FROM board_registration br
      LEFT JOIN board_teams bt ON br.registration_id = bt.registration_id
      GROUP BY br.id
      ORDER BY br.registration_date DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Fetch boards error:", err);
    res.status(500).json({ error: "Failed to fetch boards." });
  }
});

/**
 * ✅ API 3: Update Board Info (Admin Only)
 */
router.put("/update/:registration_id", adminOnly, async (req, res) => {
  try {
    const { registration_id } = req.params;
    const {
      board_name,
      owner_name,
      registration_date,
      owner_email,
      teams,
    } = req.body;

    if (
      !board_name ||
      !owner_name ||
      !registration_date ||
      !owner_email ||
      !Array.isArray(teams) ||
      teams.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "All fields and at least one team are required." });
    }

    if (!isValidEmail(owner_email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const updateBoard = `
        UPDATE board_registration
        SET board_name = $1,
            owner_name = $2,
            registration_date = $3,
            owner_email = $4
        WHERE registration_id = $5
      `;
      await client.query(updateBoard, [
        board_name,
        owner_name,
        registration_date,
        owner_email,
        registration_id,
      ]);

      await client.query(
        "DELETE FROM board_teams WHERE registration_id = $1",
        [registration_id]
      );

      const insertTeam = `
        INSERT INTO board_teams (registration_id, team_name)
        VALUES ($1, $2)
      `;
      for (const team of teams) {
        await client.query(insertTeam, [registration_id, team]);
      }

      await client.query("COMMIT");
      res.status(200).json({ message: "Board updated successfully." });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Update transaction failed:", err);
      res.status(500).json({ error: "Error updating board." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * ✅ API 4: Delete Board + Its Teams (Admin Only)
 */
router.delete("/delete/:registration_id", adminOnly, async (req, res) => {
  try {
    const { registration_id } = req.params;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        "DELETE FROM board_teams WHERE registration_id = $1",
        [registration_id]
      );

      await client.query(
        "DELETE FROM board_registration WHERE registration_id = $1",
        [registration_id]
      );

      await client.query("COMMIT");
      res.status(200).json({ message: "Board deleted successfully." });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Delete transaction failed:", err);
      res.status(500).json({ error: "Failed to delete board." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * ✅ API 5: Get All Boards (Optimized)
 */
router.get("/all-boards", async (req, res) => {
  try {
    const client = await pool.connect();

    const result = await client.query(`
      SELECT 
        br.registration_id,
        br.board_name,
        br.owner_name,
        TO_CHAR(br.registration_date, 'YYYY-MM-DD') AS registration_date,
        br.owner_email,
        ARRAY_AGG(bt.team_name) AS teams
      FROM board_registration br
      LEFT JOIN board_teams bt ON br.registration_id = bt.registration_id
      GROUP BY br.registration_id, br.board_name, br.owner_name, br.registration_date, br.owner_email
      ORDER BY br.registration_date DESC
    `);

    client.release();

    res.status(200).json({
      boards: result.rows
    });
  } catch (error) {
    console.error("Error fetching boards:", error);
    res.status(500).json({ error: "Error fetching boards." });
  }
});

module.exports = router;
