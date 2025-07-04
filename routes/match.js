// routes/match.js
// 10-JULY-2025: Unified match approval system using match_history/test_match_results only

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAdminAuth } = require('./auth');

// Helper
function safeStr(str) {
  return (str || '').toString().trim();
}

function validateMatch(data) {
  const errors = [];
  const reasons = [];
  let suspicious = false;
  // Required
  const required = [
    "match_type", "team1", "team2", "match_date", "runs1", "wickets1", "runs2", "wickets2", "winner"
  ];
  for (const field of required) {
    if (!data[field] || data[field].toString().trim() === "") errors.push(field + " is required");
  }
  if (errors.length) return { valid: false, reasons: ['incomplete'], errors };

  // Score checks, you can add more here
  if ((safeStr(data.match_type).toUpperCase() === "T20") && (Number(data.runs1) > 400 || Number(data.runs2) > 400))
    suspicious = true, reasons.push("suspicious_score");
  if (safeStr(data.team1).toUpperCase() === safeStr(data.team2).toUpperCase())
    suspicious = true, reasons.push("same_team");

  if (suspicious)
    return { valid: false, reasons, errors: ["Suspicious or incomplete."] };

  return { valid: true, reasons: [] };
}

// Check duplicate for each table
async function isDuplicate(pool, table, data) {
  const { match_type, team1, team2, match_date } = data;
  const sql = `
    SELECT id FROM ${table}
     WHERE match_type = $1 AND team1 = $2 AND team2 = $3 AND match_date = $4 AND status = 'approved'
     LIMIT 1`;
  const result = await pool.query(sql, [
    safeStr(match_type), safeStr(team1), safeStr(team2), safeStr(match_date)
  ]);
  return result.rows.length > 0;
}

// POST /api/match/submit
router.post('/submit', async (req, res) => {
  const data = req.body;
  const ip = req.ip;
  const { match_type } = data;
  let table = null;

  // Decide table
  if (safeStr(match_type).toUpperCase() === "TEST")
    table = "test_match_results";
  else
    table = "match_history";

  // Validate
  const v = validateMatch(data);

  // Duplicate?
  const duplicate = await isDuplicate(pool, table, data);

  // Status logic
  let status = "approved", auto_flag_reason = null, is_duplicate = false;
  if (!v.valid) status = "pending", auto_flag_reason = v.reasons.join(","), is_duplicate = false;
  if (duplicate) status = "pending", auto_flag_reason = "duplicate", is_duplicate = true;

  try {
    // Only insert new pending/approved, do not mass update!
    const cols = [
      "match_type", "team1", "team2", "match_date", "runs1", "wickets1", "runs2", "wickets2",
      "winner", "status", "auto_flag_reason", "is_duplicate", "submitter_ip"
    ];
    // For ODI/T20 also insert "match_name" if present
    if (table === "match_history" && data.match_name) cols.splice(3, 0, "match_name");

    // Prepare values
    const values = cols.map(col => data[col] || null);
    values[cols.indexOf("status")] = status;
    values[cols.indexOf("auto_flag_reason")] = auto_flag_reason;
    values[cols.indexOf("is_duplicate")] = is_duplicate;
    values[cols.indexOf("submitter_ip")] = ip;

    // Insert
    const qcols = cols.map((c, i) => `$${i+1}`).join(",");
    const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${qcols}) RETURNING *`;
    const result = await pool.query(sql, values);
    res.json({ status, match: result.rows[0] });
  } catch (e) {
    res.status(500).json({ status: "error", error: e.message });
  }
});

// GET /api/match/pending (admin only, both tables)
router.get('/pending', requireAdminAuth, async (req, res) => {
  const q1 = pool.query(`SELECT *, 'ODI/T20' as match_format FROM match_history WHERE status = 'pending'`);
  const q2 = pool.query(`SELECT *, 'Test' as match_format FROM test_match_results WHERE status = 'pending'`);
  const [r1, r2] = await Promise.all([q1, q2]);
  // Merge both, order by created_at (if present)
  const pending = [...r1.rows, ...r2.rows].sort((a, b) => 
    new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  res.json({ pending });
});

// PATCH /api/match/approve/:table/:id
router.patch('/approve/:table/:id', requireAdminAuth, async (req, res) => {
  const { table, id } = req.params;
  if (!["match_history", "test_match_results"].includes(table))
    return res.status(400).json({ error: "Invalid table" });
  const sql = `UPDATE ${table} SET status='approved', auto_flag_reason=NULL, updated_at=NOW() WHERE id = $1 RETURNING *`;
  const result = await pool.query(sql, [id]);
  if (!result.rows.length) return res.status(404).json({ error: "Not found" });
  res.json({ status: "approved", match: result.rows[0] });
});

// PATCH /api/match/deny/:table/:id
router.patch('/deny/:table/:id', requireAdminAuth, async (req, res) => {
  const { table, id } = req.params;
  const { reason } = req.body;
  if (!["match_history", "test_match_results"].includes(table))
    return res.status(400).json({ error: "Invalid table" });
  const sql = `UPDATE ${table} SET status='denied', auto_flag_reason=$2, updated_at=NOW() WHERE id = $1 RETURNING *`;
  const result = await pool.query(sql, [id, safeStr(reason) || 'manual_deny']);
  if (!result.rows.length) return res.status(404).json({ error: "Not found" });
  res.json({ status: "denied", match: result.rows[0] });
});

// GET /api/match/list (all approved, both tables)
router.get('/list', async (req, res) => {
  const q1 = pool.query(`SELECT *, 'ODI/T20' as match_format FROM match_history WHERE status = 'approved'`);
  const q2 = pool.query(`SELECT *, 'Test' as match_format FROM test_match_results WHERE status = 'approved'`);
  const [r1, r2] = await Promise.all([q1, q2]);
  const matches = [...r1.rows, ...r2.rows].sort((a, b) => 
    new Date(b.match_date || 0) - new Date(a.match_date || 0)
  );
  res.json({ matches });
});

module.exports = router;
