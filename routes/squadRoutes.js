// C:\cricket-scoreboard-backend\routes\squadRoutes.js
// 19-AUG-2025 — Squad + Lineup APIs
//
// FIXES CARRIED OVER FROM YOUR VERSION:
// [USERID-1]  Persist user_id on POST /api/squads/players (read from X-User-Id header or body.user_id)
// [USERID-2]  Backfill user_id on PUT /api/squads/players/:id if row has NULL user_id (non-destructive)
// [SAFEFMT-1] Normalize lineup_type casing ("Test" -> "TEST")
// [CHANGED-1] POST /players duplicate check: (team_name, lineup_type, lower(player_name))
// [CHANGED-2] PUT  /players/:id duplicate check: same rule, excluding self
// [NEW-1]     POST /lineup validates that all player_ids belong to the same team+format
// [NEW-2]     GET  /suggest tries SIMILARITY first, falls back to ILIKE
//
// NEW IN THIS BUILD (to support your requests):
// [TEAMS-1]   GET    /api/squads/teams                   → list teams from teams_master (if present) or fallback to DISTINCT players.team_name
// [TEAMS-2]   POST   /api/squads/teams                   → add a custom team (auto-creates teams_master if missing). CI uniqueness.
// [DELETE-1]  DELETE /api/squads/players/:id             → now **safe**: removes lineup refs, clears C/VC, then deletes
// [DELETE-2]  DELETE /api/squads/players/:id?all=true    → delete the **same named player** in **all formats** of the same team, safe cleanup
// [DELETE-3]  (optional) add ?force=true to also delete player_performance rows referencing the player(s) to satisfy FK
//
// NOTE: These routes are mounted at /api/squads in server.js (no change needed).

const express = require("express");
const router = express.Router();
const pool = require("../db"); // pg Pool

/* ----------------- helpers ----------------- */
function ci(s) { return (s || "").trim(); }
function normFormat(t) {
  const x = String(t || "").toUpperCase();
  if (x === "ODI" || x === "T20" || x === "TEST") return x;
  if (String(t || "") === "Test") return "TEST";
  return "ODI";
}
// Read user id from header or body (header takes precedence)
function getUserId(req) {
  const h = req.header("x-user-id") || req.header("X-User-Id");
  if (h && /^\d+$/.test(String(h))) return parseInt(h, 10);
  const b = req.body?.user_id;
  if (b && /^\d+$/.test(String(b))) return parseInt(b, 10);
  return null;
}

/* ============================================================================
 * TEAMS MASTER
 * ----------------------------------------------------------------------------
 * We support custom teams via a small master list. If the table doesn't exist,
 * we:
 *   - auto-create it on POST,
 *   - fall back to DISTINCT players.team_name on GET.
 * ============================================================================
 */

// [TEAMS-1] GET /api/squads/teams
router.get("/teams", async (_req, res) => {
  try {
    // try teams_master first
    try {
      const { rows } = await pool.query(
        `SELECT id, name
           FROM teams_master
          ORDER BY lower(name)`
      );
      return res.json(rows);
    } catch (err) {
      // undefined_table → fallback to distinct player team names
      if (err?.code !== "42P01") throw err;
      const { rows } = await pool.query(
        `SELECT DISTINCT team_name AS name
           FROM players
          WHERE team_name IS NOT NULL AND team_name <> ''
          ORDER BY lower(team_name)`
      );
      return res.json(rows.map(r => ({ id: null, name: r.name })));
    }
  } catch (e) {
    console.error("[TEAMS-1] GET /teams error:", e);
    res.status(500).json({ error: "Failed to load teams" });
  }
});

