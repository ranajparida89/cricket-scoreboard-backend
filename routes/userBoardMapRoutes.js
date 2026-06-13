const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Get users without board + boards without user
router.get("/pending", async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT id, first_name, last_name, email, board_id
      FROM public.users
      WHERE board_id IS NULL
      ORDER BY id DESC
    `);

    const boards = await pool.query(`
      SELECT id, board_name, owner_name, owner_email, user_id
      FROM public.board_registration
      WHERE user_id IS NULL
      ORDER BY id DESC
    `);

    res.json({
      users: users.rows,
      boards: boards.rows
    });
  } catch (err) {
    console.error("Pending mapping error:", err);
    res.status(500).json({ error: "Failed to load pending mapping" });
  }
});

// ✅ Map selected user with selected board
router.post("/map", async (req, res) => {
  console.log("MAP BODY:", req.body);

  const user_id = req.body.user_id || req.body.userId;
  const board_id = req.body.board_id || req.body.boardId;

  if (!user_id || !board_id) {
    return res.status(400).json({
      error: "user_id and board_id required",
      received_body: req.body
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userRes = await client.query(
      `
      SELECT id, email
      FROM public.users
      WHERE id = $1
      `,
      [user_id]
    );

    if (userRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    const boardRes = await client.query(
      `
      SELECT id, board_name
      FROM public.board_registration
      WHERE id = $1
      `,
      [board_id]
    );

    if (boardRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Board not found" });
    }

    const userEmail = userRes.rows[0].email;

    await client.query(
      `
      UPDATE public.board_registration
      SET user_id = $1,
          owner_email = $2
      WHERE id = $3
      `,
      [user_id, userEmail, board_id]
    );

    await client.query(
      `
      UPDATE public.users
      SET board_id = $1
      WHERE id = $2
      `,
      [board_id, user_id]
    );

    await client.query("COMMIT");

    res.json({
      message: "User and board mapped successfully",
      user_id,
      board_id,
      owner_email: userEmail
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Map user board error:", err);
    res.status(500).json({ error: "Mapping failed" });
  } finally {
    client.release();
  }
});

module.exports = router;