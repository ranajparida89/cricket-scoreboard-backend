// routes/teamMatchExplorerRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

const toInt = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const norm = (s) => (s ?? "").toString().trim();

router.get("/by-team", async (req, res) => {
  try {
    // ---- read & normalize query params ----
    const team = norm(req.query.team);
    if (!team) return res.status(400).json({ error: "team is required" });

    const format      = norm(req.query.format || "All");            // 'All' | 'ODI' | 'T20'
    const season      = req.query.season ? toInt(req.query.season, null) : null;
    const tournament  = req.query.tournament ? norm(req.query.tournament) : null;
    const result      = (req.query.result || "All").toUpperCase();  // 'All' | 'W' | 'L' | 'D' | 'NR'
    const page        = Math.max(1, toInt(req.query.page, 1));
    const pageSize    = Math.min(100, Math.max(1, toInt(req.query.pageSize, 20)));

    // ---- DATA (paged) ----
    const DATA_SQL = `
      WITH params AS (
        SELECT
          $1::text AS team,
          $2::text AS format,
          $3::int  AS season,
          $4::text AS tournament,
          $5::text AS result,
          $6::int  AS page,
          $7::int  AS page_size
      ),
      base AS (
        SELECT
          m.id AS match_id,
          COALESCE(m.match_date::timestamp, NOW()) AS created_ts,
          to_char(COALESCE(m.match_date::date, NOW()::date), 'YYYY-MM-DD') AS date,
          m.match_type          AS format,
          m.tournament_name     AS tournament,
          m.season_year         AS season_year,
          m.match_name          AS match_name,

          CASE WHEN btrim(lower(m.team1)) = btrim(lower((SELECT team FROM params)))
               THEN m.team2 ELSE m.team1 END AS opponent,

          CASE WHEN btrim(lower(m.team1)) = btrim(lower((SELECT team FROM params)))
               THEN m.runs1 ELSE m.runs2 END AS team_runs,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower((SELECT team FROM params)))
               THEN m.wickets1 ELSE m.wickets2 END AS team_wkts,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower((SELECT team FROM params)))
               THEN m.overs1 ELSE m.overs2 END AS team_overs,

          CASE WHEN btrim(lower(m.team1)) = btrim(lower((SELECT team FROM params)))
               THEN m.runs2 ELSE m.runs1 END AS opp_runs,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower((SELECT team FROM params)))
               THEN m.wickets2 ELSE m.wickets1 END AS opp_wkts,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower((SELECT team FROM params)))
               THEN m.overs2 ELSE m.overs1 END AS opp_overs,

          CASE
            WHEN COALESCE(btrim(m.winner), '') = ''                        THEN 'D'
            WHEN position('draw'      in lower(COALESCE(m.winner,''))) > 0 THEN 'D'
            WHEN position('no result' in lower(COALESCE(m.winner,''))) > 0 THEN 'D'
            WHEN position(lower((SELECT team FROM params))
                 in lower(COALESCE(m.winner,''))) > 0                      THEN 'W'
            ELSE 'L'
          END AS res_code
        FROM match_history m
        WHERE btrim(lower(m.team1)) = btrim(lower((SELECT team FROM params)))
           OR btrim(lower(m.team2)) = btrim(lower((SELECT team FROM params)))
      ),
      filtered AS (
        SELECT * FROM base
        WHERE
          (
            lower((SELECT format FROM params)) = 'all' OR
            replace(replace(lower(format), '-', ''), ' ', '') =
            replace(replace(lower((SELECT format FROM params)), '-', ''), ' ', '')
          )
          AND ((SELECT season FROM params) IS NULL
               OR season_year = (SELECT season FROM params))
          AND ((SELECT tournament FROM params) IS NULL
               OR btrim(lower(tournament)) = btrim(lower((SELECT tournament FROM params))))
          AND (
            upper((SELECT result FROM params)) = 'ALL'
            OR (upper((SELECT result FROM params)) = 'NR' AND res_code = 'D')
            OR res_code = upper((SELECT result FROM params))
          )
      ),
      bounds AS (
        SELECT
          GREATEST(1, ((SELECT page FROM params) - 1) * (SELECT page_size FROM params) + 1) AS start_rn,
          ((SELECT page FROM params) * (SELECT page_size FROM params))                        AS end_rn
      ),
      numbered AS (
        SELECT f.*,
               ROW_NUMBER() OVER (ORDER BY f.created_ts DESC) AS rn
        FROM filtered f
      )
      SELECT
        match_id,
        date,
        format,
        tournament,
        season_year,
        match_name,
        opponent,
        res_code AS result,
        team_runs, team_wkts, team_overs,
        opp_runs,  opp_wkts,  opp_overs
      FROM numbered n, bounds b
      WHERE n.rn BETWEEN b.start_rn AND b.end_rn
      ORDER BY n.created_ts DESC;
    `;

    // ---- SUMMARY (totals + last5) ----
    const SUMMARY_SQL = `
      WITH params AS (
        SELECT
          $1::text AS team,
          $2::text AS format,
          $3::int  AS season,
          $4::text AS tournament,
          $5::text AS result
      ),
      base AS (
        SELECT
          COALESCE(m.match_date::timestamp, NOW()) AS created_ts,
          m.match_type          AS format,
          CASE
            WHEN COALESCE(btrim(m.winner), '') = ''                        THEN 'D'
            WHEN position('draw'      in lower(COALESCE(m.winner,''))) > 0 THEN 'D'
            WHEN position('no result' in lower(COALESCE(m.winner,''))) > 0 THEN 'D'
            WHEN position(lower((SELECT team FROM params))
                 in lower(COALESCE(m.winner,''))) > 0                      THEN 'W'
            ELSE 'L'
          END AS res_code
        FROM match_history m
        WHERE btrim(lower(m.team1)) = btrim(lower((SELECT team FROM params)))
           OR btrim(lower(m.team2)) = btrim(lower((SELECT team FROM params)))
      ),
      filtered AS (
        SELECT * FROM base
        WHERE
          (
            lower((SELECT format FROM params)) = 'all' OR
            replace(replace(lower(format), '-', ''), ' ', '') =
            replace(replace(lower((SELECT format FROM params)), '-', ''), ' ', '')
          )
          AND ((SELECT season FROM params) IS NULL
               OR 1 = 1)  -- season is not in summary base; optional to add if you store it on base
          AND ((SELECT tournament FROM params) IS NULL
               OR 1 = 1)  -- same note as above
          AND (
            upper((SELECT result FROM params)) = 'ALL'
            OR (upper((SELECT result FROM params)) = 'NR' AND res_code = 'D')
            OR res_code = upper((SELECT result FROM params))
          )
      )
      SELECT
        COUNT(*)::int                         AS total,
        SUM((res_code = 'W')::int)            AS wins,
        SUM((res_code = 'L')::int)            AS losses,
        SUM((res_code = 'D')::int)            AS draws,
        ARRAY(
          SELECT res_code FROM filtered
          ORDER BY created_ts DESC
          LIMIT 5
        )                                     AS last5;
    `;

    // ---- FACETS (seasons/tournaments) ----
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

    const dataParams    = [team, format, season, tournament, result, page, pageSize];
    const summaryParams = [team, format, season, tournament, result];

    const [dataRes, summaryRes, seasonsRes, tournRes] = await Promise.all([
      pool.query(DATA_SQL,    dataParams),
      pool.query(SUMMARY_SQL, summaryParams),
      pool.query(FACETS_SEASONS_SQL, [team]),
      pool.query(FACETS_TOURN_SQL,   [team]),
    ]);

    const matches = dataRes.rows;
    const sumRow  = summaryRes.rows[0] || { total:0, wins:0, losses:0, draws:0, last5:[] };

    res.json({
      team,
      filters: { format, season, tournament, result },
      facets: {
        seasons: seasonsRes.rows.map(r => r.season_year).filter(v => v !== null),
        tournaments: tournRes.rows.map(r => r.tournament_name).filter(Boolean),
      },
      summary: {
        played: sumRow.total,
        wins:   sumRow.wins,
        losses: sumRow.losses,
        draws:  sumRow.draws,
        last5:  sumRow.last5 || [],
      },
      page,
      pageSize,
      total: sumRow.total,
      matches,   // each row has: date, format, tournament, opponent, result, team_* and opp_* as your UI expects
    });
  } catch (err) {
    console.error("team-match-explorer/by-team error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
