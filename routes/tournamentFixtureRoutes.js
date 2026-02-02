// ✅ routes/tournamentFixtureRoutes.js
// ✅ CrickEdge – Tournament Fixture Lifecycle (PDF-driven)
// Author: Ranaj Parida
// Purpose: Handle Pending ↔ Completed tournament matches with dynamic columns

const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ------------------------------------------------------------------
   1️⃣ CREATE TOURNAMENT + UPLOAD FIXTURE (PENDING MATCHES)
   ------------------------------------------------------------------
   Expected payload:
   {
     tournament_name: "World Cup",
     season_year: "2026",
     created_by: "admin@crickedge",
     uploaded_pdf_name: "wc_2026_fixtures.pdf",
     matches: [ { ...dynamic columns... }, { ... } ]
   }
-------------------------------------------------------------------*/
router.post("/tournament/upload-fixture", async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      tournament_name,
      season_year,
      created_by,
      uploaded_pdf_name,
      matches,
    } = req.body;

    if (
      !tournament_name ||
      !season_year ||
      !created_by ||
      !Array.isArray(matches) ||
      matches.length === 0
    ) {
      return res.status(400).json({ error: "Invalid tournament payload" });
    }

    await client.query("BEGIN");

    // 1️⃣ Insert tournament master
    const tournamentRes = await client.query(
      `
      INSERT INTO tournament_master
        (tournament_name, season_year, uploaded_pdf_name, created_by)
      VALUES ($1,$2,$3,$4)
      RETURNING tournament_id
      `,
      [tournament_name, season_year, uploaded_pdf_name || null, created_by]
    );

    const tournamentId = tournamentRes.rows[0].tournament_id;

    // 2️⃣ Insert all matches as PENDING (JSONB)
    const insertPendingQuery = `
      INSERT INTO tournament_pending_matches
        (tournament_id, match_data)
      VALUES ($1, $2)
    `;

    for (const row of matches) {
      await client.query(insertPendingQuery, [tournamentId, row]);
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Tournament fixture uploaded successfully",
      tournament_id: tournamentId,
      total_matches: matches.length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Upload Fixture Error:", err.message);
    res.status(500).json({ error: "Failed to upload tournament fixture" });
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------
   2️⃣ FETCH PENDING MATCHES (FOR TABLE 1)
-------------------------------------------------------------------*/
router.get("/tournament/pending/:tournamentId", async (req, res) => {
  try {
    const { tournamentId } = req.params;

    const result = await pool.query(
      `
      SELECT pending_id, match_data
      FROM tournament_pending_matches
      WHERE tournament_id = $1
      ORDER BY created_at ASC
      `,
      [tournamentId]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("❌ Fetch Pending Matches Error:", err.message);
    res.status(500).json({ error: "Unable to fetch pending matches" });
  }
});

/* ------------------------------------------------------------------
   3️⃣ MARK MATCH AS COMPLETED (CHECKBOX ACTION)
-------------------------------------------------------------------*/
router.post("/tournament/complete-match", async (req, res) => {
  const client = await pool.connect();
  try {
    const { pending_id, tournament_id } = req.body;

    if (!pending_id || !tournament_id) {
      return res.status(400).json({ error: "Missing pending_id or tournament_id" });
    }

    await client.query("BEGIN");

    // 1️⃣ Move record to completed table
    const insertCompleted = await client.query(
      `
      INSERT INTO tournament_completed_matches (tournament_id, match_data)
      SELECT tournament_id, match_data
      FROM tournament_pending_matches
      WHERE pending_id = $1 AND tournament_id = $2
      RETURNING completed_id
      `,
      [pending_id, tournament_id]
    );

    if (insertCompleted.rowCount === 0) {
      throw new Error("Pending match not found");
    }

    // 2️⃣ Delete from pending table
    await client.query(
      `
      DELETE FROM tournament_pending_matches
      WHERE pending_id = $1
      `,
      [pending_id]
    );

    await client.query("COMMIT");

    res.status(200).json({
      message: "Match moved to completed matches",
      completed_id: insertCompleted.rows[0].completed_id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Complete Match Error:", err.message);
    res.status(500).json({ error: "Failed to complete match" });
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------
   4️⃣ FETCH COMPLETED MATCH HISTORY (DROPDOWN BASED)
-------------------------------------------------------------------*/
router.get("/tournament/completed", async (req, res) => {
  try {
    const { tournament_name, season_year } = req.query;

    if (!tournament_name || !season_year) {
      return res.status(400).json({ error: "Tournament name and season required" });
    }

    const result = await pool.query(
      `
      SELECT c.completed_id, c.match_data, c.completed_at
      FROM tournament_completed_matches c
      JOIN tournament_master t
        ON t.tournament_id = c.tournament_id
      WHERE t.tournament_name = $1
        AND t.season_year = $2
      ORDER BY c.completed_at ASC
      `,
      [tournament_name, season_year]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("❌ Fetch Completed History Error:", err.message);
    res.status(500).json({ error: "Unable to fetch completed match history" });
  }
});

/* ------------------------------------------------------------------
   5️⃣ FETCH TOURNAMENT LIST (FOR DROPDOWNS)
-------------------------------------------------------------------*/
router.get("/tournament/list", async (_req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT tournament_id, tournament_name, season_year
      FROM tournament_master
      ORDER BY created_at DESC
      `
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("❌ Fetch Tournament List Error:", err.message);
    res.status(500).json({ error: "Unable to fetch tournaments" });
  }
});

module.exports = router;
