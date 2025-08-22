// routes/hallOfFameRoutes.js
// Hall of Fame API: list, stats (3x+ champions), filters, upsert, delete

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ---------- helpers ----------
const isInt = v => /^\d+$/.test(String(v));
const toInt = v => (isInt(v) ? Number(v) : null);
const toIntArray = (csv) =>
  (csv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (isInt(s) ? Number(s) : NaN))
    .filter(Number.isInteger);

function bad(res, msg) { return res.status(400).json({ error: msg }); }
function mkOrderBy(sort = "chron") {
  // chron: oldest → newest (Past → Current)
  // recent: newest → oldest
  const dateExpr = `COALESCE(final_date, to_date(season_year::text||'-12-31','YYYY-MM-DD'))`;
  return sort === "recent"
    ? `ORDER BY ${dateExpr} DESC, season_year DESC, tournament_name ASC`
    : `ORDER BY ${dateExpr} ASC, season_year ASC, tournament_name ASC`;
}

// ---------- LIST (supports filters) ----------
router.get("/list", async (req, res) => {
  try {
    const ids = toIntArray(req.query.board_ids || (req.query.board_id || ""));
    if (!ids.length) return bad(res, "board_ids (csv) or board_id is required");

    const tournament = (req.query.tournament || "").trim();
    const year = req.query.year ? Number(req.query.year) : null;
    const team = (req.query.team || "").trim(); // Champion team filter
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const sort     = (req.query.sort || "chron").toLowerCase(); // chron/recent

    const where = [`board_id = ANY($1::int[])`];
    const params = [ids];
    let p = 2;

    if (tournament) {
      where.push(`lower(btrim(tournament_name)) = lower(btrim($${p++}))`);
      params.push(tournament);
    }
    if (year) {
      where.push(`season_year = $${p++}`);
      params.push(year);
    }
    if (team) {
      // filter on CHAMPION team (as requested)
      where.push(`lower(btrim(champion_team)) = lower(btrim($${p++}))`);
      params.push(team);
    }
    if (dateFrom) {
      where.push(`final_date >= $${p++}`);
      params.push(dateFrom);
    }
    if (dateTo) {
      where.push(`final_date <= $${p++}`);
      params.push(dateTo);
    }

    const q = `
      SELECT id, board_id, match_name, upper(match_type) AS match_type,
             tournament_name, season_year, champion_team, runner_up_team,
             final_date, remarks, created_at
      FROM public.tournament_hall_of_fame
      WHERE ${where.join(" AND ")}
      ${mkOrderBy(sort)};
    `;
    const { rows } = await pool.query(q, params);
    res.json({ items: rows });
  } catch (e) {
    console.error("hof/list", e);
    res.status(500).json({ error: "Failed to fetch Hall of Fame list" });
  }
});

// ---------- FILTERS (distinct tournaments, years, teams for selected boards) ----------
router.get("/filters", async (req, res) => {
  try {
    const ids = toIntArray(req.query.board_ids || (req.query.board_id || ""));
    if (!ids.length) return bad(res, "board_ids (csv) or board_id is required");

    const tournamentsQ = `
      SELECT lower(btrim(tournament_name)) AS key,
             max(tournament_name)          AS label,
             COUNT(*)                       AS n
      FROM public.tournament_hall_of_fame
      WHERE board_id = ANY($1::int[])
      GROUP BY lower(btrim(tournament_name))
      ORDER BY label ASC;
    `;
    const yearsQ = `
      SELECT season_year AS year, COUNT(*) AS n
      FROM public.tournament_hall_of_fame
      WHERE board_id = ANY($1::int[])
      GROUP BY season_year
      ORDER BY season_year DESC;
    `;
    // champions list (for the Team filter)
    const teamsQ = `
      SELECT lower(btrim(champion_team)) AS key,
             max(champion_team)          AS label,
             COUNT(*)                    AS titles
      FROM public.tournament_hall_of_fame
      WHERE board_id = ANY($1::int[])
      GROUP BY lower(btrim(champion_team))
      ORDER BY titles DESC, label ASC;
    `;

    const [tRes, yRes, cRes] = await Promise.all([
      pool.query(tournamentsQ, [ids]),
      pool.query(yearsQ, [ids]),
      pool.query(teamsQ, [ids]),
    ]);

    res.json({
      tournaments: tRes.rows,
      years: yRes.rows.map(r => Number(r.year)),
      teams: cRes.rows
    });
  } catch (e) {
    console.error("hof/filters", e);
    res.status(500).json({ error: "Failed to fetch Hall of Fame filters" });
  }
});

