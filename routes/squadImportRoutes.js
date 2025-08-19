// routes/squadImportRoutes.js
// 19-AUG-2025 — Bulk OCR import (preview + commit) for Squad.
// Safe addon: does not touch existing Squad/Lineup code.

// ✅ FIX: removed logger option (caused DataCloneError in Node workers)

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { createWorker } = require("tesseract.js");
const { v4: uuidv4 } = require("uuid");
const pool = require("../db");

// ---------------------- Config ----------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB
});

// CHANGE THIS IF YOUR TABLE NAME/ COLUMNS DIFFER:
const TABLE = "players"; // must have columns shown below
// Recommended unique index in DB (one-time):
// CREATE UNIQUE INDEX IF NOT EXISTS ux_players_team_fmt_name
// ON players (LOWER(player_name), team_name, lineup_type);

const ALLOWED_BAT = new Set(["RHB", "LHB"]);
const ALLOWED_BOWL = new Set(["RM", "RFM", "RF", "LF", "LM", "LHM", "SLO", "OS", "LS"]);

// Code → nice text
const batMap = { RHB: "Right-hand Bat", LHB: "Left-hand Bat" };
const bowlMap = {
  RM: "Right-arm Medium",
  RFM: "Right-arm Medium Fast",
  RF: "Right-arm Fast",
  LF: "Left-arm Fast",
  LM: "Left-arm Medium",
  LHM: "Left-arm Medium",
  SLO: "Left-arm Orthodox",
  OS: "Off Spin",
  LS: "Leg Spin"
};

const ROLE_LIST = ["Batsman", "Wicketkeeper/Batsman", "All Rounder", "Bowler"];

// ---------------------- Helpers ----------------------
const toTitle = (s = "") =>
  s.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase()).replace(/\s+/g, " ").trim();

const nor = (s) => (s || "").trim();

const guessTeamFromText = (plain) => {
  const lines = plain.split(/\r?\n/).map((x) => x.trim());
  let best = "";
  for (const ln of lines) {
    const up = ln.replace(/[^A-Z]/g, "");
    if (up.length >= 4 && ln === ln.toUpperCase() && ln.length > best.length) best = ln;
  }
  return best || null;
};

