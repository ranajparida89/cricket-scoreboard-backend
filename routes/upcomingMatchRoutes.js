// ✅ routes/upcomingMatchRoutes.js
// ✅ [Ranaj Parida | CrickEdge - Advanced Match Scheduler | 30-Apr-2025]

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Validate required fields before DB insert
function validateUpcomingMatch(match) {
  const requiredFields = [
    "match_name", "match_type", "team_1", "team_2",
    "location", "match_date", "match_time",
    "match_status", "day_night", "created_by_id" // ✅ updated field
  ];

  for (const field of requiredFields) {
    if (!match[field] || match[field].toString().trim() === "") {
      return `Missing or empty required field: ${field}`;
    }
  }

  const allowedMatchTypes = ["ODI", "T20", "Test"];
  const allowedStatuses = ["Scheduled", "Postponed", "Cancelled"];
  const allowedDayNight = ["Day", "Night"];

  if (!allowedMatchTypes.includes(match.match_type)) return "Invalid match_type";
  if (!allowedStatuses.includes(match.match_status)) return "Invalid match_status";
  if (!allowedDayNight.includes(match.day_night)) return "Invalid day_night";

  return null;
}

// ✅ Normalize team names (with more countries)
function normalizeTeamName(name) {
  const n = name.trim().toLowerCase();
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
  return name.trim();
}

// ✅ POST: Add upcoming match
router.post("/upcoming-match", async (req, res) => {
  try {
    console.log("📥 Incoming match data:", req.body);
    const match = req.body;

    // 🔍 Validate
    const validationError = validateUpcomingMatch(match);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const team1 = normalizeTeamName(match.team_1);
    const team2 = normalizeTeamName(match.team_2);
    const team_playing = `${team1} vs ${team2}`;

    // 🔹 Insert with created_by_id for trigger logic (auto-update created_by in DB)
    const result = await pool.query(
      `INSERT INTO upcoming_match_details
       (match_name, match_type, team_1, team_2, location, match_date, match_time,
        series_name, match_status, day_night, created_by_id, created_by, updated_by, team_playing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13)
       RETURNING *`,
      [
        match.match_name.trim(),
        match.match_type,
        team1,
        team2,
        match.location.trim(),
        match.match_date,
        match.match_time,
        match.series_name?.trim() || null,
        match.match_status,
        match.day_night,
        match.created_by_id,  // ✅ user_id (for trigger)
        match.created_by || 'placeholder@system.com', // ✅ fallback email if not provided
        team_playing
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

// ✅ GET: Fetch all upcoming matches
router.get("/upcoming-matches", async (req, res) => {
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
