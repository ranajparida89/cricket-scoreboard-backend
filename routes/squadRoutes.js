// C:\cricket-scoreboard-backend\routes\squadRoutes.js
// 14-AUG-2025 — Squad + Lineup APIs with validations, per-format duplicate rule, and suggest fallback
//
// CHANGES (tagged below):
// [CHANGED-1] POST /players duplicate check now enforces uniqueness on (team_name, lineup_type, lower(player_name))
// [CHANGED-2] PUT  /players/:id duplicate check now enforces the same rule, excluding the record itself
// [NEW-1]     POST /lineup validates that all player_ids belong to the same team+format
// [NEW-2]     GET  /suggest uses SIMILARITY when available, otherwise falls back to simple ILIKE ordering

const express = require("express");
const router = express.Router();
const pool = require("../db"); // your pg Pool

function ci(s) { return (s || "").trim(); }

// ---------- PLAYERS ----------

// GET /api/squads/players?team=India&format=ODI
router.get("/players", async (req, res) => {
  try {
    const team = ci(req.query.team);
    const fmt  = ci(req.query.format);
    const { rows } = await pool.query(
      `SELECT id, player_name, team_name, lineup_type, skill_type, bowling_type, batting_style,
              is_captain, is_vice_captain, profile_url
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

    // [NEW-2] Try SIMILARITY first (pg_trgm), fallback to simple ILIKE if extension isn't enabled
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
      // Fallback when SIMILARITY() is missing
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
router.post("/players", async (req, res) => {
  try {
    const { player_name, team_name, lineup_type, skill_type, bowling_type, batting_style, profile_url } = req.body;

    if (!player_name || !team_name || !lineup_type || !skill_type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // [CHANGED-1] CI duplicate check now includes lineup_type (per-format uniqueness)
    const { rows: dup } = await pool.query(
      `SELECT id
         FROM players
        WHERE team_name   = $1
          AND lineup_type = $2
          AND lower(player_name) = lower($3)`,
      [team_name, lineup_type, player_name]
    );
    if (dup.length) {
      return res.status(409).json({ error: "Player already exists in this team & format" });
    }

    const { rows } = await pool.query(
      `INSERT INTO players (player_name, team_name, lineup_type, skill_type, bowling_type, batting_style, profile_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [player_name, team_name, lineup_type, skill_type, bowling_type || null, batting_style || null, profile_url || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("POST /players", e);
    res.status(500).json({ error: "Failed to create player" });
  }
});

// PUT /api/squads/players/:id
router.put("/players/:id", async (req, res) => {
  try {
    const id = +req.params.id;
    const { player_name, team_name, lineup_type, skill_type, bowling_type, batting_style, profile_url } = req.body;

    // [CHANGED-2] CI duplicate check (team+format+name), excluding self
    const { rows: dup } = await pool.query(
      `SELECT id
         FROM players
        WHERE team_name   = $1
          AND lineup_type = $2
          AND lower(player_name) = lower($3)
          AND id <> $4`,
      [team_name, lineup_type, player_name, id]
    );
    if (dup.length) {
      return res.status(409).json({ error: "Another player with this name already exists in this team & format" });
    }

    const { rows } = await pool.query(
      `UPDATE players
          SET player_name=$1, team_name=$2, lineup_type=$3, skill_type=$4,
              bowling_type=$5, batting_style=$6, profile_url=$7
        WHERE id=$8
      RETURNING *`,
      [player_name, team_name, lineup_type, skill_type, bowling_type || null, batting_style || null, profile_url || null, id]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error("PUT /players/:id", e);
    res.status(500).json({ error: "Failed to update player" });
  }
});

// DELETE /api/squads/players/:id
router.delete("/players/:id", async (req, res) => {
  try {
    const id = +req.params.id;
    await pool.query(`DELETE FROM players WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /players/:id", e);
    res.status(500).json({ error: "Failed to delete player" });
  }
});

// ---------- LINEUPS ----------

// GET /api/squads/lineup?team=India&format=ODI
router.get("/lineup", async (req, res) => {
  try {
    const team = ci(req.query.team);
    const fmt  = ci(req.query.format);

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

// POST /api/squads/lineup  (upsert latest)
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
    const { rows: chk } = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM players
        WHERE id = ANY($1)
          AND team_name   = $2
          AND lineup_type = $3`,
      [ids, team_name, lineup_type]
    );
    if (chk[0].n !== ids.length) {
      throw new Error("All players must belong to the same team and format");
    }

    const insHead = await client.query(
      `INSERT INTO team_lineups (team_name, lineup_type, captain_player_id, vice_captain_player_id)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [team_name, lineup_type, captain_player_id, vice_captain_player_id]
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
