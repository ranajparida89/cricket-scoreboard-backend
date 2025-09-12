// routes/teamMatchExplorerRoutes.js
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

    const format = norm(req.query.format || "All");  // 'All' | 'ODI' | 'T20'
    const season = req.query.season ? toInt(req.query.season, null) : null;
    const tournament = req.query.tournament ? norm(req.query.tournament) : null;
    const result = (req.query.result || "All").toUpperCase(); // 'All' | 'W' | 'L' | 'D' | 'NR'

    const page = Math.max(1, toInt(req.query.page, 1));
    const pageSize = Math.min(100, Math.max(1, toInt(req.query.pageSize, 20)));
    const offset = (page - 1) * pageSize;

    // ---------- DATA (paged) ----------
    const DATA_SQL = `
      WITH base AS (
        SELECT
          m.id AS match_id,
          -- use created_at as the ordering timestamp (safe)
          COALESCE(m.created_at::timestamp, now()) AS created_ts,
          -- plain 'YYYY-MM-DD' string for display
          to_char(COALESCE(m.created_at::timestamp, now()), 'YYYY-MM-DD') AS date,
          m.match_type AS format,
          m.tournament_name AS tournament,
          m.season_year,
          m.match_name,

          CASE WHEN btrim(lower(m.team1)) = btrim(lower(CAST($1 AS text))) THEN m.team2 ELSE m.team1 END AS opponent,

          CASE WHEN btrim(lower(m.team1)) = btrim(lower(CAST($1 AS text))) THEN m.runs1    ELSE m.runs2    END AS team_runs,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower(CAST($1 AS text))) THEN m.wickets1 ELSE m.wickets2 END AS team_wkts,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower(CAST($1 AS text))) THEN m.overs1   ELSE m.overs2   END AS team_overs,

          CASE WHEN btrim(lower(m.team1)) = btrim(lower(CAST($1 AS text))) THEN m.runs2    ELSE m.runs1    END AS opp_runs,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower(CAST($1 AS text))) THEN m.wickets2 ELSE m.wickets1 END AS opp_wkts,
          CASE WHEN btrim(lower(m.team1)) = btrim(lower(CAST($1 AS text))) THEN m.overs2   ELSE m.overs1   END AS opp_overs,

          CASE
            WHEN m.winner IS NULL OR btrim(m.winner) = ''
                 OR position('draw' in lower(m.winner)) > 0
                 OR position('no result' in lower(m.winner)) > 0
              THEN 'D'
            WHEN position(lower(CAST($1 AS text)) in lower(m.winner)) > 0
              THEN 'W'
            ELSE 'L'
          END AS result
        FROM match_history m
        WHERE
          (btrim(lower(m.team1)) = btrim(lower(CAST($1 AS text)))
           OR btrim(lower(m.team2)) = btrim(lower(CAST($1 AS text))))
          AND ($2::text = 'All' OR lower(m.match_type) = lower($2::text))
          AND ($3::int IS NULL OR m.season_year = $3::int)
          AND ($4::text IS NULL OR btrim(lower(m.tournament_name)) = btrim(lower($4::text)))
      ),
      filtered AS (
        SELECT * FROM base
        WHERE (
          $5::text = 'All'
          OR ($5::text = 'NR' AND result = 'D')
          OR result = $5::text
        )
      )
      SELECT *
      FROM filtered
      ORDER BY created_ts DESC
      LIMIT $6 OFFSET $7;
    `;

    // ---------- SUMMARY (counts + last5) ----------
    const COUNT_SUMMARY_SQL = `
      WITH base AS (
        SELECT
          COALESCE(m.created_at::timestamp, now()) AS created_ts,
          CASE
            WHEN m.winner IS NULL OR btrim(m.winner) = ''
                 OR position('draw' in lower(m.winner)) > 0
                 OR position('no result' in lower(m.winner)) > 0
              THEN 'D'
            WHEN position(lower(CAST($1 AS text)) in lower(m.winner)) > 0
              THEN 'W'
            ELSE 'L'
          END AS result
        FROM match_history m
        WHERE
          (btrim(lower(m.team1)) = btrim(lower(CAST($1 AS text)))
           OR btrim(lower(m.team2)) = btrim(lower(CAST($1 AS text))))
          AND ($2::text = 'All' OR lower(m.match_type) = lower($2::text))
          AND ($3::int IS NULL OR m.season_year = $3::int)
          AND ($4::text IS NULL OR btrim(lower(m.tournament_name)) = btrim(lower($4::text)))
      ),
      filtered AS (
        SELECT * FROM base
        WHERE (
          $5::text = 'All'
          OR ($5::text = 'NR' AND result = 'D')
          OR result = $5::text
        )
      )
      SELECT
        COUNT(*)::int                                     AS total,
        COUNT(*) FILTER (WHERE result = 'W')::int         AS wins,
        COUNT(*) FILTER (WHERE result = 'L')::int         AS losses,
        COUNT(*) FILTER (WHERE result = 'D')::int         AS draws,
        COALESCE(
          (SELECT array_agg(result) FROM (
             SELECT result FROM filtered ORDER BY created_ts DESC LIMIT 5
           ) s),
          ARRAY[]::text[]
        ) AS last5;
    `;

    const FACETS_SEASONS_SQL = `
      SELECT DISTINCT season_year
      FROM match_history
      WHERE btrim(lower(team1)) = btrim(lower(CAST($1 AS text)))
         OR btrim(lower(team2)) = btrim(lower(CAST($1 AS text)))
      ORDER BY season_year DESC NULLS LAST;
    `;

    const FACETS_TOURN_SQL = `
      SELECT DISTINCT tournament_name
      FROM match_history
      WHERE btrim(lower(team1)) = btrim(lower(CAST($1 AS text)))
         OR btrim(lower(team2)) = btrim(lower(CAST($1 AS text)))
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

    res.json({
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
