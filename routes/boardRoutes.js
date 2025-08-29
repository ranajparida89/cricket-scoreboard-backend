// routes/boardRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { v4: uuidv4 } = require("uuid");

/* ---------------- Helpers ---------------- */
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");

// Accept 3 token shapes for admin (unchanged)
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

// Normalize/clean team list
function sanitizeTeams(teams) {
  if (!Array.isArray(teams)) return [];
  const seen = new Set();
  const clean = [];
  for (const t of teams) {
    const name = String(t || "").trim();
    if (!name) continue;
    if (!seen.has(name)) {
      seen.add(name);
      clean.push(name);
    }
  }
  return clean;
}

// GPT UPDATE: parse DD-MM-YYYY or YYYY-MM-DD → YYYY-MM-DD, else null
function toIsoDateString(input) {
  if (!input) return null;
  const s = String(input).trim();

  // DD-MM-YYYY
  const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm}-${dd}`;
  }

  // YYYY-MM-DD
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return s;

  // Try Date object/other strings that JS can parse (last resort)
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

function startOfToday() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/* ---------------------------------------------
 * API 1: Register a New Board (OPEN to normal users)
 * --------------------------------------------- */
router.post("/register", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: "Missing request body." });
    }

    let {
      board_name,
      owner_name,
      registration_date,
      owner_email,
      teams,
    } = req.body;

    // trim/normalize
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

    // GPT UPDATE: robust date parsing & validation
    const isoDate = toIsoDateString(registration_date);
    if (!isoDate) {
      return res
        .status(400)
        .json({ error: "Invalid registration date. Use DD-MM-YYYY or YYYY-MM-DD." });
    }
    const regDateObj = new Date(isoDate);
    if (regDateObj < startOfToday()) {
      return res
        .status(400)
        .json({ error: "Registration date must be today or in the future." });
    }

    const registration_id = uuidv4();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // GPT UPDATE: cast via to_date to avoid format issues
      const insertBoard = `
        INSERT INTO board_registration (registration_id, board_name, owner_name, registration_date, owner_email)
        VALUES ($1, $2, $3, to_date($4,'YYYY-MM-DD'), $5)
      `;
      await client.query(insertBoard, [
        registration_id,
        board_name,
        owner_name,
        isoDate,
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
      console.error("Transaction error (register):", err);
      res.status(500).json({ error: "Error during registration." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error (register):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ---------------------------------------------
 * API 2: Get All Boards with Their Teams (legacy)
 * --------------------------------------------- */
router.get("/all", async (req, res) => {
  try {
    const query = `
      SELECT 
        br.*,
        ARRAY_AGG(bt.team_name) AS teams
      FROM board_registration br
      LEFT JOIN board_teams bt ON br.registration_id = bt.registration_id
      GROUP BY br.registration_id
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
 * API 3: Update Board Info (ADMIN ONLY)
 * --------------------------------------------- */
router.put("/update/:registration_id", adminOnly, async (req, res) => {
  try {
    const { registration_id } = req.params;
    let {
      board_name,
      owner_name,
      registration_date,
      owner_email,
      teams,
    } = req.body;

    // trim/normalize
    board_name = String(board_name || "").trim();
    owner_name = String(owner_name || "").trim();
    owner_email = String(owner_email || "").trim().toLowerCase();
    teams = sanitizeTeams(teams); // can be []

    if (!board_name || !owner_name || !registration_date || !owner_email) {
      return res.status(400).json({ error: "All fields are required." });
    }
    if (!Array.isArray(teams)) {
      return res.status(400).json({ error: "Teams must be an array." });
    }
    if (!isValidEmail(owner_email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    // GPT UPDATE: robust date parsing
    const isoDate = toIsoDateString(registration_date);
    if (!isoDate) {
      return res
        .status(400)
        .json({ error: "Invalid registration date. Use DD-MM-YYYY or YYYY-MM-DD." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const updateBoard = `
        UPDATE board_registration
        SET board_name = $1,
            owner_name = $2,
            registration_date = to_date($3,'YYYY-MM-DD'),
            owner_email = $4
        WHERE registration_id = $5
      `;
      await client.query(updateBoard, [
        board_name,
        owner_name,
        isoDate,
        owner_email,
        registration_id,
      ]);

      // replace teams (can be empty)
      await client.query(
        "DELETE FROM board_teams WHERE registration_id = $1",
        [registration_id]
      );

      if (teams.length > 0) {
        const insertTeam = `
          INSERT INTO board_teams (registration_id, team_name)
          VALUES ($1, $2)
        `;
        for (const team of teams) {
          await client.query(insertTeam, [registration_id, team]);
        }
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
    console.error("Server error (update):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ---------------------------------------------
 * API 4: Delete Board + Its Teams (ADMIN ONLY)
 * --------------------------------------------- */
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
    console.error("Server error (delete):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ---------------------------------------------
 * API 5: Get All Boards (Optimized/clean)
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
        ARRAY_AGG(bt.team_name) AS teams
      FROM board_registration br
      LEFT JOIN board_teams bt ON br.registration_id = bt.registration_id
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
