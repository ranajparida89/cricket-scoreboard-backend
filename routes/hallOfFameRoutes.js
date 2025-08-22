// Hall of Fame API: list, stats, filters, meta, upsert with champion bonus

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ---------------- helpers ----------------
const isInt = v => /^\d+$/.test(String(v));
const toInt = v => (isInt(v) ? Number(v) : null);
const toIntArray = (csv) =>
  (csv || "")
    .split(",").map(s => s.trim()).filter(Boolean)
    .map(s => (isInt(s) ? Number(s) : NaN))
    .filter(Number.isInteger);

const bad = (res, msg) => res.status(400).json({ error: msg });

function mkOrderBy(sort = "chron") {
  const dateExpr = `COALESCE(final_date, to_date(season_year::text||'-12-31','YYYY-MM-DD'))`;
  return sort === "recent"
    ? `ORDER BY ${dateExpr} DESC, season_year DESC, tournament_name ASC`
    : `ORDER BY ${dateExpr} ASC, season_year ASC, tournament_name ASC`;
}

function normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYY/MM/DD
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, "-");
  // DD-MM-YYYY or DD/MM/YYYY
  const m = s.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null; // let DB handle if something else
}

// ---------------- LIST ----------------
router.get("/list", async (req, res) => {
  try {
    const ids = toIntArray(req.query.board_ids || (req.query.board_id || ""));
    if (!ids.length) return bad(res, "board_ids (csv) or board_id is required");

    const tournament = (req.query.tournament || "").trim();
    const year = req.query.year ? Number(req.query.year) : null;
    const team = (req.query.team || "").trim();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const sort     = (req.query.sort || "chron").toLowerCase();

    const where = [`board_id = ANY($1::int[])`];
    const params = [ids]; let p = 2;

    if (tournament) { where.push(`lower(btrim(tournament_name)) = lower(btrim($${p++}))`); params.push(tournament); }
    if (year)       { where.push(`season_year = $${p++}`); params.push(year); }
    if (team)       { where.push(`lower(btrim(champion_team)) = lower(btrim($${p++}))`); params.push(team); }
    if (dateFrom)   { where.push(`final_date >= $${p++}`); params.push(dateFrom); }
    if (dateTo)     { where.push(`final_date <= $${p++}`); params.push(dateTo); }

    const q = `
      SELECT id, board_id, match_name, upper(match_type) AS match_type,
             tournament_name, season_year, season_month,
             champion_team, champion_team_id,
             champion_board_id, runner_up_board_id,
             runner_up_team, final_date, remarks, created_at
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

// ---------------- FILTERS (from HOF itself) ----------------
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

// ---------------- META (for Add-Entry dropdowns) ----------------
router.get("/meta", async (_req, res) => {
  try {
    const tournamentsQ = `
      SELECT DISTINCT tournament_name
      FROM public.match_history
      WHERE tournament_name IS NOT NULL AND btrim(tournament_name) <> ''
      ORDER BY tournament_name;
    `;
    const teamsQ = `SELECT id, name FROM public.teams WHERE name IS NOT NULL ORDER BY name;`;
    const boardsQ = `SELECT id, board_name FROM public.board_registration ORDER BY board_name;`;

    const [tRes, teamRes, boardRes] = await Promise.all([
      pool.query(tournamentsQ),
      pool.query(teamsQ),
      pool.query(boardsQ),
    ]);

    res.json({
      tournaments: tRes.rows.map(r => r.tournament_name),
      teams: teamRes.rows,          // [{id, name}]
      boards: boardRes.rows         // [{id, board_name}]
    });
  } catch (e) {
    console.error("hof/meta", e);
    res.status(500).json({ error: "Failed to fetch meta" });
  }
});

// ---------------- STATS (3x+ champions) ----------------
router.get("/stats", async (req, res) => {
  try {
    const ids = toIntArray(req.query.board_ids || (req.query.board_id || ""));
    if (!ids.length) return bad(res, "board_ids (csv) or board_id is required");

    const q = `
      SELECT board_id,
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

// ---------------- UPSERT (with normalized date + bonus award) ----------------
router.post("/upsert", async (req, res) => {
  try {
    let {
      board_id, match_name, match_type, tournament_name, season_year,
      season_month, champion_team, champion_team_id,
      champion_board_id, runner_up_board_id,
      runner_up_team, final_date, remarks
    } = req.body || {};

    const bid = toInt(board_id);
    if (!bid) return bad(res, "board_id (int) required");
    if (!tournament_name) return bad(res, "tournament_name required");
    if (!isInt(season_year)) return bad(res, "season_year (int) required");
    if (!champion_team) return bad(res, "champion_team required");
    if (!match_type) return bad(res, "match_type required");

    const fmt = String(match_type).toUpperCase();
    const yr = Number(season_year);
    const mo = season_month && isInt(season_month) ? Number(season_month) : null;
    const fd = normalizeDate(final_date);
    const champBoard = toInt(champion_board_id) || bid; // default to the selected board
    const runnerBoard = toInt(runner_up_board_id) || null;
    const champTeamId = toInt(champion_team_id) || null;

    // prevent “same team” and “same board” on both sides
    if (runner_up_team && champion_team &&
        runner_up_team.trim().toLowerCase() === champion_team.trim().toLowerCase()) {
      return bad(res, "Runner-up team cannot be the same as Champion team");
    }
    if (runnerBoard && champBoard && runnerBoard === champBoard) {
      return bad(res, "Runner-up board cannot be the same as Champion board");
    }

    const upsertQ = `
      INSERT INTO public.tournament_hall_of_fame
        (board_id, match_name, match_type, tournament_name, season_year, season_month,
         champion_team, champion_team_id, champion_board_id, runner_up_board_id,
         runner_up_team, final_date, remarks)
      VALUES ($1,$2,upper($3),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT ON CONSTRAINT uq_hof_unique
      DO UPDATE SET
        match_name        = EXCLUDED.match_name,
        season_month      = EXCLUDED.season_month,
        champion_team     = EXCLUDED.champion_team,
        champion_team_id  = EXCLUDED.champion_team_id,
        champion_board_id = EXCLUDED.champion_board_id,
        runner_up_board_id= EXCLUDED.runner_up_board_id,
        runner_up_team    = EXCLUDED.runner_up_team,
        final_date        = EXCLUDED.final_date,
        remarks           = EXCLUDED.remarks,
        updated_at        = now()
      RETURNING *;
    `;
    const { rows } = await pool.query(upsertQ, [
      bid, match_name || null, fmt, tournament_name, yr, mo,
      champion_team, champTeamId, champBoard, runnerBoard,
      runner_up_team || null, fd, remarks || null
    ]);
    const saved = rows[0];

    // bonus: 25 (ODI/T20) or 50 (TEST)
    const bonus = fmt === "TEST" ? 50 : 25;
    const awardDate = fd || `${yr}-12-31`;
    const awardQ = `
      INSERT INTO public.board_award_points (board_id, match_type, points, award_date, reason, hof_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (hof_id) DO UPDATE
      SET board_id = EXCLUDED.board_id,
          match_type = EXCLUDED.match_type,
          points = EXCLUDED.points,
          award_date = EXCLUDED.award_date,
          reason = EXCLUDED.reason;
    `;
    await pool.query(awardQ, [champBoard, fmt, bonus, awardDate, "HOF Champion Bonus", saved.id]);

    res.json({ ok: true, item: saved });
  } catch (e) {
    console.error("hof/upsert", e);
    res.status(500).json({ error: "Failed to save Hall of Fame entry" });
  }
});

// ---------------- DELETE ----------------
router.delete("/:id", async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return bad(res, "valid id required");
    await pool.query(`DELETE FROM public.tournament_hall_of_fame WHERE id=$1`, [id]);
    // board_award_points row is removed by FK on hof_id (ON DELETE CASCADE)
    res.json({ ok: true });
  } catch (e) {
    console.error("hof/delete", e);
    res.status(500).json({ error: "Failed to delete Hall of Fame entry" });
  }
});

module.exports = router;
