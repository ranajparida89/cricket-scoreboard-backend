// routes/teamMatchExplorerRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// helpers
const toInt = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const norm = (s) => (s ?? "").toString().trim();

/**
 * GET /api/team-match-explorer/by-team
 * Query params:
 *  - team        (required)
 *  - format      'All' | 'ODI' | 'T20'        (default 'All')
 *  - result      'All' | 'W' | 'L' | 'D' | NR (default 'All', NR maps to draws)
 *  - season      integer or blank
 *  - tournament  exact text match or blank
 *  - page        1+
 *  - pageSize    1..100
 */
router.get("/by-team", async (req, res) => {
  try {
    // ---- read & normalize query params ----
    const team = norm(req.query.team);
    if (!team) return res.status(400).json({ error: "team is required" });

    const format = norm(req.query.format || "All");
    const season =
      req.query.season !== undefined && req.query.season !== null && `${req.query.season}` !== ""
        ? toInt(req.query.season, null)
        : null;
    const tournament = req.query.tournament ? norm(req.query.tournament) : null;
    const result = (req.query.result || "All").toUpperCase(); // 'All' | 'W' | 'L' | 'D' | 'NR'

    const page = Math.max(1, toInt(req.query.page, 1));
    const pageSize = Math.min(100, Math.max(1, toInt(req.query.pageSize, 20)));
    const offset = (page - 1) * pageSize;

    // ---- DATA (paged) ----
    // NOTE: only positional parameters ($1..$N). No WITH params CTE and no sub-selects.
    const DATA_SQL = `
      WITH base AS (
        SELECT
          m.id AS match_id,
          COALESCE(m.match_date::timestamp, NOW())                           AS created_ts,
          TO_CHAR(COALESCE(m.match_date::date, NOW()::date), 'YYYY-MM-DD')  AS date,
          m.match_type                                                      AS format,
          m.tournament_name                                                 AS tournament,
          m.season_year                                                     AS season_year,
          m.match_name                                                      AS match_name,

          CASE WHEN btrim(lower(m.team1)) = btrim(lower($1))
               THEN m.team2 ELSE m.team1 END                                AS opponent,

          CASE WHEN btrim(lower(m.team1)) = btrim(lower($1))
               THEN m.runs1 ELSE m.runs2 END                                AS team_runs,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower($1))
               THEN m.wickets1 ELSE m.wickets2 END                          AS team_wkts,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower($1))
               THEN m.overs1 ELSE m.overs2 END                              AS team_overs,

          CASE WHEN btrim(lower(m.team1)) = btrim(lower($1))
               THEN m.runs2 ELSE m.runs1 END                                AS opp_runs,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower($1))
               THEN m.wickets2 ELSE m.wickets1 END                          AS opp_wkts,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower($1))
               THEN m.overs2 ELSE m.overs1 END                              AS opp_overs,

          CASE
            WHEN COALESCE(btrim(m.winner), '') = ''                        THEN 'D'
            WHEN position('draw'      in lower(COALESCE(m.winner,''))) > 0 THEN 'D'
            WHEN position('no result' in lower(COALESCE(m.winner,''))) > 0 THEN 'D'
            WHEN position(lower($1)   in lower(COALESCE(m.winner,''))) > 0 THEN 'W'
            ELSE 'L'
          END AS result
        FROM match_history m
        WHERE
          (btrim(lower(m.team1)) = btrim(lower($1)) OR btrim(lower(m.team2)) = btrim(lower($1)))
          AND ( lower($2) = 'all'
                OR replace(replace(lower(m.match_type), '-', ''), ' ', '')
                   = replace(replace(lower($2),           '-', ''), ' ', '') )
          AND ( $3::int  IS NULL OR m.season_year = $3::int )
          AND ( $4::text IS NULL OR btrim(lower(m.tournament_name)) = btrim(lower($4)) )
      ),
      filtered AS (
        SELECT * FROM base
        WHERE (
          $5 = 'ALL'
          OR ($5 = 'NR' AND result = 'D')
          OR result = $5
        )
      )
      SELECT
        match_id, date, format, tournament, season_year, match_name, opponent,
        result, team_runs, team_wkts, team_overs, opp_runs, opp_wkts, opp_overs
      FROM filtered
      ORDER BY created_ts DESC
      LIMIT $6::int OFFSET $7::int;
    `;

    // ---- SUMMARY (totals + last5) ----
    const SUMMARY_SQL = `
      WITH base AS (
        SELECT
          COALESCE(m.match_date::timestamp, NOW()) AS created_ts,
          m.match_type                              AS format,
          CASE
            WHEN COALESCE(btrim(m.winner), '') = ''                        THEN 'D'
            WHEN position('draw'      in lower(COALESCE(m.winner,''))) > 0 THEN 'D'
            WHEN position('no result' in lower(COALESCE(m.winner,''))) > 0 THEN 'D'
            WHEN position(lower($1)   in lower(COALESCE(m.winner,''))) > 0 THEN 'W'
            ELSE 'L'
          END AS result
        FROM match_history m
        WHERE
          (btrim(lower(m.team1)) = btrim(lower($1)) OR btrim(lower(m.team2)) = btrim(lower($1)))
          AND ( lower($2) = 'all'
                OR replace(replace(lower(m.match_type), '-', ''), ' ', '')
                   = replace(replace(lower($2),           '-', ''), ' ', '') )
          AND ( $3::int  IS NULL OR m.season_year = $3::int )
          AND ( $4::text IS NULL OR btrim(lower(m.tournament_name)) = btrim(lower($4)) )
      ),
      filtered AS (
        SELECT * FROM base
        WHERE (
          $5 = 'ALL'
          OR ($5 = 'NR' AND result = 'D')
          OR result = $5
        )
      )
      SELECT
        COUNT(*)::int                      AS total,
        SUM((result = 'W')::int)           AS wins,
        SUM((result = 'L')::int)           AS losses,
        SUM((result = 'D')::int)           AS draws,
        ARRAY(SELECT result FROM filtered
              ORDER BY created_ts DESC
              LIMIT 5)                     AS last5;
    `;

    // ---- FACETS (seasons & tournaments) ----
    const FACETS_SEASONS_SQL = `
      SELECT DISTINCT season_year
      FROM match_history
      WHERE btrim(lower(team1)) = btrim(lower($1))
         OR btrim(lower(team2)) = btrim(lower($1))
      ORDER BY season_year DESC NULLS LAST;
    `;
    const FACETS_TOURN_SQL = `
      SELECT DISTINCT tournament_name
      FROM match_history
      WHERE btrim(lower(team1)) = btrim(lower($1))
         OR btrim(lower(team2)) = btrim(lower($1))
      ORDER BY tournament_name ASC NULLS LAST;
    `;

    // params
    const dataParams = [team, format, season, tournament, result, pageSize, offset];
    const sumParams  = [team, format, season, tournament, result];

    // run in parallel
    const [dataRes, sumRes, seasonsRes, tournRes] = await Promise.all([
      pool.query(DATA_SQL, dataParams),
      pool.query(SUMMARY_SQL, sumParams),
      pool.query(FACETS_SEASONS_SQL, [team]),
      pool.query(FACETS_TOURN_SQL,   [team]),
    ]);

    const summaryRow = sumRes.rows[0] || { total: 0, wins: 0, losses: 0, draws: 0, last5: [] };

    res.json({
      team,
      filters: { format, season, tournament, result },
      facets: {
        seasons: seasonsRes.rows.map(r => r.season_year).filter(v => v !== null),
        tournaments: tournRes.rows.map(r => r.tournament_name).filter(Boolean),
      },
      summary: {
        played: summaryRow.total,
        wins: summaryRow.wins,
        losses: summaryRow.losses,
        draws: summaryRow.draws,
        last5: summaryRow.last5 || [],
      },
      page,
      pageSize,
      total: summaryRow.total,
      matches: dataRes.rows,
    });
  } catch (err) {
    console.error("team-match-explorer/by-team error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
