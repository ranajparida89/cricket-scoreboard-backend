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
    "match_status", "day_night", "created_by"
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

// ✅ Normalize team names
function normalizeTeamName(name) {
  const n = name.trim().toLowerCase();
  if (n === "ind" || n === "india") return "India";
  if (n === "aus" || n === "australia") return "Australia";
  if (n === "pak" || n === "pakistan") return "Pakistan";
  if (n === "eng" || n === "england") return "England";
  // ... add more as needed
  return name.trim(); // fallback as entered
}

// ✅ POST: Add upcoming match
router.post("/upcoming-match", async (req, res) => {
  try {
    const match = req.body;

    // 🔍 Validate
    const validationError = validateUpcomingMatch(match);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // 🧼 Normalize team names
    const team1 = normalizeTeamName(match.team_1);
    const team2 = normalizeTeamName(match.team_2);

    // 📦 Derive Team Playing string
    const team_playing = `${team1} vs ${team2}`;

    // 📥 Insert into DB
    const result = await pool.query(
      `INSERT INTO upcoming_match_details
       (match_name, match_type, team_1, team_2, location, match_date, match_time,
        series_name, match_status, day_night, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
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
        match.created_by
      ]
    );

    res.status(201).json({ message: "Match scheduled successfully", data: result.rows[0] });

  } catch (err) {
    console.error("Insert Upcoming Match Error:", err.message);
    res.status(500).json({ error: "Something went wrong while scheduling match" });
  }
});

// ✅ GET: Fetch all upcoming matches (to display in sidebar)
router.get("/upcoming-match", async (req, res) => {
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
