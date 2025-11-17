// src/routes/performanceRoutes.js
// ✅ Adds bulk endpoint
// ✅ Merges Test 1st+2nd innings
// ✅ Adds double_century
// ✅ Keeps five-wicket counts endpoint

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ----------------- helpers -----------------
const toInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const normType = (t) => {
  const raw = String(t || "");
  const up = raw.toUpperCase();
  if (up === "ODI") return "ODI";
  if (up === "T20") return "T20";
  if (up === "TEST" || raw === "Test") return "Test";
  return "ODI";
};

const YEAR_RE = /(19|20)\d{2}/;
const extractYear = (s = "") => {
  const m = String(s).match(YEAR_RE);
  return m ? Number(m[0]) : null;
};

// 🆕 milestones with double century
function deriveMilestones(score) {
  const s = Number.isFinite(score) ? score : 0;
  const res = {
    fifties: 0,
    hundreds: 0,
    double_century: 0,
  };

  if (s >= 200) {
    res.hundreds = Math.floor(s / 100); // 200 -> 2, 250 -> 2, 300 -> 3
    res.double_century = 1;
  } else if (s >= 100) {
    res.hundreds = 1;
  } else if (s >= 50) {
    res.fifties = 1;
  }

  return res;
}

const getUserIdFromReq = (req) => {
  const h = req.header("x-user-id") || req.header("X-User-Id");
  if (h && /^\d+$/.test(String(h))) return parseInt(h, 10);
  const b = req.body?.user_id;
  if (b && /^\d+$/.test(String(b))) return parseInt(b, 10);
  return null;
};

function buildFiveWMessage({
  wickets_taken,
  runs_given,
  against_team,
  match_type,
}) {
  const wk = Number.isFinite(wickets_taken) ? wickets_taken : 0;
  const rg = Number.isFinite(runs_given) ? runs_given : 0;
  const vs = (against_team || "").trim();
  const mt = (match_type || "").trim();
  const ratio = rg ? ` (${wk}-${rg})` : ` (${wk})`;
  const vsTxt = vs ? ` vs ${vs}` : "";
  const mtTxt = mt ? ` • ${mt}` : "";
  return `🎯 5-wicket haul${ratio}${vsTxt}${mtTxt}`;
}

async function lookupTournamentByMatch(client, { match_id, match_name }) {
  if (match_id) {
    const r = await client.query(
      `
      SELECT tournament_name FROM match_history WHERE match_id = $1 AND tournament_name IS NOT NULL LIMIT 1
      UNION ALL
      SELECT tournament_name FROM test_match_results WHERE match_id = $1 AND tournament_name IS NOT NULL LIMIT 1
      LIMIT 1
    `,
      [match_id]
    );
    if (r.rows[0]?.tournament_name) return r.rows[0].tournament_name;
  }
  if (match_name) {
    const r2 = await client.query(
      `
      SELECT tournament_name FROM match_history WHERE match_name = $1 AND tournament_name IS NOT NULL LIMIT 1
      UNION ALL
      SELECT tournament_name FROM test_match_results WHERE match_name = $1 AND tournament_name IS NOT NULL LIMIT 1
      LIMIT 1
    `,
      [match_name]
    );
    if (r2.rows[0]?.tournament_name) return r2.rows[0].tournament_name;
  }
  return null;
}

async function getDistinctTournaments(client) {
  const sql = `
    SELECT DISTINCT tournament_name
    FROM match_history
    WHERE tournament_name IS NOT NULL AND tournament_name <> ''
    UNION
    SELECT DISTINCT tournament_name
    FROM test_match_results
    WHERE tournament_name IS NOT NULL AND tournament_name <> ''
    ORDER BY 1
  `;
  const { rows } = await client.query(sql);
  return rows.map((r) => r.tournament_name);
}

// ===== tournaments =====
router.get("/tournaments", async (req, res) => {
  try {
    const list = await getDistinctTournaments(pool);
    res.json(list);
  } catch (e) {
    console.error("GET /tournaments failed:", e);
    res.status(500).json({ message: "Failed to load tournaments." });
  }
});