// Extract rows by regex looking for "... NAME ...  RHB/LHB  RM|RFM|...”
const parseRows = (plain) => {
  const rows = [];
  const seen = new Set();
  const lineRx = /^\s*(\d{1,2})?\s*([A-Z' .-]+?)\s+(RHB|LHB)\s+(RM|RFM|RF|LF|LM|LHM|SLO|OS|LS)\b/gi;

  let m;
  while ((m = lineRx.exec(plain)) !== null) {
    const name = toTitle(m[2]);
    const bat = m[3].toUpperCase();
    const bowl = m[4].toUpperCase();
    const key = `${name}|${bat}|${bowl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      player_name: name,
      role: null,
      bat,
      bowl,
      normalized: {
        batting_style: batMap[bat] || null,
        bowling_type: bowlMap[bowl] || null,
        skill_type: null
      },
      conf: { name: 0.9, bat: 0.98, bowl: 0.96, role: 0.0 },
      status: "FIX"
    });
  }
  return rows;
};

const validateRow = (row) => {
  const nameOk = !!nor(row.player_name);
  const batOk = ALLOWED_BAT.has((row.bat || "").toUpperCase());
  const bowlOk = ALLOWED_BOWL.has((row.bowl || "").toUpperCase());
  const roleOk = ROLE_LIST.includes(row.role);
  const missing = [];
  if (!nameOk) missing.push("name");
  if (!batOk) missing.push("bat");
  if (!bowlOk) missing.push("bowl");
  if (!roleOk) missing.push("role");
  return { ok: missing.length === 0, missing };
};

const statusFrom = (row, duplicateSet) => {
  const v = validateRow(row);
  if (!v.ok) return "FIX";
  if (duplicateSet && duplicateSet.has(row.player_name.toLowerCase())) return "DUP";
  return "OK";
};

// ---------------------- OCR worker ----------------------
// ❗ DO NOT pass {logger: fn} to createWorker in Node — causes DataCloneError
const ocrWorker = createWorker();

// Ensure Tesseract is ready once
let ocrReady = false;
async function ensureOcr() {
  if (ocrReady) return;
  await ocrWorker.load();
  await ocrWorker.loadLanguage("eng");
  await ocrWorker.initialize("eng");
  // modest whitelist to help accuracy for roster tables
  await ocrWorker.setParameters({
    tessedit_char_whitelist:
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .-'RHLMBFOS0123456789"
  });
  ocrReady = true;
}

// ---------------------- Routes ----------------------

/** Health check */
router.get("/health", (_req, res) => res.json({ ok: true, workerReady: ocrReady }));

/**
 * POST /api/squads/ocr/preview
 * form-data: image, team_name?(string), lineup_type(string)
 */
router.post("/preview", upload.single("image"), async (req, res) => {
  try {
    const lineup_type = nor(req.body.lineup_type);
    let team_name = nor(req.body.team_name);

    if (!req.file) return res.status(400).json({ error: "Image is required" });
    if (!lineup_type)
      return res.status(400).json({ error: "lineup_type is required (ODI/T20/TEST)" });

    await ensureOcr();

    const { data } = await ocrWorker.recognize(req.file.buffer);
    const plain = (data && data.text) || "";

    if (!team_name) {
      const guess = guessTeamFromText(plain);
      if (guess) team_name = toTitle(guess);
    }
    if (!team_name) team_name = "Unknown";

    const rows = parseRows(plain);

    // Check DB for duplicates (by name under team+format)
    const dupSql = `
      SELECT LOWER(player_name) AS name
      FROM ${TABLE}
      WHERE team_name = $1 AND lineup_type = $2
    `;
    const dupRs = await pool.query(dupSql, [team_name, lineup_type]);
    const duplicateSet = new Set(dupRs.rows.map((r) => r.name));

    // Build preview rows with statuses
    for (const r of rows) {
      r.normalized.batting_style = batMap[r.bat] || null;
      r.normalized.bowling_type = bowlMap[r.bowl] || null;
      r.normalized.skill_type = r.role || null;
      r.status = statusFrom(r, duplicateSet);
    }

    const preview_id = uuidv4();
    return res.json({
      team_name,
      lineup_type,
      preview_id,
      rows,
      duplicates: [...duplicateSet],
      errors: []
    });
  } catch (err) {
    console.error("OCR preview error:", err);
    return res
      .status(500)
      .json({ error: "OCR_PREVIEW_FAILED", detail: String(err && err.message || err) });
  }
});

/**
 * POST /api/squads/ocr/commit
 * JSON: { preview_id?, team_name, lineup_type, rows: [ {player_name, role, bat, bowl} ] }
 * Header (optional): X-User-Id
 */
router.post("/commit", async (req, res) => {
  const { team_name, lineup_type } = req.body || {};
  let rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const userId = req.get("X-User-Id") || null;

  if (!team_name || !lineup_type)
    return res.status(400).json({ error: "team_name and lineup_type are required" });

  // Normalize & validate rows
  rows = rows.map((r) => ({
    player_name: toTitle(r.player_name || ""),
    role: r.role || null,
    bat: (r.bat || "").toUpperCase(),
    bowl: (r.bowl || "").toUpperCase()
  }));

  const created = [];
  const skipped = [];
  const errors = [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const r of rows) {
      const v = validateRow(r);
      if (!v.ok) {
        skipped.push({ name: r.player_name, reason: `missing: ${v.missing.join(",")}` });
        continue;
      }

      const batting_style = batMap[r.bat] || null;
      const bowling_type = bowlMap[r.bowl] || null;
      const skill_type = r.role;

      // Try insert; rely on unique index to skip duplicates
      const sql = `
        INSERT INTO ${TABLE}
          (player_name, team_name, lineup_type, skill_type, bowling_type, batting_style, is_captain, is_vice_captain, user_id)
        VALUES ($1,$2,$3,$4,$5,$6,false,false,$7)
        ON CONFLICT DO NOTHING
        RETURNING player_name
      `;
      const vals = [
        r.player_name,
        team_name,
        lineup_type,
        skill_type,
        bowling_type,
        batting_style,
        userId
      ];
      const rs = await client.query(sql, vals);
      if (rs.rowCount === 1) {
        created.push(r.player_name);
      } else {
        skipped.push({ name: r.player_name, reason: "duplicate" });
      }
    }

    await client.query("COMMIT");
    return res.json({ ok: true, created: created.length, created_names: created, skipped, errors });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("OCR commit error:", e);
    return res.status(500).json({ ok: false, error: "Commit failed" });
  } finally {
    client.release();
  }
});

module.exports = router;
