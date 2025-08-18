// ✅ routes/playerRoutes.js
// Purpose: Player CRUD + stats endpoints (NO performance insert here)
// ----------------------------------------------------------------------------------
// CHANGES (Aug-2025):
// [DISABLED-PP] Removed duplicate POST /api/player-performance (now lives in performanceRoutes.js)
// [NORM-TEST]   normFormat now returns 'ODI' | 'T20' | 'Test' to match DB + performanceRoutes
// ----------------------------------------------------------------------------------

const router = require("express").Router();
const pool = require("../db");

/* ----------------- helpers ----------------- */
const toInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

// Normalize to DB’s expected casing: 'ODI' | 'T20' | 'Test'
const normFormat = (t) => {
  const raw = String(t || "");
  const up = raw.toUpperCase();
  if (up === "ODI") return "ODI";
  if (up === "T20") return "T20";
  if (up === "TEST" || raw === "Test") return "Test";
  return "ODI";
};

/* =========================================================
 * POST /api/add-player
 * - Creates a player row WITH user_id
 * - Enforces: max 15 per (team_name, lineup_type, user_id)
 * - Enforces: CI duplicate on (team_name, lineup_type, lower(player_name), user_id)
 * ======================================================= */
router.post("/add-player", async (req, res) => {
  console.log("Received add-player req.body:", req.body);

  const {
    lineup_type,
    player_name,
    team_name,
    skill_type,
    bowling_type,
    batting_style,
    is_captain,
    is_vice_captain,
    user_id, // from frontend
  } = req.body;

  try {
    // Basic validations
    if (!player_name || !team_name || !lineup_type || !skill_type) {
      return res.status(400).json({ error: "Required fields missing" });
    }
    if (!user_id) {
      return res.status(400).json({ error: "User not found. Please login again." });
    }

    const fmt = normFormat(lineup_type);

    // CI duplicate check for same team + format + name + user
    const dup = await pool.query(
      `SELECT 1
         FROM players
        WHERE team_name = $1
          AND lineup_type = $2
          AND lower(player_name) = lower($3)
          AND user_id = $4`,
      [team_name, fmt, player_name, user_id]
    );
    if (dup.rows.length) {
      return res.status(409).json({ error: "Player already exists in this squad for this user." });
    }

    // Limit 15 per team+format+user
    const checkCount = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM players
        WHERE team_name = $1
          AND lineup_type = $2
          AND user_id = $3`,
      [team_name, fmt, user_id]
    );
    if (checkCount.rows[0].n >= 15) {
      return res.status(400).json({ error: "Cannot add more than 15 players to this squad." });
    }

    // Insert
    const result = await pool.query(
      `INSERT INTO players
        (lineup_type, player_name, team_name, skill_type,
         bowling_type, batting_style, is_captain, is_vice_captain, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        fmt,
        player_name,
        team_name,
        skill_type,
        bowling_type || null,
        batting_style || null,
        !!is_captain,
        !!is_vice_captain,
        user_id,
      ]
    );

    return res.json({ message: "Player added successfully", player: result.rows[0] });
  } catch (err) {
    console.error("Add Player Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
 * GET /api/players
 * - Optional filters: user_id, team_name, lineup_type
 * - Ordered by lower(player_name)
 * ======================================================= */
router.get("/players", async (req, res) => {
  try {
    const { user_id, team_name, lineup_type } = req.query;

    const where = [];
    const params = [];

    if (user_id) {
      params.push(user_id);
      where.push(`user_id = $${params.length}`);
    }
    if (team_name) {
      params.push(team_name);
      where.push(`team_name = $${params.length}`);
    }
    if (lineup_type) {
      params.push(normFormat(lineup_type));
      where.push(`lineup_type = $${params.length}`);
    }

    const sql = `
      SELECT *
        FROM players
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY lower(player_name), id DESC`;

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Fetch Players Error:", err);
    return res.status(500).json({ error: "Failed to fetch players" });
  }
});

/* =========================================================
 * ❌ REMOVED: POST /api/player-performance
 * Reason: Single source of truth is routes/performanceRoutes.js
 * (Mounted BEFORE this router in server.js so it wins.)
 * ======================================================= */
// Do not add a handler here. If you want a guard instead, you could add:
// router.post("/player-performance", (_req, res) =>
//   res.status(410).json({ error: "Moved. Use /api/player-performance (performanceRoutes.js)" })
// );

/* =========================================================
 * PUT /api/players/:id
 * ======================================================= */
router.put("/players/:id", async (req, res) => {
  const { id } = req.params;
  const {
    player_name,
    team_name,
    lineup_type,
    skill_type,
    bowling_type,
    batting_style,
    is_captain,
    is_vice_captain,
  } = req.body;

  try {
    // Optional: avoid CI duplicate in same team+format (excluding self)
    if (player_name && team_name && lineup_type) {
      const fmt = normFormat(lineup_type);
      const dup = await pool.query(
        `SELECT 1
           FROM players
          WHERE team_name = $1
            AND lineup_type = $2
            AND lower(player_name) = lower($3)
            AND id <> $4`,
        [team_name, fmt, player_name, id]
      );
      if (dup.rows.length) {
        return res.status(409).json({
          error: "Another player with this name already exists in this team & format",
        });
      }
    }

    const updateQuery = `
      UPDATE players SET
        player_name = $1,
        team_name = $2,
        lineup_type = $3,
        skill_type = $4,
        bowling_type = $5,
        batting_style = $6,
        is_captain = $7,
        is_vice_captain = $8
      WHERE id = $9`;

    await pool.query(updateQuery, [
      player_name,
      team_name,
      normFormat(lineup_type),
      skill_type,
      bowling_type || null,
      batting_style || null,
      !!is_captain,
      !!is_vice_captain,
      id,
    ]);

    return res.json({ message: "Player updated successfully" });
  } catch (err) {
    console.error("Update Player Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
 * DELETE /api/delete-player/:id
 * (kept as-is for existing frontend usage)
 * ======================================================= */
router.delete("/delete-player/:id", async (req, res) => {
  const playerId = req.params.id;
  try {
    await pool.query("DELETE FROM players WHERE id = $1", [playerId]);
    return res.json({ message: "Player deleted successfully" });
  } catch (err) {
    console.error("Delete Player Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
 * PUT /api/update-player  (legacy helper)
 * ======================================================= */
router.put("/update-player", async (req, res) => {
  const { id, player_name, team_name, skill_type, lineup_type } = req.body;

  try {
    const result = await pool.query(
      `UPDATE players
          SET player_name = $1,
              team_name   = $2,
              skill_type  = $3,
              lineup_type = $4
        WHERE id = $5
      RETURNING *`,
      [player_name, team_name, skill_type, normFormat(lineup_type), id]
    );

    return res.json({ message: "Player updated", player: result.rows[0] });
  } catch (err) {
    console.error("Update Player Error:", err);
    return res.status(500).json({ error: "Failed to update player" });
  }
});

/* =========================================================
 * GET /api/player-stats
 * ======================================================= */
router.get("/player-stats", async (req, res) => {
  try {
    const { playerName, teamName, matchType } = req.query;

    let baseQuery = `
      SELECT
        pp.*,
        p.player_name,
        pp.balls_faced,
        ROUND(CASE WHEN pp.balls_faced > 0
                   THEN (pp.run_scored::decimal / pp.balls_faced) * 100
                   ELSE 0 END, 2) AS strike_rate,
        MAX(CASE WHEN LOWER(pp.dismissed) = 'not out' THEN pp.run_scored ELSE pp.run_scored END)
          OVER (PARTITION BY pp.player_id, pp.match_type) AS highest_score,
        CASE WHEN LOWER(pp.dismissed) = 'not out'
             THEN CONCAT(pp.run_scored, '*')
             ELSE pp.run_scored::text
        END AS formatted_run_scored
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE 1=1
    `;

    const params = [];
    if (playerName) {
      params.push(`%${playerName}%`);
      baseQuery += ` AND p.player_name ILIKE $${params.length}`;
    }
    if (teamName) {
      params.push(`%${teamName}%`);
      baseQuery += ` AND pp.team_name ILIKE $${params.length}`;
    }
    if (matchType && matchType !== "All") {
      params.push(normFormat(matchType)); // 'ODI' | 'T20' | 'Test'
      baseQuery += ` AND pp.match_type = $${params.length}`;
    }

    baseQuery += ` ORDER BY pp.created_at DESC`;

    const result = await pool.query(baseQuery, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching player stats:", err);
    return res.status(500).json({ message: "❌ Server error while fetching player stats." });
  }
});

/* =========================================================
 * GET /api/player-stats-summary
 * ======================================================= */
router.get("/player-stats-summary", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        pp.id,
        p.player_name,
        p.team_name,
        pp.match_type,
        pp.match_name,
        pp.against_team,
        pp.run_scored,
        pp.balls_faced,
        pp.wickets_taken,
        pp.runs_given,
        pp.fifties,
        pp.hundreds,
        pp.dismissed AS dismissed_status,
        ROUND(CASE WHEN pp.balls_faced > 0
                   THEN (pp.run_scored::decimal / pp.balls_faced) * 100
                   ELSE 0 END, 2) AS strike_rate,
        MAX(CASE WHEN LOWER(pp.dismissed) = 'not out' THEN pp.run_scored ELSE pp.run_scored END)
          OVER (PARTITION BY pp.player_id, pp.match_type) AS highest_score,
        CASE WHEN LOWER(pp.dismissed) = 'not out'
             THEN CONCAT(pp.run_scored, '*')
             ELSE pp.run_scored::text
        END AS formatted_run_scored,
        COUNT(*) OVER (PARTITION BY pp.player_id) AS total_matches,
        COUNT(*) OVER (PARTITION BY pp.player_id, pp.match_type) AS match_count
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      ORDER BY pp.player_id, pp.id
    `);

    return res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching player stats summary:", err);
    return res.status(500).json({ error: "Server error occurred while fetching stats." });
  }
});

/* =========================================================
 * GET /api/player-matches/:playerName
 * ======================================================= */
router.get("/player-matches/:playerName", async (req, res) => {
  const { playerName } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        pp.*,
        p.player_name,
        p.team_name,
        pp.against_team,
        pp.dismissed,
        ROUND(CASE WHEN pp.balls_faced > 0
                   THEN (pp.run_scored::decimal / pp.balls_faced) * 100
                   ELSE 0 END, 2) AS strike_rate,
        CASE WHEN LOWER(pp.dismissed) = 'not out'
             THEN CONCAT(pp.run_scored, '*')
             ELSE pp.run_scored::text
        END AS formatted_run_scored,
        TO_CHAR(pp.created_at, 'YYYY-MM-DD')       AS match_display_date,
        TRIM(TO_CHAR(pp.created_at, 'FMDay'))      AS match_display_day,
        TRIM(TO_CHAR(pp.created_at, 'HH12:MI AM')) AS match_display_time
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE LOWER(p.player_name) = LOWER($1)
      ORDER BY pp.created_at DESC
      `,
      [playerName]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching player match stats:", err);
    return res.status(500).json({ error: "Server error occurred while fetching match data." });
  }
});

module.exports = router;