// [TEAMS-2] POST /api/squads/teams  { name }
router.post("/teams", async (req, res) => {
  const raw = ci(req.body?.name);
  const creatorId = getUserId(req); // optional "created_by"
  if (!raw) return res.status(400).json({ error: "Team name is required" });

  // ensure table exists
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teams_master (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_by INT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } catch (e) {
    console.error("[TEAMS-2] ensure teams_master failed:", e);
    return res.status(500).json({ error: "Failed to initialise team storage" });
  }

  // uniqueness (CI)
  try {
    const dupe = await pool.query(
      `SELECT 1 FROM teams_master WHERE lower(name) = lower($1)`,
      [raw]
    );
    if (dupe.rows.length) {
      return res.status(409).json({ error: "Team already exists" });
    }

    const ins = await pool.query(
      `INSERT INTO teams_master (name, created_by)
       VALUES ($1, $2) RETURNING id, name`,
      [raw, creatorId || null]
    );
    return res.status(201).json({ team: ins.rows[0] });
  } catch (e) {
    console.error("[TEAMS-2] POST /teams failed:", e);
    return res.status(500).json({ error: "Failed to add team" });
  }
});

/* ============================================================================
 * PLAYERS
 * ========================================================================== */

// GET /api/squads/players?team=India&format=ODI
router.get("/players", async (req, res) => {
  try {
    const team = ci(req.query.team);
    // [SAFEFMT-1] normalize format filter but allow empty (no filter)
    const fmt  = req.query.format ? normFormat(req.query.format) : "";
    const { rows } = await pool.query(
      `SELECT id, player_name, team_name, lineup_type, skill_type, bowling_type, batting_style,
              is_captain, is_vice_captain, profile_url, user_id
         FROM players
        WHERE ($1 = '' OR team_name = $1)
          AND ($2 = '' OR lineup_type = $2)
        ORDER BY lower(player_name)`,
      [team, fmt]
    );
    res.json(rows);
  } catch (e) {
    console.error("GET /players", e);
    res.status(500).json({ error: "Failed to fetch players" });
  }
});

// GET /api/squads/suggest?team=India&q=rohi
router.get("/suggest", async (req, res) => {
  try {
    const team = ci(req.query.team);
    const q = (req.query.q || "").trim();
    if (!q) return res.json([]);

    // Try SIMILARITY first (pg_trgm), fallback to simple ILIKE
    try {
      const { rows } = await pool.query(
        `SELECT player_name, team_name
           FROM players
          WHERE ($1 = '' OR team_name = $1)
            AND player_name ILIKE '%' || $2 || '%'
          ORDER BY SIMILARITY(player_name, $2) DESC, lower(player_name)
          LIMIT 8`,
        [team, q]
      );
      return res.json(rows.map(r => ({ name: r.player_name, team: r.team_name })));
    } catch (err) {
      const { rows } = await pool.query(
        `SELECT player_name, team_name
           FROM players
          WHERE ($1 = '' OR team_name = $1)
            AND player_name ILIKE '%' || $2 || '%'
          ORDER BY lower(player_name)
          LIMIT 8`,
        [team, q]
      );
      return res.json(rows.map(r => ({ name: r.player_name, team: r.team_name })));
    }
  } catch (e) {
    console.error("GET /suggest", e);
    res.status(500).json({ error: "Failed to suggest" });
  }
});

