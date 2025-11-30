// routes/boardRoutes.js
// Board Registration + Teams + Membership History (joined_at / left_at)

const express = require("express");
const router = express.Router();
const pool = require("../db");
const { v4: uuidv4 } = require("uuid");

/* ----------------- helpers ----------------- */

const sanitizeTeams = (teams) => {
  if (!Array.isArray(teams)) return [];
  const seen = new Set();
  const out = [];

  teams.forEach((t) => {
    const s = String(t || "").trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  });

  return out;
};

const isValidEmail = (email) => {
  if (!email) return false;
  const s = String(email).trim();
  // basic but enough for validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
};

// Accepts "YYYY-MM-DD" or "DD-MM-YYYY" and returns "YYYY-MM-DD" or null
const toIsoDateString = (raw) => {
  if (!raw) return null;
  let s = String(raw).trim();

  // If already YYYY-MM-DD, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD-MM-YYYY
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) {
    const [_, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }

  // Fallback: try Date parsing
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/* ===========================================================
 * 1) REGISTER NEW BOARD (OPEN)
 *    - Inserts into board_registration
 *    - Inserts teams into board_teams with joined_at = registration_date
 * ===========================================================
 */

router.post("/register", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: "Missing request body." });
    }

    let { board_name, owner_name, registration_date, owner_email, teams } =
      req.body;

    board_name = String(board_name || "").trim();
    owner_name = String(owner_name || "").trim();
    owner_email = String(owner_email || "").trim().toLowerCase();
    teams = sanitizeTeams(teams);

    if (!board_name || !owner_name || !registration_date || !owner_email) {
      return res.status(400).json({ error: "All fields are required." });
    }

    if (!Array.isArray(teams) || teams.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one team is required." });
    }

    if (!isValidEmail(owner_email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    const isoDate = toIsoDateString(registration_date);
    if (!isoDate) {
      return res.status(400).json({
        error: "Invalid registration date. Use DD-MM-YYYY or YYYY-MM-DD.",
      });
    }

    const regDateObj = new Date(isoDate);
    if (regDateObj < startOfToday()) {
      return res.status(400).json({
        error: "Registration date must be today or in the future.",
      });
    }

    const registration_id = uuidv4();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

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

      const insertTeam = `
        INSERT INTO board_teams (board_id, registration_id, team_name, joined_at)
        VALUES ($1, $2, $3, to_date($4,'YYYY-MM-DD'))
      `;

      for (const team of teams) {
        await client.query(insertTeam, [
          br.id,
          br.registration_id,
          team,
          isoDate,
        ]);
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
          return res
            .status(409)
            .json({ error: "Board name already exists." });
        if (
          (err.constraint || "").includes(
            "board_registration_owner_email_key"
          )
        )
          return res
            .status(409)
            .json({ error: "Owner email already used." });
        return res
          .status(409)
          .json({ error: "Duplicate data violates a unique constraint." });
      }

      if (err.code === "23502") {
        return res.status(400).json({
          error: "Missing required data (check all mandatory fields).",
        });
      }

      if (err.code === "22P02") {
        return res.status(400).json({
          error: "Bad value for one of the fields (check date/UUID formats).",
        });
      }

      if (err.code === "42804") {
        return res.status(400).json({ error: "Data type mismatch." });
      }

      return res.status(500).json({ error: "Error during registration." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error (register):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ===========================================================
 * 2) GET ALL BOARDS (OPEN)
 *    - Returns boards with CURRENT active teams only (left_at IS NULL)
 * ===========================================================
 */

/* ===========================================================
 * 2) GET ALL BOARDS (OPEN)
 *    - Returns boards with ALL teams (active + archived)
 *      teams = [{ id, team_name, joined_at, left_at }]
 * ===========================================================
 */

router.get("/all-boards", async (_req, res) => {
  try {
    const sql = `
      SELECT
        br.id,
        br.registration_id,
        br.board_name,
        br.owner_name,
        to_char(br.registration_date,'YYYY-MM-DD') AS registration_date,
        br.owner_email,
        COALESCE(
          json_agg(
            json_build_object(
              'id',       bt.id,
              'team_name', bt.team_name,
              'joined_at', to_char(bt.joined_at,'YYYY-MM-DD'),
              'left_at',   to_char(bt.left_at,'YYYY-MM-DD')
            )
            ORDER BY bt.team_name
          )
          FILTER (WHERE bt.team_name IS NOT NULL),
          '[]'::json
        ) AS teams
      FROM board_registration br
      LEFT JOIN board_teams bt
        ON bt.board_id = br.id
      GROUP BY
        br.id,
        br.registration_id,
        br.board_name,
        br.owner_name,
        br.registration_date,
        br.owner_email
      ORDER BY br.registration_date DESC, br.board_name ASC
    `;

    const { rows } = await pool.query(sql);

    const boards = rows.map((r) => ({
      id: r.id,
      registration_id: r.registration_id,
      board_name: r.board_name,
      owner_name: r.owner_name,
      registration_date: r.registration_date,
      owner_email: r.owner_email,
      teams: Array.isArray(r.teams) ? r.teams : [],
    }));

    res.json({ boards });
  } catch (err) {
    console.error("Error fetching boards:", err);
    res.status(500).json({ error: "Error fetching board list." });
  }
});

/* ===========================================================
 * 3) UPDATE BOARD
 *    - Updates board_registration metadata
 *    - Membership logic on board_teams:
 *      • Active teams NOT in new list  → left_at = registration_date
 *      • New teams NOT currently active → new row with joined_at = registration_date
 * ===========================================================
 */

router.put("/update/:registration_id", async (req, res) => {
  try {
    const { registration_id } = req.params;
    let { board_name, owner_name, registration_date, owner_email, teams } =
      req.body;

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
      return res.status(400).json({
        error: "Invalid registration date. Use DD-MM-YYYY or YYYY-MM-DD.",
      });
    }

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

      // Update board metadata
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

      // Existing memberships
      const existingRes = await client.query(
        `
          SELECT
            id,
            LOWER(TRIM(team_name)) AS team_name,
            to_char(joined_at,'YYYY-MM-DD') AS joined_at,
            to_char(left_at,'YYYY-MM-DD')   AS left_at
          FROM board_teams
          WHERE board_id = $1 OR registration_id = $2
        `,
        [br.id, br.registration_id]
      );

      const existing = existingRes.rows;

      const activeNow = new Set(
        existing
          .filter((r) => !r.left_at)
          .map((r) => r.team_name)
      );

      const newNormNames = teams.map((t) =>
        String(t || "").trim().toLowerCase()
      );
      const newNormSet = new Set(newNormNames);

      // 1) Close memberships that are active now but NOT present in new list
      for (const name of activeNow) {
        if (!newNormSet.has(name)) {
          await client.query(
            `
              UPDATE board_teams
              SET left_at = to_date($3,'YYYY-MM-DD')
              WHERE (board_id = $1 OR registration_id = $2)
                AND LOWER(TRIM(team_name)) = $4
                AND left_at IS NULL
            `,
            [br.id, br.registration_id, isoDate, name]
          );
        }
      }

      // 2) Add memberships that are in the new list but not active now
      const insertTeam = `
        INSERT INTO board_teams (board_id, registration_id, team_name, joined_at)
        VALUES ($1, $2, $3, to_date($4,'YYYY-MM-DD'))
      `;

      for (const normName of newNormSet) {
        if (activeNow.has(normName)) continue; // already active

        const originalName =
          teams.find(
            (t) =>
              String(t || "").trim().toLowerCase() === normName
          ) || normName;

        await client.query(insertTeam, [
          br.id,
          br.registration_id,
          originalName,
          isoDate,
        ]);
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

      if (err.code === "23505") {
        return res.status(409).json({
          error: "Duplicate value violates a unique constraint.",
        });
      }

      if (err.code === "23502") {
        return res.status(400).json({
          error:
            "Missing required data (likely board_id or team_name on board_teams).",
        });
      }

      if (err.code === "22P02") {
        return res
          .status(400)
          .json({ error: "Bad value for one of the fields." });
      }

      if (err.code === "42804") {
        return res.status(400).json({ error: "Data type mismatch." });
      }

      res.status(500).json({ error: "Error updating board." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error (update):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ===========================================================
 * 4) DELETE BOARD (ADMIN USE)
 *    - Hard deletes from board_registration and board_teams
 *    - If you want soft-delete, we can change this later
 * ===========================================================
 */

router.delete("/delete/:registration_id", async (req, res) => {
  try {
    const { registration_id } = req.params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const boardRes = await client.query(
        "SELECT id FROM board_registration WHERE registration_id = $1",
        [registration_id]
      );

      if (boardRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Board not found." });
      }

      const boardId = boardRes.rows[0].id;

      await client.query("DELETE FROM board_teams WHERE board_id = $1", [
        boardId,
      ]);
      await client.query(
        "DELETE FROM board_registration WHERE id = $1",
        [boardId]
      );

      await client.query("COMMIT");
      res.json({ message: "Board deleted successfully." });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Delete transaction failed:", err);
      res.status(500).json({ error: "Error deleting board." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error (delete):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ===========================================================
 * 5) MOVE TEAM (TRANSFER MEMBERSHIP BETWEEN BOARDS)
 *    - Closes membership in source board (left_at)
 *    - Opens membership in target board (joined_at)
 * ===========================================================
 */

router.post("/move-team", async (req, res) => {
  try {
    let {
      team_name,
      from_registration_id,
      to_registration_id,
      effective_date,
    } = req.body;

    team_name = String(team_name || "").trim();
    from_registration_id = String(from_registration_id || "").trim();
    to_registration_id = String(to_registration_id || "").trim();

    if (!team_name || !from_registration_id || !to_registration_id) {
      return res.status(400).json({
        error:
          "team_name, from_registration_id and to_registration_id are required.",
      });
    }

    if (from_registration_id === to_registration_id) {
      return res
        .status(400)
        .json({ error: "Source and target boards must be different." });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const isoDate = toIsoDateString(effective_date || todayIso);
    if (!isoDate) {
      return res.status(400).json({
        error: "Invalid effective_date. Use DD-MM-YYYY or YYYY-MM-DD.",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const srcRes = await client.query(
        "SELECT id, registration_id FROM board_registration WHERE registration_id = $1",
        [from_registration_id]
      );
      const dstRes = await client.query(
        "SELECT id, registration_id FROM board_registration WHERE registration_id = $1",
        [to_registration_id]
      );

      if (srcRes.rowCount === 0 || dstRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ error: "Source or target board not found." });
      }

      const src = srcRes.rows[0];
      const dst = dstRes.rows[0];

      // Close membership in source board
      const closeRes = await client.query(
        `
          UPDATE board_teams
          SET left_at = to_date($4,'YYYY-MM-DD')
          WHERE (board_id = $1 OR registration_id = $2)
            AND LOWER(TRIM(team_name)) = LOWER(TRIM($3))
            AND left_at IS NULL
        `,
        [src.id, src.registration_id, team_name, isoDate]
      );

      if (closeRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          error: "Active membership for this team in source board not found.",
        });
      }

      // Open membership in target board
      await client.query(
        `
          INSERT INTO board_teams (board_id, registration_id, team_name, joined_at)
          VALUES ($1, $2, $3, to_date($4,'YYYY-MM-DD'))
        `,
        [dst.id, dst.registration_id, team_name, isoDate]
      );

      await client.query("COMMIT");
      res.status(200).json({
        message: "Team moved successfully.",
        team_name,
        from_board: src.registration_id,
        to_board: dst.registration_id,
        effective_date: isoDate,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Move-team transaction failed:", err);
      res.status(500).json({ error: "Failed to move team." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error (move-team):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

/* ===========================================================
 * 6) REMOVE TEAM FROM A BOARD (SOFT REMOVE)
 *    - Closes the *active* membership (left_at) for that board
 *    - If already archived, it simply reports "already removed"
 *    - Match history remains preserved
 * =========================================================== */

router.post("/remove-team", async (req, res) => {
  try {
    let { registration_id, team_name, effective_date } = req.body;

    registration_id = String(registration_id || "").trim();
    team_name = String(team_name || "").trim();

    if (!registration_id || !team_name) {
      return res.status(400).json({
        error: "registration_id and team_name are required.",
      });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const isoDate = toIsoDateString(effective_date || todayIso);
    if (!isoDate) {
      return res.status(400).json({
        error: "Invalid effective_date. Use DD-MM-YYYY or YYYY-MM-DD.",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Find board
      const brRes = await client.query(
        "SELECT id, registration_id, board_name FROM board_registration WHERE registration_id = $1",
        [registration_id]
      );

      if (brRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Board not found." });
      }

      const br = brRes.rows[0];

      // All memberships for this team on this board
      const memberRes = await client.query(
        `
          SELECT id, joined_at, left_at
          FROM board_teams
          WHERE (board_id = $1 OR registration_id = $2)
            AND LOWER(TRIM(team_name)) = LOWER(TRIM($3))
          ORDER BY joined_at DESC
        `,
        [br.id, br.registration_id, team_name]
      );

      if (memberRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          error: "Team is not registered under this board.",
        });
      }

      // Look for an active membership
      const active = memberRes.rows.find((r) => !r.left_at);

      if (active) {
        // Close the active membership
        await client.query(
          `
            UPDATE board_teams
            SET left_at = to_date($2,'YYYY-MM-DD')
            WHERE id = $1
          `,
          [active.id, isoDate]
        );

        await client.query("COMMIT");
        return res.status(200).json({
          message: "Team removed from board (active membership closed).",
          registration_id: br.registration_id,
          board_name: br.board_name,
          team_name,
          effective_date: isoDate,
        });
      }

      // No active membership → already archived, just report success
      await client.query("COMMIT");
      return res.status(200).json({
        message: "Team is already archived for this board.",
        registration_id: br.registration_id,
        board_name: br.board_name,
        team_name,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("remove-team transaction failed:", err);
      return res.status(500).json({ error: "Failed to remove team." });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Server error (remove-team):", err);
    res.status(500).json({ error: "Internal server error." });
  }
});


module.exports = router;