// ---------- shared insert helper ----------
async function insertOnePerformance(client, payload) {
  // player
  const pRes = await client.query(
    `SELECT id, player_name, team_name, user_id
       FROM players
      WHERE id = $1`,
    [payload.player_id]
  );
  if (pRes.rows.length === 0) {
    const err = new Error("Player not found.");
    err.statusCode = 404;
    throw err;
  }
  const playerRow = pRes.rows[0];

  // user_id
  let userId = playerRow.user_id;
  if (userId == null && payload.user_id) {
    const uRes = await client.query(`SELECT 1 FROM users WHERE id = $1`, [
      payload.user_id,
    ]);
    if (uRes.rows.length) {
      await client.query(
        `UPDATE players SET user_id = $1 WHERE id = $2 AND user_id IS NULL`,
        [payload.user_id, playerRow.id]
      );
      userId = payload.user_id;
    }
  }
  if (userId == null) {
    const err = new Error("User ID not found for this player.");
    err.statusCode = 404;
    throw err;
  }

  // tournament + year
  let tournament_name = payload.tournament_name || null;
  if (!tournament_name) {
    tournament_name = await lookupTournamentByMatch(client, {
      match_id: payload.match_id,
      match_name: payload.match_name,
    });
  }
  let season_year =
    payload.season_year ||
    extractYear(tournament_name) ||
    extractYear(payload.match_name) ||
    null;

  // milestones
  const { fifties, hundreds, double_century } = deriveMilestones(
    payload.run_scored
  );

  // 5W
  let is_five_wicket_haul = false;
  let bowling_milestone = null;
  if (payload.wickets_taken >= 5) {
    is_five_wicket_haul = true;
    bowling_milestone =
      payload.bowling_milestone ||
      buildFiveWMessage({
        wickets_taken: payload.wickets_taken,
        runs_given: payload.runs_given,
        against_team: payload.against_team,
        match_type: payload.match_type,
      });
  }

  const insert = await client.query(
    `INSERT INTO player_performance
      (match_name, player_id, team_name, match_type, against_team,
       run_scored, balls_faced, wickets_taken, runs_given,
       fifties, hundreds, double_century,
       dismissed, user_id, tournament_name, season_year,
       is_five_wicket_haul, bowling_milestone)
     VALUES
      ($1,$2,$3,$4,$5,
       $6,$7,$8,$9,
       $10,$11,$12,
       $13,$14,$15,$16,
       $17,$18)
     RETURNING *`,
    [
      String(payload.match_name).trim(),
      payload.player_id,
      String(payload.team_name).trim(),
      normType(payload.match_type),
      String(payload.against_team).trim(),
      toInt(payload.run_scored),
      toInt(payload.balls_faced),
      toInt(payload.wickets_taken),
      toInt(payload.runs_given),
      fifties,
      hundreds,
      double_century,
      (payload.dismissed && String(payload.dismissed).trim()) || "Out",
      toInt(userId),
      tournament_name,
      season_year,
      is_five_wicket_haul,
      bowling_milestone,
    ]
  );
  return insert.rows[0];
}

// ===== single =====
router.post("/player-performance", async (req, res) => {
  res.set("X-Handler", "performanceRoutes");
  const body = req.body;

  try {
    if (
      !body.match_name ||
      !body.player_id ||
      !body.team_name ||
      !body.match_type ||
      !body.against_team
    ) {
      return res.status(400).json({ message: "⚠️ Missing required fields." });
    }

    const row = await insertOnePerformance(pool, {
      ...body,
      user_id: getUserIdFromReq(req) ?? body.user_id,
    });

    return res.status(201).json({
      message: "✅ Player performance saved successfully.",
      data: row,
    });
  } catch (err) {
    console.error("❌ Server error while saving performance:", err);
    return res
      .status(err.statusCode || 500)
      .json({ message: err.message || "❌ Server error occurred." });
  }
});

