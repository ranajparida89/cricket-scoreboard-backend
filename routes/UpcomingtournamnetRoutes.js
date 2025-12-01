// routes/UpcomingtournamnetRoutes.js
// ✅ Ongoing Tournament start / pause / resume / get-current / delete

const express = require("express");
const router = express.Router();
const pool = require("../db");

// helper: return latest running/paused tournament
async function fetchCurrentTournament(client) {
  const { rows } = await client.query(
    `
    SELECT *
    FROM ongoing_tournament
    WHERE status IN ('running', 'paused')
    ORDER BY updated_at DESC
    LIMIT 1
    `
  );
  return rows[0] || null;
}

// GET /api/tournament/ongoing
router.get("/ongoing", async (req, res) => {
  const client = await pool.connect();
  try {
    const now = new Date();
    let t = await fetchCurrentTournament(client);

    if (!t) {
      return res.json(null);
    }

    // ensure completed tournaments are marked
    if (t.status === "running") {
      const endAt = new Date(t.end_at);
      if (endAt.getTime() <= now.getTime()) {
        await client.query(
          `UPDATE ongoing_tournament
           SET status = 'completed', remaining_ms = 0, updated_at = now()
           WHERE id = $1`,
          [t.id]
        );
        t.status = "completed";
        t.remaining_ms = 0;
      } else {
        t.remaining_ms = Math.max(endAt.getTime() - now.getTime(), 0);
      }
    }

    return res.json({
      id: t.id,
      tournament_name: t.tournament_name,
      start_date: t.start_date,
      duration_days: t.duration_days,
      status: t.status,
      end_at: t.end_at,
      remaining_ms: Number(t.remaining_ms || 0),
    });
  } catch (err) {
    console.error("GET /api/tournament/ongoing failed:", err);
    res.status(500).json({ error: "Failed to load ongoing tournament." });
  } finally {
    client.release();
  }
});

// POST /api/tournament/start
router.post("/start", async (req, res) => {
  const { tournament_name, start_date, duration_days } = req.body || {};

  const name = (tournament_name || "").trim();
  const days = parseInt(duration_days, 10);

  if (!name || !start_date || !Number.isFinite(days) || days <= 0) {
    return res.status(400).json({
      error:
        "tournament_name, start_date and positive duration_days are required.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // close any running/paused tournaments
    await client.query(
      `
      UPDATE ongoing_tournament
      SET status = 'completed', remaining_ms = 0, updated_at = now()
      WHERE status IN ('running', 'paused')
      `
    );

    // countdown runs from "now" for <days> days
    const now = new Date();
    const endAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const remainingMs = Math.max(endAt.getTime() - now.getTime(), 0);

    const insertRes = await client.query(
      `
      INSERT INTO ongoing_tournament
        (tournament_name, start_date, duration_days, status, end_at, remaining_ms)
      VALUES
        ($1, $2, $3, 'running', $4, $5)
      RETURNING id, tournament_name, start_date, duration_days, status, end_at, remaining_ms
      `,
      [name, start_date, days, endAt, remainingMs]
    );

    await client.query("COMMIT");

    const t = insertRes.rows[0];
    res.json({
      id: t.id,
      tournament_name: t.tournament_name,
      start_date: t.start_date,
      duration_days: t.duration_days,
      status: t.status,
      end_at: t.end_at,
      remaining_ms: Number(t.remaining_ms || 0),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/tournament/start failed:", err);
    res.status(500).json({ error: "Failed to start tournament." });
  } finally {
    client.release();
  }
});

// POST /api/tournament/pause
router.post("/pause", async (req, res) => {
  const client = await pool.connect();
  try {
    const now = new Date();
    const { rows } = await client.query(
      `
      SELECT *
      FROM ongoing_tournament
      WHERE status = 'running'
      ORDER BY updated_at DESC
      LIMIT 1
      `
    );

    if (!rows[0]) {
      return res.status(400).json({ error: "No running tournament to pause." });
    }

    const t = rows[0];
    const endAt = new Date(t.end_at);
    const remainingMs = Math.max(endAt.getTime() - now.getTime(), 0);

    const upd = await client.query(
      `
      UPDATE ongoing_tournament
      SET status = 'paused',
          remaining_ms = $1,
          updated_at = now()
      WHERE id = $2
      RETURNING id, tournament_name, start_date, duration_days, status, end_at, remaining_ms
      `,
      [remainingMs, t.id]
    );

    const row = upd.rows[0];
    res.json({
      id: row.id,
      tournament_name: row.tournament_name,
      start_date: row.start_date,
      duration_days: row.duration_days,
      status: row.status,
      end_at: row.end_at,
      remaining_ms: Number(row.remaining_ms || 0),
    });
  } catch (err) {
    console.error("POST /api/tournament/pause failed:", err);
    res.status(500).json({ error: "Failed to pause tournament." });
  } finally {
    client.release();
  }
});

// POST /api/tournament/resume
router.post("/resume", async (req, res) => {
  const client = await pool.connect();
  try {
    const now = new Date();
    const { rows } = await client.query(
      `
      SELECT *
      FROM ongoing_tournament
      WHERE status = 'paused'
      ORDER BY updated_at DESC
      LIMIT 1
      `
    );

    if (!rows[0]) {
      return res
        .status(400)
        .json({ error: "No paused tournament to resume." });
    }

    const t = rows[0];
    const remainingMs = Number(t.remaining_ms || 0);
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      // nothing left → mark completed
      await client.query(
        `
        UPDATE ongoing_tournament
        SET status = 'completed',
            remaining_ms = 0,
            updated_at = now()
        WHERE id = $1
        `,
        [t.id]
      );
      return res.status(400).json({
        error: "Tournament already finished; cannot resume.",
      });
    }

    const endAt = new Date(now.getTime() + remainingMs);

    const upd = await client.query(
      `
      UPDATE ongoing_tournament
      SET status = 'running',
          end_at = $1,
          updated_at = now()
      WHERE id = $2
      RETURNING id, tournament_name, start_date, duration_days, status, end_at, remaining_ms
      `,
      [endAt, t.id]
    );

    const row = upd.rows[0];
    res.json({
      id: row.id,
      tournament_name: row.tournament_name,
      start_date: row.start_date,
      duration_days: row.duration_days,
      status: row.status,
      end_at: row.end_at,
      remaining_ms: Number(row.remaining_ms || 0),
    });
  } catch (err) {
    console.error("POST /api/tournament/resume failed:", err);
    res.status(500).json({ error: "Failed to resume tournament." });
  } finally {
    client.release();
  }
});

// POST /api/tournament/delete
router.post("/delete", async (req, res) => {
  const client = await pool.connect();
  const { id } = req.body || {};

  try {
    await client.query("BEGIN");

    if (id) {
      // mark specific tournament as completed (timer disappears from UI)
      await client.query(
        `
        UPDATE ongoing_tournament
        SET status = 'completed',
            remaining_ms = 0,
            updated_at = now()
        WHERE id = $1
        `,
        [id]
      );
    } else {
      // fallback: complete any running/paused tournament
      await client.query(
        `
        UPDATE ongoing_tournament
        SET status = 'completed',
            remaining_ms = 0,
            updated_at = now()
        WHERE status IN ('running', 'paused')
        `
      );
    }

    await client.query("COMMIT");
    return res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/tournament/delete failed:", err);
    res.status(500).json({ error: "Failed to delete tournament." });
  } finally {
    client.release();
  }
});

module.exports = router;
