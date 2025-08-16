// routes/upcomingMatchRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db");

const ci = (s) => (s || "").toString().trim();

// --- date/time helpers ---
function toISODate(input) {
  const s = ci(input);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function toPgTime(input) {
  const s = ci(input);
  if (!s) return null;
  if (/^\d{2}:\d{2}$/.test(s)) return `${s}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let hh = parseInt(m[1], 10);
    const mm = m[2];
    const ap = m[3].toUpperCase();
    if (ap === "PM" && hh < 12) hh += 12;
    if (ap === "AM" && hh === 12) hh = 0;
    return `${String(hh).padStart(2, "0")}:${mm}:00`;
  }
  return s;
}

// --- team normalization ---
function normalizeTeamName(name) {
  const n = ci(name).toLowerCase();
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
  return ci(name);
}

// --- validation ---
function validateUpcomingMatch(match) {
  const required = [
    "match_name",
    "match_type",
    "team_1",
    "team_2",
    "location",
    "match_date",
    "match_time",
    "match_status",
    "day_night",
    "created_by",
  ];
  for (const k of required) {
    if (!match[k] || ci(match[k]) === "") return `Missing or empty required field: ${k}`;
  }

  match.match_type = ci(match.match_type).toUpperCase(); // normalize

  const allowedMatchTypes = ["ODI", "T20", "TEST"];
  const allowedStatuses = ["Scheduled", "Postponed", "Cancelled"];
  const allowedDayNight = ["Day", "Night", "Day/Night"];

  if (!allowedMatchTypes.includes(match.match_type)) return "Invalid match_type";
  if (!allowedStatuses.includes(match.match_status)) return "Invalid match_status";
  if (!allowedDayNight.includes(match.day_night)) return "Invalid day_night";
  return null;
}

// --- helpful GET so browser users don't see "Cannot GET" ---
router.get("/upcoming-match", (req, res) => {
  res.json({
    ok: true,
    usage: "POST /api/upcoming-match to create; GET /api/upcoming-matches to list.",
    example_post_body: {
      match_name: "India vs Hongkong",
      match_type: "T20",
      team_1: "India",
      team_2: "Hongkong",
      location: "Adelaide",
      match_date: "18-08-2025",
      match_time: "15:00",
      series_name: "Triangular Series 2025",
      match_status: "Scheduled",
      day_night: "Day",
      created_by: "admin@crickedge"
    }
  });
});

// --- create ---
router.post("/upcoming-match", async (req, res) => {
  try {
    const match = { ...req.body };

    const v = validateUpcomingMatch(match);
    if (v) return res.status(400).json({ error: v });

    const team1 = normalizeTeamName(match.team_1);
    const team2 = normalizeTeamName(match.team_2);
    const team_playing = `${team1} vs ${team2}`;

    const isoDate = toISODate(match.match_date);
    const pgTime = toPgTime(match.match_time);
    if (!isoDate) return res.status(400).json({ error: "Invalid match_date" });
    if (!pgTime) return res.status(400).json({ error: "Invalid match_time" });

    const createdBy = ci(match.created_by);
    const updatedBy = createdBy;

    const result = await pool.query(
      `INSERT INTO upcoming_match_details
       (match_name, match_type, team_1, team_2, location, match_date, match_time,
        series_name, match_status, day_night, created_by, updated_by, team_playing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        ci(match.match_name),
        match.match_type,        // ODI/T20/TEST
        team1,
        team2,
        ci(match.location),
        isoDate,                 // yyyy-mm-dd
        pgTime,                  // hh:mm:ss
        match.series_name ? ci(match.series_name) : null,
        match.match_status,
        match.day_night,
        createdBy,
        updatedBy,
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
    if (err?.code && err?.detail) return res.status(500).json({ error: `${err.code}: ${err.detail}` });
    res.status(500).json({ error: "Something went wrong while scheduling match" });
  }
});

// --- list ---
router.get("/upcoming-matches", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM upcoming_match_details ORDER BY match_date DESC, match_time DESC`
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Fetch Upcoming Matches Error:", err.message);
    res.status(500).json({ error: "Unable to fetch upcoming matches" });
  }
});

module.exports = router;
