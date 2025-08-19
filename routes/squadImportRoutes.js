// routes/squadImportRoutes.js
// OCR import (preview + commit) for Squad
// - Robust parser: accepts R H B / RHB, R F M / RFM, S L O / SL0, etc.
// - No custom worker paths, no logger → works on Render Node workers

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { createWorker } = require("tesseract.js");
const { v4: uuidv4 } = require("uuid");
const pool = require("../db");

/* ---------- config ---------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

const TABLE = "players";
// Recommended once in DB:
// CREATE UNIQUE INDEX IF NOT EXISTS ux_players_team_fmt_name
//   ON players (LOWER(player_name), team_name, lineup_type);

const ALLOWED_BAT = new Set(["RHB", "LHB"]);
const ALLOWED_BOWL = new Set(["RM", "RFM", "RF", "LF", "LM", "LHM", "SLO", "OS", "LS"]);

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
  LS: "Leg Spin",
};

const ROLE_LIST = ["Batsman", "Wicketkeeper/Batsman", "All Rounder", "Bowler"];

/* ---------- helpers ---------- */
const toTitle = (s = "") =>
  s.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase()).replace(/\s+/g, " ").trim();

const nor = (s) => (s || "").trim();

// Guess a role if user doesn't provide: any valid bowl code → Bowler, else Batsman
function guessRole(bat, bowl) {
  return ALLOWED_BOWL.has((bowl || "").toUpperCase()) ? "Bowler" : "Batsman";
}

// Build a regex that matches codes with optional spaces between letters, and O/0 tolerance
function looseCodeRx(code) {
  const letters = code.split("").map((ch) => {
    if (ch === "O") return "[O0]";         // tolerate O ↔ 0
    return ch;
  });
  return new RegExp(letters.join("\\s*"), "i");
}

const RX_BAT_RHB = looseCodeRx("RHB");
const RX_BAT_LHB = looseCodeRx("LHB");

const BOWL_CODES = ["RFM", "RM", "RF", "LF", "LM", "LHM", "SLO", "OS", "LS"];
const RX_BOWL = BOWL_CODES.map((c) => [c, looseCodeRx(c)]);

// Greedy team guess (largest all-caps token)
const guessTeamFromText = (plain) => {
  const lines = plain.split(/\r?\n/).map((x) => x.trim());
  let best = "";
  for (const ln of lines) {
    const up = ln.replace(/[^A-Z]/g, "");
    if (up.length >= 4 && ln === ln.toUpperCase() && ln.length > best.length) best = ln;
  }
  return best || null;
};

/**
 * Robust line parser:
 *  - Find BAT matcher and BOWL matcher anywhere in the line (with spaces allowed).
 *  - The player name is the uppercase segment before the BAT match start.
 */
