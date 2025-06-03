// ✅ routes/upcomingMatchRoutes.js
// [Multi-User Ready: Only fetch and add matches for current user!]

const express = require("express");
const router = express.Router();
const pool = require("../db");

// -- Helper: Validate required fields
function validateUpcomingMatch(match) {
  const requiredFields = [
    "match_name", "match_type", "team_1", "team_2",
    "location", "match_date", "match_time",
    "match_status", "day_night", "created_by", "user_id" // 🟢 Add user_id required!
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

// -- Helper: Normalize team names
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

// -- POST: Add upcoming match (for current user only)
router.post("/upcoming-match", async (req, res) => {
  try {
    const match = req.body;
    // Validate including user_id
    const validationError = validateUpcomingMatch(match);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    const user_id = match.user_id;
    if (!user_id) {
      return res.status(400).json({ error: "User ID is required." });
    }
    // Normalize teams
    const team1 = normalizeTeamName(match.team_1);
    const team2 = normalizeTeamName(match.team_2);
    const team_playing = `${team1} vs ${team2}`;
    // Insert: include user_id column
    const result = await pool.query(
      `INSERT INTO upcoming_match_details
        (match_name, match_type, team_1, team_2, location, match_date, match_time,
         series_name, match_status, day_night, created_by, updated_by, team_playing, user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13)
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
        match.created_by,
        team_playing,
        user_id // 🟢 Add to DB!
      ]
    );
    res.status(201).json({ message: "Match scheduled successfully", data: result.rows[0] });
  } catch (err) {
    console.error("❌ Insert Upcoming Match Error:", err);
    res.status(500).json({ error: "Something went wrong while scheduling match" });
  }
});

// -- GET: Only fetch matches for current user!
router.get("/upcoming-matches", async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: "User ID required" });
    }
    const result = await pool.query(
      `SELECT * FROM upcoming_match_details WHERE user_id = $1 ORDER BY match_date DESC, match_time DESC`,
      [user_id]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Fetch Upcoming Matches Error:", err.message);
    res.status(500).json({ error: "Unable to fetch upcoming matches" });
  }
});

module.exports = router;
