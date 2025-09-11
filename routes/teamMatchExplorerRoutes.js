// C:\cricket-scoreboard-backend\routes\teamMatchExplorerRoutes.js
// Team Match Explorer API (ODI/T20) — SQL-based filtering + pagination

const express = require("express");
const router = express.Router();
const pool = require("../db");

const toInt = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const norm = (s) => (s ?? "").toString().trim();

router.get("/by-team", async (req, res) => {
  try {
    const teamRaw = norm(req.query.team);
    if (!teamRaw) return res.status(400).json({ error: "team is required" });

    const format = norm(req.query.format || "All");           // 'All' | 'ODI' | 'T20'
    const season = req.query.season ? toInt(req.query.season, null) : null;
    const tournament = req.query.tournament ? norm(req.query.tournament) : null;
    const result = (req.query.result || "All").toUpperCase(); // 'All' | 'W' | 'L' | 'D' | 'NR'

    const page = Math.max(1, toInt(req.query.page, 1));
    const pageSize = Math.min(100, Math.max(1, toInt(req.query.pageSize, 20)));
    const offset = (page - 1) * pageSize;

    // --- MAIN DATA QUERY (paged) ------------------------------------------
    const DATA_SQL = `
      WITH norm AS (
        SELECT
          m.*,
          -- normalize format (defensive)
          replace(replace(lower(m.match_type), '-', ''), ' ', '') AS fmt_norm,
          -- extract winner team from phrases like "India won the match!"
          NULLIF(
            btrim(regexp_replace(coalesce(m.winner,''), '\\s*won\\b.*$', '', 'i')),
            ''
          ) AS winner_team
        FROM match_history m
      ),
      base AS (
        SELECT
          n.id AS match_id,
          COALESCE(n.match_date::date, n.created_at::date) AS date,
          n.match_type AS format,
          n.tournament_name AS tournament,
          n.season_year,
          n.match_name,

          CASE WHEN btrim(lower(n.team1)) = btrim(lower($1)) THEN n.team2 ELSE n.team1 END AS opponent,

          CASE WHEN btrim(lower(n.team1)) = btrim(lower($1)) THEN n.runs1    ELSE n.runs2    END AS team_runs,
          CASE WHEN btrim(lower(n.team1)) = btrim(lower($1)) THEN n.wickets1 ELSE n.wickets2 END AS team_wkts,
          CASE WHEN btrim(lower(n.team1)) = btrim(lower($1)) THEN n.overs1   ELSE n.overs2   END AS team_overs,

          CASE WHEN btrim(lower(n.team1)) = btrim(lower($1)) THEN n.runs2    ELSE n.runs1    END AS opp_runs,
          CASE WHEN btrim(lower(n.team1)) = btrim(lower($1)) THEN n.wickets2 ELSE n.wickets1 END AS opp_wkts,
          CASE WHEN btrim(lower(n.team1)) = btrim(lower($1)) THEN n.overs2   ELSE n.overs1   END AS opp_overs,

          CASE
            WHEN n.winner IS NULL OR btrim(n.winner) = '' THEN 'D'
            WHEN lower(n.winner_team) = lower($1)          THEN 'W'
            ELSE 'L'
          END AS result
        FROM norm n
        WHERE
          (btrim(lower(n.team1)) = btrim(lower($1)) OR btrim(lower(n.team2)) = btrim(lower($1)))
          AND ($2 = 'All' OR replace(replace(lower($2), '-', ''), ' ', '') = n.fmt_norm)
          AND ($3::int IS NULL OR n.season_year = $3)
          AND ($4::text IS NULL OR btrim(lower(n.tournament_name)) = btrim(lower($4)))
      ),
      filtered AS (
        SELECT * FROM base
        WHERE (
          $5 = 'All'
          OR ($5 = 'NR' AND result = 'D')  -- treat NR as Draw
          OR result = $5
        )
      )
      SELECT *
      FROM filtered
      ORDER BY date DESC
      LIMIT $6 OFFSET $7;
    `;

    const COUNT_SUMMARY_SQL = `
      WITH norm AS (
        SELECT
          m.*,
          replace(replace(lower(m.match_type), '-', ''), ' ', '') AS fmt_norm,
          NULLIF(
            btrim(regexp_replace(coalesce(m.winner,''), '\\s*won\\b.*$', '', 'i')),
            ''
          ) AS winner_team
        FROM match_history m
      ),
      base AS (
        SELECT
          COALESCE(n.match_date::date, n.created_at::date) AS date,
          CASE
            WHEN n.winner IS NULL OR btrim(n.winner) = '' THEN 'D'
            WHEN lower(n.winner_team) = lower($1)          THEN 'W'
            ELSE 'L'
          END AS result
        FROM norm n
        WHERE
          (btrim(lower(n.team1)) = btrim(lower($1)) OR btrim(lower(n.team2)) = btrim(lower($1)))
          AND ($2 = 'All' OR replace(replace(lower($2), '-', ''), ' ', '') = n.fmt_norm)
          AND ($3::int IS NULL OR n.season_year = $3)
          AND ($4::text IS NULL OR btrim(lower(n.tournament_name)) = btrim(lower($4)))
      ),
      filtered AS (
        SELECT * FROM base
        WHERE (
          $5 = 'All'
          OR ($5 = 'NR' AND result = 'D')
          OR result = $5
        )
      )
      SELECT
        COUNT(*)::int                                             AS total,
        COUNT(*) FILTER (WHERE result = 'W')::int                 AS wins,
        COUNT(*) FILTER (WHERE result = 'L')::int                 AS losses,
        COUNT(*) FILTER (WHERE result = 'D')::int                 AS draws,
        COALESCE(
          (SELECT array_agg(result) FROM (
             SELECT result FROM filtered ORDER BY date DESC LIMIT 5
           ) s),
          ARRAY[]::text[]
        ) AS last5;
    `;

    const FACETS_SEASONS_SQL = `
      SELECT DISTINCT season_year
      FROM match_history
      WHERE btrim(lower(team1)) = btrim(lower($1)) OR btrim(lower(team2)) = btrim(lower($1))
      ORDER BY season_year DESC NULLS LAST;
    `;

    const FACETS_TOURN_SQL = `
      SELECT DISTINCT tournament_name
      FROM match_history
      WHERE btrim(lower(team1)) = btrim(lower($1)) OR btrim(lower(team2)) = btrim(lower($1))
      ORDER BY tournament_name ASC NULLS LAST;
    `;

    const params = [teamRaw, format, season, tournament, result, pageSize, offset];

    const [dataRes, countRes, seasonsRes, tournRes] = await Promise.all([
      pool.query(DATA_SQL, params),
      pool.query(COUNT_SUMMARY_SQL, [teamRaw, format, season, tournament, result]),
      pool.query(FACETS_SEASONS_SQL, [teamRaw]),
      pool.query(FACETS_TOURN_SQL, [teamRaw]),
    ]);

    const matches = dataRes.rows;
    const total = countRes.rows[0]?.total || 0;
    const summary = {
      played: total,
      wins: countRes.rows[0]?.wins || 0,
      losses: countRes.rows[0]?.losses || 0,
      draws: countRes.rows[0]?.draws || 0,
      last5: countRes.rows[0]?.last5 || [],
    };
    const facets = {
      seasons: seasonsRes.rows.map(r => r.season_year).filter(v => v !== null),
      tournaments: tournRes.rows.map(r => r.tournament_name).filter(Boolean),
    };

    return res.json({
      team: teamRaw,
      filters: { format, season, tournament, result },
      facets,
      summary,
      page,
      pageSize,
      total,
      matches,
    });
  } catch (err) {
    console.error("teamMatchExplorerRoutes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
