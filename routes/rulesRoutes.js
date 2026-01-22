// C:\cricket-scoreboard-backend\routes\rulesRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db"); // adjust if your db file name is different

// ==============================
// Middleware: Admin Check
// ==============================
function isAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

// ==============================
// GET ALL RULES (PUBLIC)
// ==============================
// Normal users: View only
// Admin: View
router.get("/rules", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM rules_and_regulations
      ORDER BY rule_number ASC
    `);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching rules", err);
    res.status(500).json({ error: "Failed to fetch rules" });
  }
});

// ==============================
// ADD NEW RULE (ADMIN ONLY)
// ==============================
router.post("/rules", isAdmin, async (req, res) => {
  const {
    rule_number,
    title,
    description,
    category,
    format,
    is_mandatory,
    admin_comment
  } = req.body;

  try {
    await pool.query(`
      INSERT INTO rules_and_regulations (
        id,
        rule_number,
        title,
        description,
        category,
        format,
        is_mandatory,
        rule_status,
        admin_comment,
        created_by,
        created_at
      ) VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5, $6,
        'NEW',
        $7,
        $8,
        NOW()
      )
    `, [
      rule_number,
      title,
      description,
      category,
      format,
      is_mandatory || false,
      admin_comment,
      req.user.username
    ]);

    res.status(201).json({ message: "Rule added successfully" });
  } catch (err) {
    console.error("Error adding rule", err);
    res.status(500).json({ error: "Failed to add rule" });
  }
});

// ==============================
// UPDATE RULE (ADMIN ONLY + HISTORY)
// ==============================
router.put("/rules/:id", isAdmin, async (req, res) => {
  const ruleId = req.params.id;
  const {
    title,
    description,
    category,
    format,
    is_mandatory,
    admin_comment
  } = req.body;

  try {
    await pool.query("BEGIN");

    // 1. Save current rule into history
    await pool.query(`
      INSERT INTO rules_history (
        rule_id,
        rule_number,
        title,
        description,
        category,
        format,
        is_mandatory,
        rule_status,
        admin_comment,
        change_type,
        changed_by,
        changed_at
      )
      SELECT
        id,
        rule_number,
        title,
        description,
        category,
        format,
        is_mandatory,
        rule_status,
        admin_comment,
        'UPDATED',
        $1,
        NOW()
      FROM rules_and_regulations
      WHERE id = $2
    `, [req.user.username, ruleId]);

    // 2. Update rule
    await pool.query(`
      UPDATE rules_and_regulations
      SET
        title = $1,
        description = $2,
        category = $3,
        format = $4,
        is_mandatory = $5,
        rule_status = 'UPDATED',
        admin_comment = $6,
        updated_at = NOW()
      WHERE id = $7
    `, [
      title,
      description,
      category,
      format,
      is_mandatory,
      admin_comment,
      ruleId
    ]);

    await pool.query("COMMIT");

    res.status(200).json({ message: "Rule updated successfully" });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Error updating rule", err);
    res.status(500).json({ error: "Failed to update rule" });
  }
});

// ==============================
// GET RULE HISTORY (ADMIN ONLY)
// ==============================
router.get("/rules/history/:ruleId", isAdmin, async (req, res) => {
  const ruleId = req.params.ruleId;

  try {
    const result = await pool.query(`
      SELECT *
      FROM rules_history
      WHERE rule_id = $1
      ORDER BY changed_at DESC
    `, [ruleId]);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching rule history", err);
    res.status(500).json({ error: "Failed to fetch rule history" });
  }
});

// ==============================
// OPTIONAL: DELETE RULE (ADMIN ONLY)
// ==============================
router.delete("/rules/:id", isAdmin, async (req, res) => {
  const ruleId = req.params.id;

  try {
    await pool.query("BEGIN");

    // Save rule before delete
    await pool.query(`
      INSERT INTO rules_history (
        rule_id,
        rule_number,
        title,
        description,
        category,
        format,
        is_mandatory,
        rule_status,
        admin_comment,
        change_type,
        changed_by
      )
      SELECT
        id,
        rule_number,
        title,
        description,
        category,
        format,
        is_mandatory,
        rule_status,
        admin_comment,
        'DELETED',
        $1
      FROM rules_and_regulations
      WHERE id = $2
    `, [req.user.username, ruleId]);

    await pool.query(`DELETE FROM rules_and_regulations WHERE id = $1`, [ruleId]);

    await pool.query("COMMIT");

    res.status(200).json({ message: "Rule deleted successfully" });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Error deleting rule", err);
    res.status(500).json({ error: "Failed to delete rule" });
  }
});

module.exports = router;