// ---------- STATS: how many times champion (>=3) ----------
router.get("/stats", async (req, res) => {
  try {
    const ids = toIntArray(req.query.board_ids || (req.query.board_id || ""));
    if (!ids.length) return bad(res, "board_ids (csv) or board_id is required");

    const q = `
      SELECT
        board_id,
        lower(btrim(champion_team)) AS team_key,
        max(champion_team)          AS champion_team,
        COUNT(*)                    AS titles
      FROM public.tournament_hall_of_fame
      WHERE board_id = ANY($1::int[])
      GROUP BY board_id, lower(btrim(champion_team))
      HAVING COUNT(*) >= 3
      ORDER BY board_id, titles DESC, champion_team ASC;
    `;
    const { rows } = await pool.query(q, [ids]);

    const byBoard = {};
    rows.forEach(r => {
      if (!byBoard[r.board_id]) byBoard[r.board_id] = [];
      byBoard[r.board_id].push({ champion_team: r.champion_team, titles: Number(r.titles) });
    });
    res.json({ byBoard });
  } catch (e) {
    console.error("hof/stats", e);
    res.status(500).json({ error: "Failed to fetch Hall of Fame stats" });
  }
});

// ---------- UPSERT ----------
router.post("/upsert", async (req, res) => {
  try {
    const {
      board_id, match_name, match_type, tournament_name, season_year,
      champion_team, runner_up_team, final_date, remarks
    } = req.body || {};

    const bid = toInt(board_id);
    if (!bid) return bad(res, "board_id (int) required");
    if (!tournament_name) return bad(res, "tournament_name required");
    if (!season_year || !isInt(season_year)) return bad(res, "season_year (int) required");
    if (!champion_team) return bad(res, "champion_team required");
    if (!match_type) return bad(res, "match_type required");

    const q = `
      INSERT INTO public.tournament_hall_of_fame
        (board_id, match_name, match_type, tournament_name, season_year,
         champion_team, runner_up_team, final_date, remarks)
      VALUES ($1,$2,upper($3),$4,$5,$6,$7,$8,$9)
      ON CONFLICT ON CONSTRAINT uq_hof_unique
      DO UPDATE SET
        match_name     = EXCLUDED.match_name,
        champion_team  = EXCLUDED.champion_team,
        runner_up_team = EXCLUDED.runner_up_team,
        final_date     = EXCLUDED.final_date,
        remarks        = EXCLUDED.remarks,
        updated_at     = now()
      RETURNING *;
    `;
    const { rows } = await pool.query(q, [
      bid, match_name || null, match_type, tournament_name, Number(season_year),
      champion_team, runner_up_team || null, final_date || null, remarks || null
    ]);
    res.json({ ok: true, item: rows[0] });
  } catch (e) {
    console.error("hof/upsert", e);
    res.status(500).json({ error: "Failed to save Hall of Fame entry" });
  }
});

// ---------- DELETE ----------
router.delete("/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return bad(res, "valid id required");
    await pool.query(`DELETE FROM public.tournament_hall_of_fame WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("hof/delete", e);
    res.status(500).json({ error: "Failed to delete Hall of Fame entry" });
  }
});

module.exports = router;