// POST /api/squads/players  (create)
// [USERID-1] Persist user_id so later performance inserts can resolve it.
router.post("/players", async (req, res) => {
  try {
    const {
      player_name,
      team_name,
      lineup_type,
      skill_type,
      bowling_type,
      batting_style,
      profile_url
    } = req.body;

    if (!player_name || !team_name || !lineup_type || !skill_type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const fmt = normFormat(lineup_type);
    const userId = getUserId(req); // header or body; optional but preferred

    // [CHANGED-1] CI duplicate check now includes lineup_type (per-format uniqueness)
    const { rows: dup } = await pool.query(
      `SELECT id
         FROM players
        WHERE team_name   = $1
          AND lineup_type = $2
          AND lower(player_name) = lower($3)`,
      [team_name, fmt, player_name]
    );
    if (dup.length) {
      return res.status(409).json({ error: "Player already exists in this team & format" });
    }

    // Insert (now including user_id)
    const { rows } = await pool.query(
      `INSERT INTO players
        (player_name, team_name, lineup_type, skill_type, bowling_type, batting_style, profile_url, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        player_name,
        team_name,
        fmt,
        skill_type,
        bowling_type || null,
        batting_style || null,
        profile_url || null,
        userId || null
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("POST /players", e);
    res.status(500).json({ error: "Failed to create player" });
  }
});

// PUT /api/squads/players/:id
// [USERID-2] Backfill user_id if the row currently has NULL user_id; do not overwrite a non-null value.
router.put("/players/:id", async (req, res) => {
  try {
    const id = +req.params.id;
    const {
      player_name,
      team_name,
      lineup_type,
      skill_type,
      bowling_type,
      batting_style,
      profile_url
    } = req.body;

    const fmt = normFormat(lineup_type);
    const userId = getUserId(req); // header/body; optional

    // [CHANGED-2] CI duplicate check (team+format+name), excluding self
    const { rows: dup } = await pool.query(
      `SELECT id
         FROM players
        WHERE team_name   = $1
          AND lineup_type = $2
          AND lower(player_name) = lower($3)
          AND id <> $4`,
      [team_name, fmt, player_name, id]
    );
    if (dup.length) {
      return res.status(409).json({ error: "Another player with this name already exists in this team & format" });
    }

    // Update core fields; backfill user_id only if currently NULL
    const { rows } = await pool.query(
      `UPDATE players
          SET player_name  = $1,
              team_name    = $2,
              lineup_type  = $3,
              skill_type   = $4,
              bowling_type = $5,
              batting_style= $6,
              profile_url  = $7,
              user_id      = COALESCE(user_id, $8) -- backfill only when NULL
        WHERE id = $9
      RETURNING *`,
      [
        player_name,
        team_name,
        fmt,
        skill_type,
        bowling_type || null,
        batting_style || null,
        profile_url || null,
        userId || null,
        id
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error("PUT /players/:id", e);
    res.status(500).json({ error: "Failed to update player" });
  }
});

/* ============================================================================
 * SAFE DELETES
 * - We remove lineup references and clear C/VC pointers before deleting.
 * - "all=true" deletes the player's name across ALL formats for the SAME team.
 * - "force=true" additionally deletes any player_performance rows referencing
 *    the player(s) to satisfy FK constraints (use with care).
 * ========================================================================== */

// internal helper: remove a single players.id safely from lineups (+ optional perf)
async function safeRemoveSinglePlayer(client, playerId, { forcePerf = false } = {}) {
  // Clear captain/vice pointers where this player is referenced
  await client.query(
    `UPDATE team_lineups
        SET captain_player_id = CASE WHEN captain_player_id = $1 THEN NULL ELSE captain_player_id END,
            vice_captain_player_id = CASE WHEN vice_captain_player_id = $1 THEN NULL ELSE vice_captain_player_id END
      WHERE captain_player_id = $1 OR vice_captain_player_id = $1`,
    [playerId]
  );

  // Remove lineup rows that reference this player
  await client.query(
    `DELETE FROM team_lineup_players WHERE player_id = $1`,
    [playerId]
  );

  // [DELETE-3] optionally remove performances that would block delete via FK
  if (forcePerf) {
    await client.query(`DELETE FROM player_performance WHERE player_id = $1`, [playerId]);
  }

  // Finally delete the player membership row
  await client.query(`DELETE FROM players WHERE id = $1`, [playerId]);
}

// [DELETE-1]/[DELETE-2]/[DELETE-3] DELETE /api/squads/players/:id(?all=true&force=true)
router.delete("/players/:id", async (req, res) => {
  const id = +req.params.id;
  const deleteEverywhere = String(req.query.all || "").toLowerCase() === "true";
  const forcePerf       = String(req.query.force || "").toLowerCase() === "true";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // First, load the target row (for deleteEverywhere scope)
    const rowRes = await client.query(
      `SELECT id, player_name, team_name FROM players WHERE id = $1`,
      [id]
    );
    if (!rowRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Player not found" });
    }

    if (!deleteEverywhere) {
      // single membership delete (safe)
      await safeRemoveSinglePlayer(client, id, { forcePerf });
      await client.query("COMMIT");
      return res.json({
        ok: true,
        mode: "single",
        message: `Player removed from this format${forcePerf ? " (and performances deleted)" : ""}`
      });
    }

    // delete everywhere (same team, same name, across all formats)
    const { player_name, team_name } = rowRes.rows[0];
    const all = await client.query(
      `SELECT id FROM players WHERE lower(player_name) = lower($1) AND team_name = $2`,
      [player_name, team_name]
    );

    for (const r of all.rows) {
      await safeRemoveSinglePlayer(client, r.id, { forcePerf });
    }

    await client.query("COMMIT");
    return res.json({
      ok: true,
      mode: "all",
      message: `Removed '${player_name}' from all ${team_name} squads and lineups${forcePerf ? " (and performances deleted)" : ""}`
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("DELETE /players/:id", e);
    res.status(500).json({ error: "Failed to delete player" });
  } finally {
    client.release();
  }
});

/* ============================================================================
 * LINEUPS
 * ========================================================================== */

// GET /api/squads/lineup?team=India&format=ODI
router.get("/lineup", async (req, res) => {
  try {
    const team = ci(req.query.team);
    const fmt  = req.query.format ? normFormat(req.query.format) : "";

    const { rows: heads } = await pool.query(
      `SELECT id, captain_player_id, vice_captain_player_id
         FROM team_lineups
        WHERE team_name=$1 AND lineup_type=$2
        ORDER BY created_at DESC
        LIMIT 1`,
      [team, fmt]
    );
    if (!heads.length) {
      return res.json({ lineup: [], captain_id: null, vice_id: null });
    }

    const lineupId = heads[0].id;
    const { rows: items } = await pool.query(
      `SELECT tlp.player_id, tlp.order_no, tlp.is_twelfth,
              p.player_name, p.skill_type, p.batting_style, p.bowling_type, p.profile_url
         FROM team_lineup_players tlp
         JOIN players p ON p.id = tlp.player_id
        WHERE tlp.lineup_id=$1
        ORDER BY tlp.order_no ASC`,
      [lineupId]
    );

    res.json({
      lineup: items,
      captain_id: heads[0].captain_player_id,
      vice_id: heads[0].vice_captain_player_id,
    });
  } catch (e) {
    console.error("GET /lineup", e);
    res.status(500).json({ error: "Failed to fetch lineup" });
  }
});

// POST /api/squads/lineup  (insert a new "latest" lineup)
router.post("/lineup", async (req, res) => {
  const client = await pool.connect();
  try {
    const { team_name, lineup_type, captain_player_id, vice_captain_player_id, players } = req.body;
    // players: [{player_id, order_no, is_twelfth:false}, ...]

    if (!team_name || !lineup_type) {
      return res.status(400).json({ error: "Missing team/format" });
    }
    if (!Array.isArray(players) || players.length < 11 || players.length > 12) {
      return res.status(400).json({ error: "Lineup must have 11 to 12 players" });
    }
    if (!captain_player_id || !vice_captain_player_id || captain_player_id === vice_captain_player_id) {
      return res.status(400).json({ error: "Captain and Vice-captain must be set and different" });
    }

    await client.query("BEGIN");

    // [NEW-1] sanity check: all player_ids belong to the same team+format
    const ids = players.map(p => p.player_id);
    const fmt = normFormat(lineup_type);
    const { rows: chk } = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM players
        WHERE id = ANY($1)
          AND team_name   = $2
          AND lineup_type = $3`,
      [ids, team_name, fmt]
    );
    if (chk[0].n !== ids.length) {
      throw new Error("All players must belong to the same team and format");
    }

    const insHead = await client.query(
      `INSERT INTO team_lineups (team_name, lineup_type, captain_player_id, vice_captain_player_id)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [team_name, fmt, captain_player_id, vice_captain_player_id]
    );
    const lineupId = insHead.rows[0].id;

    const seen = new Set();
    for (const it of players) {
      if (seen.has(it.player_id)) throw new Error("Duplicate player in lineup");
      seen.add(it.player_id);
      await client.query(
        `INSERT INTO team_lineup_players (lineup_id, player_id, order_no, is_twelfth)
         VALUES ($1,$2,$3,$4)`,
        [lineupId, it.player_id, it.order_no, !!it.is_twelfth]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, lineup_id: lineupId });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /lineup", e);
    res.status(500).json({ error: e.message || "Failed to save lineup" });
  } finally {
    client.release();
  }
});

module.exports = router;
