// routes/squadImportRoutes.js
// Bulk OCR import (preview + commit) for Squad — using hosted OCR API (no tesseract workers)

const express = require("express");
const router = express.Router();
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const { v4: uuidv4 } = require("uuid");
const pool = require("../db");

// ---------- Upload config ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

// ---------- DB table / maps ----------
const TABLE = "players";

// Create once in DB (recommended):
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

// Role short codes → skill_type used in your app
function normalizeRole(raw) {
  const s = (raw || "").trim();
  if (!s) return "Batsman"; // sensible default so import never becomes 0
  const up = s.toUpperCase();
  if (up === "AR") return "All Rounder";
  if (up === "BAT") return "Batsman";
  if (up === "BWL") return "Bowler";
  if (up === "WK") return "Wicketkeeper/Batsman";
  // full names
  const full = ["Batsman", "Bowler", "All Rounder", "Wicketkeeper/Batsman"].find(
    (x) => x.toLowerCase() === s.toLowerCase()
  );
  return full || "Batsman";
}

const toTitle = (s = "") =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m, c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();

const nor = (s) => (s || "").trim();

// Try to guess team name from big ALL CAPS header line in OCR text
const guessTeamFromText = (plain) => {
  const lines = plain.split(/\r?\n/).map((x) => x.trim());
  let best = "";
  for (const ln of lines) {
    const up = ln.replace(/[^A-Z]/g, "");
    if (up.length >= 4 && ln === ln.toUpperCase() && ln.length > best.length) best = ln;
  }
  return best || null;
};

// Parse rows like: (index)? NAME  RHB|LHB  RM|RFM|RF|LF|LM|LHM|SLO|OS|LS
// Role is *optional* here; user may add later, but we default to Batsman on commit
const parseRows = (plain) => {
  const out = [];
  const seen = new Set();
  const rx =
    /^\s*(\d{1,2})?\s*([A-Z' .-]+?)\s+(RHB|LHB)\s+(RM|RFM|RF|LF|LM|LHM|SLO|OS|LS)\b/gi;

  let m;
  while ((m = rx.exec(plain)) !== null) {
    const name = toTitle(m[2]);
    const bat = m[3].toUpperCase();
    const bowl = m[4].toUpperCase();
    const key = `${name}|${bat}|${bowl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      player_name: name,
      role: null, // not detected from icons; UI may set, commit defaults later
      bat,
      bowl,
      normalized: {
        batting_style: batMap[bat] || null,
        bowling_type: bowlMap[bowl] || null,
        skill_type: null,
      },
      conf: { name: 0.9, bat: 0.98, bowl: 0.96, role: 0.0 },
      status: "FIX", // shown as FIX in preview if role is missing
    });
  }
  return out;
};

const validateBasic = (row) => {
  const ok =
    !!nor(row.player_name) &&
    ALLOWED_BAT.has((row.bat || "").toUpperCase()) &&
    ALLOWED_BOWL.has((row.bowl || "").toUpperCase());
  return ok;
};

const statusFrom = (row, duplicateSet) => {
  if (!validateBasic(row)) return "FIX";
  if (duplicateSet && duplicateSet.has(row.player_name.toLowerCase())) return "DUP";
  return "OK";
};

// ---------- PREVIEW (uses hosted OCR API) ----------
/**
 * POST /api/squads/ocr/preview
 * form-data: image, team_name?(string), lineup_type(string)
 *
 * OCR provider: OCR.Space (free key works for testing)
 * Set env OCR_SPACE_KEY for your account; falls back to "helloworld".
 */
router.post("/preview", upload.single("image"), async (req, res) => {
  try {
    const lineup_type = nor(req.body.lineup_type);
    let team_name = nor(req.body.team_name);

    if (!req.file) return res.status(400).json({ error: "Image is required" });
    if (!lineup_type) return res.status(400).json({ error: "lineup_type is required (ODI/T20/TEST)" });

    const apikey = process.env.OCR_SPACE_KEY || "helloworld";

    const fd = new FormData();
    fd.append("apikey", apikey);
    fd.append("language", "eng");
    fd.append("isTable", "true");
    fd.append("OCREngine", "2");
    // pass the image buffer
    fd.append("file", req.file.buffer, {
      filename: req.file.originalname || "roster.jpg",
      contentType: req.file.mimetype || "image/jpeg",
    });

    const ocrResp = await axios.post("https://api.ocr.space/parse/image", fd, {
      headers: fd.getHeaders(),
      maxBodyLength: Infinity,
    });

    const plain =
      ocrResp?.data?.ParsedResults?.[0]?.ParsedText?.toString() || "";

    // Team guess if not supplied
    if (!team_name) {
      const guess = guessTeamFromText(plain);
      if (guess) team_name = toTitle(guess);
    }
    if (!team_name) team_name = "Unknown";

    // Extract rows
    const rows = parseRows(plain);

    // Existing names in DB to mark DUP
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
      errors: [],
    });
  } catch (err) {
    console.error("OCR preview error:", err?.response?.data || err);
    return res.status(500).json({ error: "Failed to process image" });
  }
});

// ---------- COMMIT ----------
/**
 * POST /api/squads/ocr/commit
 * JSON: { preview_id?, team_name, lineup_type, rows: [ {player_name, role?, bat, bowl} ] }
 * Header (optional): X-User-Id
 */
router.post("/commit", async (req, res) => {
  const { team_name, lineup_type } = req.body || {};
  let rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const userId = req.get("X-User-Id") || null;

  if (!team_name || !lineup_type)
    return res.status(400).json({ error: "team_name and lineup_type are required" });

  // Normalize incoming rows
  rows = rows.map((r) => ({
    player_name: toTitle(r.player_name || ""),
    role: normalizeRole(r.role),
    bat: (r.bat || "").toUpperCase(),
    bowl: (r.bowl || "").toUpperCase(),
  }));

  const created = [];
  const skipped = [];
  const errors = [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const r of rows) {
      // only basic validation; role already defaulted
      if (!validateBasic(r)) {
        skipped.push({ name: r.player_name, reason: "invalid bat/bowl/name" });
        continue;
      }

      const batting_style = batMap[r.bat] || null;
      const bowling_type = bowlMap[r.bowl] || null;
      const skill_type = r.role; // already normalized

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
        userId,
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
