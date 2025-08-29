// routes/boardRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { v4: uuidv4 } = require("uuid");

/* ---------------- Helpers ---------------- */
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");

const adminOnly = (req, res, next) => {
  const tokenAdmin =
    req.admin &&
    (req.admin.role === "admin" ||
      req.admin.is_super_admin === true ||
      req.admin.isAdmin === true);

  const sessionAdmin =
    req.user &&
    (req.user.role === "admin" || req.user.isAdmin === true);

  if (!tokenAdmin && !sessionAdmin) {
    return res.status(403).json({ error: "Access denied. Admins only." });
  }
  next();
};

function sanitizeTeams(teams) {
  if (!Array.isArray(teams)) return [];
  const seen = new Set();
  const out = [];
  for (const t of teams) {
    const s = String(t || "").trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// Parse DD-MM-YYYY or YYYY-MM-DD → YYYY-MM-DD
function toIsoDateString(input) {
  if (!input) return null;
  const s = String(input).trim();
  const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm}-${dd}`;
  }
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return s;
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}
function startOfToday() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/* ---------------------------------------------
 * Register a New Board (OPEN)
 * --------------------------------------------- */
router.post("/register", async (req, res) => {
  try {
    if (!req.body) return res.status(400).json({ error: "Missing request body." });

    let { board_name, owner_name, registration_date, owner_email, teams } = req.body;

    board_name = String(board_name || "").trim();
    owner_name = String(owner_name || "").trim();
    owner_email = String(owner_email || "").trim().toLowerCase();
    teams = sanitizeTeams(teams);

    if (!board_name || !owner_name || !registration_date || !owner_email) {
      return res.status(400).json({ error: "All fields are required." });
    }
    if (!Array.isArray(teams) || teams.length === 0) {
      return res.status(400).json({ error: "At least one team is required." });
    }
    if (!isValidEmail(owner_email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    const isoDate = toIsoDateString(registration_date);
    if (!isoDate) {
      return res.status(400).json({ error: "Invalid registration date. Use DD-MM-YYYY or YYYY-MM-DD." });
    }
    const regDateObj = new Date(isoDate);
    if (regDateObj < startOfToday()) {
      return res.status(400).json({ error: "Registration date must be today or in the future." });
    }

    const registration_id = uuidv4();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Insert board and return both id (int) and registration_id (uuid)
      const insertBoard = `
        INSERT INTO board_registration (registration_id, board_name, owner_name, registration_date, owner_email)
        VALUES ($1, $2, $3, to_date($4,'YYYY-MM-DD'), $5)
        RETURNING id, registration_id
      `;
      const ins = await client.query(insertBoard, [
        registration_id,
        board_name,
        owner_name,
        isoDate,
        owner_email,
      ]);
      const br = ins.rows[0];

      // ✅ Insert teams with BOTH keys to satisfy NOT NULL(board_id)
      const insertTeam = `
        INSERT INTO board_teams (board_id, registration_id, team_name)
        VALUES ($1, $2, $3)
      `;
      for (const team of teams) {
        await client.query(insertTeam, [br.id, br.registration_id, team]);
      }

      await client.query("COMMIT");
      return res.status(201).json({
        message: "Board registered successfully.",
        registration_id: br.registration_id,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Transaction error (register):", {
        code: err.code,
        message: err.message,
        detail: err.detail,
        constraint: err.constraint,
      });

      if (err.code === "23505") {
        if ((err.constraint || "").includes("board_registration_board_name_key"))
          return res.status(409).json({ error: "Board name already exists." });
        if ((err.constraint || "").includes("board_registration_owner_email_key"))
          return res.status(409).json({ error: "Owner email already used." });
        return res.status(409).json({ error: "Duplicate data violates a unique constraint." });
      }
      if (err.code === "23502") // not_null_violation
        return res.status(400).json({ error: "Missing required data (likely board_id on board_teams)." });
      if (err.code === "22P02")
        return res.status(400).json({ error: "Bad value for one of the fields (check date/UUID formats)." });
      if (err.code === "42804")
        return res.status(400).json({ error: "Data type mismatch." });

      return res.status(500).json({ error: "Error during registration." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error (register):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ---------------------------------------------
 * Get All Boards with Their Teams (legacy)
 * --------------------------------------------- */
router.get("/all", async (req, res) => {
  try {
    const query = `
      SELECT 
        br.id,
        br.registration_id,
        br.board_name,
        br.owner_name,
        br.registration_date,
        br.owner_email,
        ARRAY_REMOVE(ARRAY_AGG(bt.team_name), NULL) AS teams
      FROM board_registration br
      LEFT JOIN board_teams bt 
        ON (bt.registration_id = br.registration_id OR bt.board_id = br.id)
      GROUP BY br.id, br.registration_id, br.board_name, br.owner_name, br.registration_date, br.owner_email
      ORDER BY br.registration_date DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Fetch boards error (/all):", err);
    res.status(500).json({ error: "Failed to fetch boards." });
  }
});

