// routes/match.js
// 09-JULY-2025 RANAJ PARIDA -- Full file: Automated match approval + history push

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAdminAuth } = require('./auth');

// -- Helper: Basic sanitization
function safeStr(str) {
  return (str || '').toString().trim();
}

// -- Helper: Validate match submission with advanced rules
function validateMatch(data) {
  const errors = [];
  const reasons = [];
  let suspicious = false;

  // Basic required fields
  const required = [
    "match_type", "team1", "team2", "match_date", "venue",
    "runs1", "wickets1", "runs2", "wickets2", "result"
  ];
  for (const field of required) {
    if (data[field] === undefined || data[field] === null || data[field].toString().trim() === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }
  if (errors.length) return { valid: false, reasons: ['incomplete'], errors };

  // Normalize teams/fields
  const team1 = safeStr(data.team1).toUpperCase();
  const team2 = safeStr(data.team2).toUpperCase();
  const match_type = safeStr(data.match_type).toUpperCase();
  const venue = safeStr(data.venue).toUpperCase();
  const match_date = safeStr(data.match_date);

  // Score plausibility
  const runs1 = Number(data.runs1);
  const runs2 = Number(data.runs2);
  const wickets1 = Number(data.wickets1);
  const wickets2 = Number(data.wickets2);

  // Max values per type
  const typeMax = {
    "T20":   { maxRuns: 400, maxWickets: 10 },
    "ODI":   { maxRuns: 600, maxWickets: 10 },
    "TEST":  { maxRuns: 900, maxWickets: 10 }
  };
  const maxes = typeMax[match_type] || { maxRuns: 1200, maxWickets: 10 };

  // Negative or impossible numbers
  if (runs1 < 0 || runs2 < 0 || wickets1 < 0 || wickets2 < 0) {
    reasons.push("suspicious_score");
    suspicious = true;
  }
  if (runs1 > maxes.maxRuns || runs2 > maxes.maxRuns) {
    reasons.push("suspicious_score");
    suspicious = true;
  }
  if (wickets1 > maxes.maxWickets || wickets2 > maxes.maxWickets) {
    reasons.push("suspicious_wickets");
    suspicious = true;
  }
  if (team1 === team2) {
    reasons.push("suspicious_team");
    suspicious = true;
  }
  if (safeStr(data.result).length < 5) {
    reasons.push("incomplete");
    suspicious = true;
  }

  // -- No errors, but suspicious
  if (suspicious) {
    return { valid: false, reasons, errors: ["Suspicious/incomplete match data."] };
  }
  // -- All OK
  return { valid: true, reasons: [] };
}

// -- Helper: Check for duplicate (now uses all key fields)
async function isDuplicate(pool, data) {
  const result = await pool.query(
    `SELECT id FROM matches
     WHERE match_type = $1
       AND UPPER(team1) = $2
       AND UPPER(team2) = $3
       AND match_date = $4
       AND UPPER(venue) = $5
       AND status = 'approved'
     LIMIT 1`,
    [
      safeStr(data.match_type),
      safeStr(data.team1).toUpperCase(),
      safeStr(data.team2).toUpperCase(),
      safeStr(data.match_date),
      safeStr(data.venue).toUpperCase()
    ]
  );
  return result.rows.length > 0;
}

// -- Rate limit basic in-memory, can replace with Redis/DB later
const recentSubmissions = {};
function isRateLimited(ip) {
  const now = Date.now();
  if (!recentSubmissions[ip]) recentSubmissions[ip] = [];
  recentSubmissions[ip] = recentSubmissions[ip].filter(ts => now - ts < 120 * 1000); // 2 min window
  if (recentSubmissions[ip].length > 8) return true; // limit: 8 per 2 min per IP
  recentSubmissions[ip].push(now);
  return false;
}

/**
 * @route POST /api/match/submit
 * Anyone can submit. Auto-approval if passes all rules.
 */
router.post('/submit', async (req, res) => {
  const ip = req.ip;
  const data = req.body;

  // -- Rate limiting
  if (isRateLimited(ip)) {
    return res.status(429).json({ status: 'pending', review_reason: "suspicious_activity", error: "Too many submissions. Please wait." });
  }

  // -- Validate
  const v = validateMatch(data);
  if (!v.valid) {
    // Suspicious or invalid: Store as pending for admin review
    try {
      const pending = await pool.query(
        `INSERT INTO matches 
          (match_type, team1, team2, match_date, venue, runs1, wickets1, runs2, wickets2, result, status, is_duplicate, auto_flag_reason, submitter_ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',false,$11,$12)
         RETURNING *`,
        [
          safeStr(data.match_type),
          safeStr(data.team1),
          safeStr(data.team2),
          safeStr(data.match_date),
          safeStr(data.venue),
          Number(data.runs1),
          Number(data.wickets1),
          Number(data.runs2),
          Number(data.wickets2),
          safeStr(data.result),
          v.reasons.join(","),
          ip
        ]
      );
      return res.status(400).json({ status: "pending", review_reason: v.reasons.join(','), error: v.errors.join("; "), match: pending.rows[0] });
    } catch (err) {
      return res.status(500).json({ status: "error", error: "Server error. Try again." });
    }
  }

  // -- Duplicate check
  if (await isDuplicate(pool, data)) {
    // Store as pending with duplicate flag
    try {
      const pending = await pool.query(
        `INSERT INTO matches 
          (match_type, team1, team2, match_date, venue, runs1, wickets1, runs2, wickets2, result, status, is_duplicate, auto_flag_reason, submitter_ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',true,'duplicate',$11)
         RETURNING *`,
        [
          safeStr(data.match_type),
          safeStr(data.team1),
          safeStr(data.team2),
          safeStr(data.match_date),
          safeStr(data.venue),
          Number(data.runs1),
          Number(data.wickets1),
          Number(data.runs2),
          Number(data.wickets2),
          safeStr(data.result),
          ip
        ]
      );
      return res.status(409).json({ status: "pending", review_reason: "duplicate", error: "Duplicate match. Sent to admin for review.", match: pending.rows[0] });
    } catch (err) {
      return res.status(500).json({ status: "error", error: "Server error. Try again." });
    }
  }

  // --- If all good, approve and insert
  try {
    const insert = await pool.query(
      `INSERT INTO matches 
        (match_type, team1, team2, match_date, venue, runs1, wickets1, runs2, wickets2, result, status, is_duplicate, auto_flag_reason, submitter_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',false,NULL,$11)
       RETURNING *`,
      [
        safeStr(data.match_type),
        safeStr(data.team1),
        safeStr(data.team2),
        safeStr(data.match_date),
        safeStr(data.venue),
        Number(data.runs1),
        Number(data.wickets1),
        Number(data.runs2),
        Number(data.wickets2),
        safeStr(data.result),
        ip
      ]
    );
    res.json({ status: "approved", match: insert.rows[0] });
  } catch (err) {
    res.status(500).json({ status: "error", error: "Server error. Try again." });
  }
});

// -- GET /api/match/pending (admin only)
router.get('/pending', requireAdminAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM matches WHERE status = 'pending' ORDER BY created_at DESC`
  );
  res.json({ pending: result.rows });
});

/**
 * PATCH /api/match/approve/:id
 * On admin approval, copy match row into correct historical table before marking as approved
 */
router.patch('/approve/:id', requireAdminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);

  try {
    // 1. Get pending match info
    const result = await pool.query('SELECT * FROM matches WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: "Match not found." });
    const match = result.rows[0];

    // Only allow pending matches to be approved
    if (match.status !== 'pending') {
      return res.status(400).json({ error: "Only pending matches can be approved." });
    }

    // 2. Insert into appropriate history table based on match_type
    if (/^test$/i.test(match.match_type)) {
      // --- Insert into test_match_results
      await pool.query(`
        INSERT INTO test_match_results
        (match_type, team1, team2, winner, points, runs1, overs1, wickets1, runs2, overs2, wickets2, match_time, match_name, user_id, created_at)
        VALUES
        ($1, $2, $3, $4, 12, $5, NULL, $6, $7, NULL, $8, $9, $10, $11, NULL, NOW())
      `, [
        match.match_type,
        match.team1,
        match.team2,
        match.result,
        match.runs1,
        match.wickets1,
        match.runs2,
        match.wickets2,
        match.match_date,
        match.match_name || null,
        // user_id: null, created_at auto
      ]);
    } else {
      // --- Insert into match_history (for ODI/T20)
      await pool.query(`
        INSERT INTO match_history
        (match_name, match_type, team1, runs1, wickets1, team2, runs2, wickets2, winner, match_time, user_id, created_at)
        VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NOW())
      `, [
        match.match_name || null,
        match.match_type,
        match.team1,
        match.runs1,
        match.wickets1,
        match.team2,
        match.runs2,
        match.wickets2,
        match.result,
        match.match_date
        // user_id: null, created_at auto
      ]);
    }

    // 3. Approve the match in matches table
    const update = await pool.query(
      `UPDATE matches SET status = 'approved', auto_flag_reason = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    res.json({ status: "approved", match: update.rows[0] });

  } catch (err) {
    console.error("[APPROVE MATCH] Error:", err);
    res.status(500).json({ error: "Failed to approve match." });
  }
});

// -- PATCH /api/match/deny/:id (admin only)
router.patch('/deny/:id', requireAdminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { reason } = req.body;
  const result = await pool.query(
    `UPDATE matches SET status = 'denied', auto_flag_reason = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, safeStr(reason) || 'manual_deny']
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Match not found." });
  res.json({ status: "denied", match: result.rows[0] });
});

// -- GET /api/match/list (anyone can view approved)
router.get('/list', async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM matches WHERE status = 'approved' ORDER BY match_date DESC`
  );
  res.json({ matches: result.rows });
});

module.exports = router;
