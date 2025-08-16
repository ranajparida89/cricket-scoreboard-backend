// ✅ routes/upcomingMatchRoutes.js
// ✅ [Ranaj Parida | CrickEdge - Advanced Match Scheduler | 30-Apr-2025]

const express = require("express");
const router = express.Router();
const pool = require("../db");

// --- helpers -------------------------------------------------
function normalizeTeamName(name) {
  const n = (name || "").trim().toLowerCase();
  if (["ind", "india"].includes(n)) return "India";
  if (["aus", "australia"].includes(n)) return "Australia";
  if (["pak", "pakistan"].includes(n)) return "Pakistan";
  if (["eng", "england"].includes(n)) return "England";
  if (["sa", "rsa", "south africa"].includes(n)) return "South Africa";
  if (["sl", "sri lanka"].includes(n)) return "Sri Lanka";
  if (["nz", "new zealand"].includes(n)) return "New Zealand";
  if (["ban", "bangladesh"].includes(n)) return "Bangladesh";
  if (["afg", "afghanistan"].includes(n)) return "Afghanistan";
  if (["wi", "west indies"].includes(n)) return "West Indies";
  if (["zim", "zimbabwe"].includes(n)) return "Zimbabwe";
  if (["ire", "ireland"].includes(n)) return "Ireland";
  if (["ned", "netherlands"].includes(n)) return "Netherlands";
  if (["nam", "namibia"].includes(n)) return "Namibia";
  if (["sco", "scotland"].includes(n)) return "Scotland";
  if (["uae"].includes(n)) return "UAE";
  if (["usa"].includes(n)) return "USA";
  return (name || "").trim();
}

// Accept DD-MM-YYYY and convert to YYYY-MM-DD
function toISODateMaybe(d) {
  const s = (d || "").toString().trim().replace(/\//g, "-");
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

function normalizeModel(m) {
  const match = { ...m };

  // enums (case-insensitive, normalized)
  const typeU = (match.match_type || "").toString().trim().toUpperCase();
  match.match_type = typeU === "TEST" ? "Test" : typeU; // keep ODI/T20 upper, Test title-cased

  const statusU = (match.match_status || "").toString().trim().toUpperCase();
  match.match_status =
    statusU === "POSTPONED" ? "Postponed" :
    statusU === "CANCELLED" ? "Cancelled" :
    "Scheduled";

  const dnU = (match.day_night || "").toString().trim().toUpperCase();
  match.day_night = dnU === "NIGHT" ? "Night" : "Day";

  // date normalization
  match.match_date = toISODateMaybe(match.match_date);

  // normalize teams
  match.team_1 = normalizeTeamName(match.team_1);
  match.team_2 = normalizeTeamName(match.team_2);

  // defaults
  if (!match.match_name) match.match_name = `${match.team_1} vs ${match.team_2}`;
  if (!match.created_by) match.created_by = "system@crickedge";

  return match;
}

function validateUpcomingMatch(match) {
  const required = [
    "match_name", "match_type", "team_1", "team_2",
    "location", "match_date", "match_time",
    "match_status", "day_night", "created_by"
  ];
  for (const f of required) {
    if (!match[f] || String(match[f]).trim() === "") {
      return `Missing or empty required field: ${f}`;
    }
  }
  const allowedTypes = ["ODI", "T20", "Test"];
  const allowedStatuses = ["Scheduled", "Postponed", "Cancelled"];
  const allowedDN = ["Day", "Night"];
  if (!allowedTypes.includes(match.match_type)) return "Invalid match_type";
  if (!allowedStatuses.includes(match.match_status)) return "Invalid match_status";
  if (!allowedDN.includes(match.day_night)) return "Invalid day_night";
  return null;
}

// --- routes --------------------------------------------------

// POST /api/upcoming-match
router.post("/upcoming-match", async (req, res) => {
  try {
    const match = normalizeModel(req.body);

    const validationError = validateUpcomingMatch(match);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const team_playing = `${match.team_1} vs ${match.team_2}`;

    const result = await pool.query(
      `INSERT INTO upcoming_match_details
       (match_name, match_type, team_1, team_2, location, match_date, match_time,
        series_name, match_status, day_night, created_by, updated_by, team_playing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12)
       RETURNING *`,
      [
        match.match_name.trim(),
        match.match_type,
        match.team_1,
        match.team_2,
        (match.location || "").trim(),
        match.match_date,
        match.match_time,
        match.series_name?.trim() || null,
        match.match_status,
        match.day_night,
        match.created_by,
        team_playing,
      ]
    );

    res.status(201).json({ message: "Match scheduled successfully", data: result.rows[0] });
  } catch (err) {
    console.error("❌ Insert Upcoming Match Error:", {
      message: err.message,
      stack: err.stack,
      requestBody: req.body,
    });
    res.status(500).json({ error: "Something went wrong while scheduling match" });
  }
});

// GET /api/upcoming-matches
router.get("/upcoming-matches", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM upcoming_match_details ORDER BY match_date ASC, match_time ASC`
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Fetch Upcoming Matches Error:", err.message);
    res.status(500).json({ error: "Unable to fetch upcoming matches" });
  }
});

module.exports = router;