// ===== bulk =====
router.post("/player-performance/bulk", async (req, res) => {
  const { match, performances } = req.body || {};

  // 🔑 get user_id (for old players where players.user_id is null)
  const userIdFromReq = getUserIdFromReq(req);

  if (!match || !Array.isArray(performances) || performances.length === 0) {
    return res
      .status(400)
      .json({ message: "match + performances[] required." });
  }
  if (!match.match_name || !match.match_type) {
    return res.status(400).json({
      message: "match_name and match_type are required in match.",
    });
  }

  // Ensure match object carries user_id for insertOnePerformance
  const baseMatch = {
    ...match,
    user_id: userIdFromReq ?? match.user_id ?? null,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const mType = normType(match.match_type);
    const aggregated = new Map();

    for (const perf of performances) {
      if (!perf.player_id || !perf.team_name || !perf.against_team) {
        continue;
      }
      const key = `${perf.player_id}|${perf.team_name}`;
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          player_id: perf.player_id,
          team_name: perf.team_name,
          against_team: perf.against_team,
          run_scored: 0,
          balls_faced: 0,
          wickets_taken: 0,
          runs_given: 0,
          dismissed: "Not Out",
        });
      }
      const agg = aggregated.get(key);
      agg.run_scored += toInt(perf.run_scored);
      agg.balls_faced += toInt(perf.balls_faced);
      agg.wickets_taken += toInt(perf.wickets_taken);
      agg.runs_given += toInt(perf.runs_given);
      if (
        perf.dismissed &&
        String(perf.dismissed).toLowerCase() !== "not out"
      ) {
        agg.dismissed = "Out";
      }
    }

    const saved = [];
    for (const [, agg] of aggregated) {
      const row = await insertOnePerformance(client, {
        ...baseMatch, // ✅ now includes user_id
        ...agg,
        match_type: mType,
      });
      saved.push(row);
    }

    await client.query("COMMIT");
    return res.json({
      message: "✅ Bulk player performances saved.",
      inserted: saved.length,
      rows: saved,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ bulk insert failed:", e);
    return res.status(500).json({ message: "Bulk insert failed." });
  } finally {
    client.release();
  }
});

// ===== list =====
router.get("/player-performance", async (req, res) => {
  res.set("X-Handler", "performanceRoutes");
  const result = await pool.query(`
    SELECT
      pp.id,
      pp.match_name,
      p.player_name,
      pp.team_name,
      pp.match_type,
      pp.against_team,
      pp.run_scored,
      pp.balls_faced,
      pp.wickets_taken,
      pp.runs_given,
      pp.fifties,
      pp.hundreds,
      pp.double_century,
      pp.dismissed,
      pp.user_id,
      pp.tournament_name,
      pp.season_year,
      pp.is_five_wicket_haul,
      pp.bowling_milestone
    FROM player_performance pp
    JOIN players p ON p.id = pp.player_id
    ORDER BY pp.id DESC
  `);
  res.json(result.rows);
});

// ===== five-w counts (unchanged logic, just placed here) =====
router.get("/player-performance/fivew-counts", async (req, res) => {
  try {
    const playerId = req.query.player_id ? toInt(req.query.player_id, null) : null;
    const tName    = req.query.tournament_name ? String(req.query.tournament_name) : null;
    const sYear    = req.query.season_year ? toInt(req.query.season_year, null) : null;
    const mTypeRaw = req.query.match_type ? String(req.query.match_type) : null;
    const mType    = mTypeRaw ? normType(mTypeRaw) : null;

    const sql = `
      SELECT
        pp.player_id,
        p.player_name,
        pp.team_name,
        pp.tournament_name,
        pp.season_year,
        pp.match_type,
        COUNT(*) AS fivew_count
      FROM player_performance pp
      JOIN players p ON p.id = pp.player_id
      WHERE pp.is_five_wicket_haul = TRUE
        AND ($1::int  IS NULL OR pp.player_id = $1)
        AND ($2::text IS NULL OR pp.tournament_name = $2)
        AND ($3::int  IS NULL OR pp.season_year = $3)
        AND ($4::text IS NULL OR pp.match_type = $4)
      GROUP BY 1,2,3,4,5,6
      ORDER BY fivew_count DESC, p.player_name ASC
    `;
    const { rows } = await pool.query(sql, [playerId, tName, sYear, mType]);
    res.json(rows);
  } catch (e) {
    console.error("GET /player-performance/fivew-counts failed:", e);
    res.status(500).json({ message: "Failed to load five-wicket counts." });
  }
});

module.exports = router;