function parseRows(plain) {
  const out = [];
  const seenKeys = new Set();

  const lines = plain.split(/\r?\n/);
  for (let raw of lines) {
    if (!raw || raw.trim().length < 5) continue;
    const line = raw.replace(/[|]+/g, " ").replace(/\s+/g, " ").trim();
    const u = line.toUpperCase();

    // find BAT
    let bat = null, batIdx = -1;
    const mRHB = u.match(RX_BAT_RHB);
    const mLHB = u.match(RX_BAT_LHB);
    if (mRHB) { bat = "RHB"; batIdx = mRHB.index; }
    else if (mLHB) { bat = "LHB"; batIdx = mLHB.index; }

    // find BOWL
    let bowl = null;
    for (const [code, rx] of RX_BOWL) {
      const m = u.match(rx);
      if (m) { bowl = code; break; }
    }

    // need both to form a valid row
    if (!bat || !bowl) continue;

    // name = everything before bat match; strip leading #/digits/icons; keep A-Z, spaces, apostrophes, dots, hyphens
    let namePart = u.slice(0, batIdx)
      .replace(/^[^A-Z]+/, "")
      .replace(/[^A-Z' .-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!namePart || namePart.length < 3) continue;

    const player_name = toTitle(namePart);
    const key = `${player_name}|${bat}|${bowl}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const role = guessRole(bat, bowl);

    out.push({
      player_name,
      role,
      bat,
      bowl,
      normalized: {
        batting_style: batMap[bat] || null,
        bowling_type: bowlMap[bowl] || null,
        skill_type: role,
      },
      conf: { name: 0.88, bat: 0.98, bowl: 0.96, role: 0.65 },
      status: "OK",
    });
  }

  return out;
}

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

/* ---------- Tesseract worker (safe defaults) ---------- */
const ocrWorker = createWorker(); // no custom paths, no logger
let ocrReady = false;
async function ensureOcr() {
  if (ocrReady) return;
  await ocrWorker.load();
  await ocrWorker.loadLanguage("eng");
  await ocrWorker.initialize("eng");
  ocrReady = true;
}

/* ---------- Routes ---------- */

// POST /api/squads/ocr/preview
router.post("/preview", upload.single("image"), async (req, res) => {
  try {
    const lineup_type = nor(req.body.lineup_type);
    let team_name = nor(req.body.team_name);

    if (!req.file) return res.status(400).json({ error: "Image is required" });
    if (!lineup_type) return res.status(400).json({ error: "lineup_type is required (ODI/T20/TEST)" });

    await ensureOcr();

    const { data } = await ocrWorker.recognize(req.file.buffer);
    const plain = (data && data.text) || "";

    if (!team_name) {
      const guess = guessTeamFromText(plain);
      if (guess) team_name = toTitle(guess);
    }
    if (!team_name) team_name = "Unknown";

    const rows = parseRows(plain);

    // duplicates in DB for the same team+format
    const dupSql = `
      SELECT LOWER(player_name) AS name
      FROM ${TABLE}
      WHERE team_name = $1 AND lineup_type = $2
    `;
    const dupRs = await pool.query(dupSql, [team_name, lineup_type]);
    const duplicateSet = new Set(dupRs.rows.map((r) => r.name));

    for (const r of rows) {
      r.normalized.batting_style = batMap[r.bat] || null;
      r.normalized.bowling_type = bowlMap[r.bowl] || null;
      r.normalized.skill_type = r.role;
      r.status = statusFrom(r, duplicateSet);
    }

    const preview_id = uuidv4();
    return res.json({ team_name, lineup_type, preview_id, rows, duplicates: [...duplicateSet], errors: [] });
  } catch (err) {
    console.error("OCR preview error:", err);
    return res.status(500).json({ error: "Failed to process image" });
  }
});

// POST /api/squads/ocr/commit
router.post("/commit", async (req, res) => {
  const { team_name, lineup_type } = req.body || {};
  let rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const userId = req.get("X-User-Id") || null;

  if (!team_name || !lineup_type)
    return res.status(400).json({ error: "team_name and lineup_type are required" });

  rows = rows.map((r) => {
    const bat = (r.bat || "").toUpperCase().replace(/\s+/g, "");
    const bowl = (r.bowl || "").toUpperCase().replace(/\s+/g, "").replace(/0/g, "O");
    const role = r.role || guessRole(bat, bowl);
    return { player_name: toTitle(r.player_name || ""), role, bat, bowl };
  });

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

      const sql = `
        INSERT INTO ${TABLE}
          (player_name, team_name, lineup_type, skill_type, bowling_type, batting_style, is_captain, is_vice_captain, user_id)
        VALUES ($1,$2,$3,$4,$5,$6,false,false,$7)
        ON CONFLICT DO NOTHING
        RETURNING player_name
      `;
      const vals = [r.player_name, team_name, lineup_type, skill_type, bowling_type, batting_style, userId];
      const rs = await client.query(sql, vals);
      if (rs.rowCount === 1) created.push(r.player_name);
      else skipped.push({ name: r.player_name, reason: "duplicate" });
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