/* ---------------------------------------------
 * Update Board (ADMIN ONLY) — replaces teams
 * --------------------------------------------- */
router.put("/update/:registration_id", adminOnly, async (req, res) => {
  try {
    const { registration_id } = req.params;
    let { board_name, owner_name, registration_date, owner_email, teams } = req.body;

    board_name = String(board_name || "").trim();
    owner_name = String(owner_name || "").trim();
    owner_email = String(owner_email || "").trim().toLowerCase();
    teams = sanitizeTeams(teams);

    if (!board_name || !owner_name || !registration_date || !owner_email) {
      return res.status(400).json({ error: "All fields are required." });
    }
    if (!Array.isArray(teams)) {
      return res.status(400).json({ error: "Teams must be an array." });
    }
    if (!isValidEmail(owner_email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    const isoDate = toIsoDateString(registration_date);
    if (!isoDate) {
      return res.status(400).json({ error: "Invalid registration date. Use DD-MM-YYYY or YYYY-MM-DD." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Get board numeric id + uuid
      const getBoard = await client.query(
        "SELECT id, registration_id FROM board_registration WHERE registration_id = $1",
        [registration_id]
      );
      if (getBoard.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Board not found." });
      }
      const br = getBoard.rows[0];

      await client.query(
        `
          UPDATE board_registration
          SET board_name = $1,
              owner_name = $2,
              registration_date = to_date($3,'YYYY-MM-DD'),
              owner_email = $4
          WHERE registration_id = $5
        `,
        [board_name, owner_name, isoDate, owner_email, registration_id]
      );

      // Delete by either key (covers any historical rows)
      await client.query(
        "DELETE FROM board_teams WHERE board_id = $1 OR registration_id = $2",
        [br.id, br.registration_id]
      );

      if (teams.length > 0) {
        const insertTeam = `
          INSERT INTO board_teams (board_id, registration_id, team_name)
          VALUES ($1, $2, $3)
        `;
        for (const team of teams) {
          await client.query(insertTeam, [br.id, br.registration_id, team]);
        }
      }

      await client.query("COMMIT");
      res.status(200).json({ message: "Board updated successfully." });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Update transaction failed:", {
        code: err.code,
        message: err.message,
        detail: err.detail,
        constraint: err.constraint,
      });

      if (err.code === "23505")
        return res.status(409).json({ error: "Duplicate value violates a unique constraint." });
      if (err.code === "23502")
        return res.status(400).json({ error: "Missing required data (likely board_id on board_teams)." });
      if (err.code === "22P02")
        return res.status(400).json({ error: "Bad value for one of the fields." });
      if (err.code === "42804")
        return res.status(400).json({ error: "Data type mismatch." });

      res.status(500).json({ error: "Error updating board." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error (update):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ---------------------------------------------
 * Delete Board (ADMIN ONLY)
 * --------------------------------------------- */
router.delete("/delete/:registration_id", adminOnly, async (req, res) => {
  try {
    const { registration_id } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const getBoard = await client.query(
        "SELECT id, registration_id FROM board_registration WHERE registration_id = $1",
        [registration_id]
      );
      if (getBoard.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Board not found." });
      }
      const br = getBoard.rows[0];

      await client.query(
        "DELETE FROM board_teams WHERE board_id = $1 OR registration_id = $2",
        [br.id, br.registration_id]
      );
      await client.query(
        "DELETE FROM board_registration WHERE registration_id = $1",
        [registration_id]
      );

      await client.query("COMMIT");
      res.status(200).json({ message: "Board deleted successfully." });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Delete transaction failed:", {
        code: err.code,
        message: err.message,
        detail: err.detail,
        constraint: err.constraint,
      });
      res.status(500).json({ error: "Failed to delete board." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error (delete):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ---------------------------------------------
 * Get All Boards (clean)
 * --------------------------------------------- */
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
        ARRAY_REMOVE(ARRAY_AGG(bt.team_name), NULL) AS teams
      FROM board_registration br
      LEFT JOIN board_teams bt 
        ON (bt.registration_id = br.registration_id OR bt.board_id = br.id)
      GROUP BY br.registration_id, br.board_name, br.owner_name, br.registration_date, br.owner_email
      ORDER BY br.registration_date DESC
    `);
    client.release();
    res.status(200).json({ boards: result.rows });
  } catch (error) {
    console.error("Error fetching boards (/all-boards):", error);
    res.status(500).json({ error: "Error fetching boards." });
  }
});

module.exports = router;
