// routes/playerReportCardRoutes.js
// =======================================
// Crickedge Player Report Card API
// All sub-modules (tabs) in one route file
// =======================================

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ---------- helpers ----------

// Normalize match type coming from query string
const normType = (raw) => {
  const up = String(raw || "").toUpperCase();
  if (up === "ODI") return "ODI";
  if (up === "T20") return "T20";
  if (up === "TEST") return "Test"; // DB uses "Test"
  return null;
};

// Build WHERE clause & params for optional matchType filter
//  - if ALL or missing => no match_type filter
//  - otherwise => pp.match_type = $N
const buildMatchFilter = (matchTypeRaw, startIndex = 1) => {
  const up = String(matchTypeRaw || "ALL").toUpperCase();
  if (up === "ALL") {
    return { where: "1=1", params: [] };
  }
  const mt = normType(up);
  if (!mt) {
    return { where: "1=1", params: [] };
  }
  return { where: `pp.match_type = $${startIndex}`, params: [mt] };
};

// ======================================================
// 1) Individual Highest Score (ODI by default)
// GET /api/player-report-card/highest-score?matchType=ODI
// ======================================================

router.get("/highest-score", async (req, res) => {
  const mt = normType(req.query.matchType || "ODI") || "ODI";

  const sql = `
    SELECT
      player_name,
      highest_score,
      not_out
    FROM (
      SELECT
        p.player_name,
        pp.run_scored AS highest_score,
        (COALESCE(pp.dismissed, '') NOT ILIKE '%out%') AS not_out,
        ROW_NUMBER() OVER (
          PARTITION BY p.id
          ORDER BY pp.run_scored DESC
        ) AS rn
      FROM player_performance pp
      JOIN players p
        ON pp.player_id = p.id
      WHERE pp.match_type = $1
    ) sub
    WHERE rn = 1
    ORDER BY highest_score DESC, player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql, [mt]);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      score: Number(row.highest_score),
      notOut: row.not_out === true,
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /highest-score:", err);
    res.status(500).json({ error: "Failed to fetch highest scores." });
  }
});

// ======================================================
// 2) Bowling Average (Test by default)
// GET /api/player-report-card/bowling-average?matchType=Test|ODI|T20|ALL
// Best = lowest average
// ======================================================

router.get("/bowling-average", async (req, res) => {
  const matchTypeRaw = req.query.matchType || "Test";
  const { where, params } = buildMatchFilter(matchTypeRaw, 1);

  const sql = `
    SELECT
      p.player_name,
      SUM(pp.runs_given)   AS total_runs_given,
      SUM(pp.wickets_taken) AS total_wickets,
      ROUND(
        SUM(pp.runs_given)::numeric / NULLIF(SUM(pp.wickets_taken), 0),
        2
      ) AS bowling_avg
    FROM player_performance pp
    JOIN players p
      ON pp.player_id = p.id
    WHERE ${where}
    GROUP BY p.player_name
    HAVING SUM(pp.wickets_taken) > 0
    ORDER BY bowling_avg ASC, total_wickets DESC, p.player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      bowlingAvg: row.bowling_avg !== null ? Number(row.bowling_avg) : null,
      totalWickets: Number(row.total_wickets),
      totalRunsGiven: Number(row.total_runs_given),
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /bowling-average:", err);
    res.status(500).json({ error: "Failed to fetch bowling averages." });
  }
});

// ======================================================
// 3 & 7) Most Wickets (combined / per format)
// GET /api/player-report-card/most-wickets?matchType=ALL|ODI|T20|Test
//   - Used by "Most Wickets" and "Most Wickets (Overall)" tabs
// ======================================================

router.get("/most-wickets", async (req, res) => {
  const matchTypeRaw = req.query.matchType || "ALL";
  const { where, params } = buildMatchFilter(matchTypeRaw, 1);

  const sql = `
    SELECT
      p.player_name,
      SUM(pp.wickets_taken) AS total_wickets
    FROM player_performance pp
    JOIN players p
      ON pp.player_id = p.id
    WHERE ${where}
    GROUP BY p.player_name
    HAVING SUM(pp.wickets_taken) > 0
    ORDER BY total_wickets DESC, p.player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      totalWickets: Number(row.total_wickets),
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /most-wickets:", err);
    res.status(500).json({ error: "Failed to fetch most wickets." });
  }
});

// ======================================================
// 4) Batting Average (combined / per format)
// GET /api/player-report-card/batting-average?matchType=ALL|ODI|T20|Test
// Best = highest average
// ======================================================

router.get("/batting-average", async (req, res) => {
  const matchTypeRaw = req.query.matchType || "ALL";
  const { where, params } = buildMatchFilter(matchTypeRaw, 1);

  const sql = `
    SELECT
      p.player_name,
      SUM(pp.run_scored) AS total_runs,
      COUNT(*)          AS innings,
      SUM(
        CASE
          WHEN COALESCE(pp.dismissed, '') ILIKE '%out%' THEN 1
          ELSE 0
        END
      ) AS outs,
      ROUND(
        SUM(pp.run_scored)::numeric
        / NULLIF(
            SUM(
              CASE
                WHEN COALESCE(pp.dismissed, '') ILIKE '%out%' THEN 1
                ELSE 0
              END
            ),
            0
          ),
        2
      ) AS batting_avg
    FROM player_performance pp
    JOIN players p
      ON pp.player_id = p.id
    WHERE ${where}
    GROUP BY p.player_name
    HAVING SUM(
             CASE
               WHEN COALESCE(pp.dismissed, '') ILIKE '%out%' THEN 1
               ELSE 0
             END
           ) > 0
    ORDER BY batting_avg DESC, total_runs DESC, p.player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      battingAvg:
        row.batting_avg !== null ? Number(row.batting_avg) : null,
      totalRuns: Number(row.total_runs),
      innings: Number(row.innings),
      outs: Number(row.outs),
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /batting-average:", err);
    res.status(500).json({ error: "Failed to fetch batting averages." });
  }
});

// ======================================================
// 5) Top Run Scorers (combined)
// GET /api/player-report-card/top-run-scorers
// ======================================================

router.get("/top-run-scorers", async (_req, res) => {
  const sql = `
    SELECT
      p.player_name,
      SUM(pp.run_scored) AS total_runs
    FROM player_performance pp
    JOIN players p
      ON pp.player_id = p.id
    GROUP BY p.player_name
    HAVING SUM(pp.run_scored) > 0
    ORDER BY total_runs DESC, p.player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      totalRuns: Number(row.total_runs),
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /top-run-scorers:", err);
    res.status(500).json({ error: "Failed to fetch top run scorers." });
  }
});

// ======================================================
// 6) Most Fifties (combined ODI+T20+Test)
// GET /api/player-report-card/most-fifties
// Uses `fifties` column in player_performance
// ======================================================

router.get("/most-fifties", async (_req, res) => {
  const sql = `
    SELECT
      p.player_name,
      SUM(pp.fifties) AS total_fifties
    FROM player_performance pp
    JOIN players p
      ON pp.player_id = p.id
    GROUP BY p.player_name
    HAVING SUM(pp.fifties) > 0
    ORDER BY total_fifties DESC, p.player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      totalFifties: Number(row.total_fifties),
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /most-fifties:", err);
    res.status(500).json({ error: "Failed to fetch most fifties." });
  }
});

// ======================================================
// 7) Most Hundreds (combined ODI+T20+Test)
// GET /api/player-report-card/most-hundreds
// Uses `hundreds` column in player_performance
// ======================================================

router.get("/most-hundreds", async (_req, res) => {
  const sql = `
    SELECT
      p.player_name,
      SUM(pp.hundreds) AS total_hundreds
    FROM player_performance pp
    JOIN players p
      ON pp.player_id = p.id
    GROUP BY p.player_name
    HAVING SUM(pp.hundreds) > 0
    ORDER BY total_hundreds DESC, p.player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      totalHundreds: Number(row.total_hundreds),
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /most-hundreds:", err);
    res.status(500).json({ error: "Failed to fetch most hundreds." });
  }
});

// ======================================================
// 8) Most Ducks (combined)
// GET /api/player-report-card/most-ducks
// duck = 0 runs AND dismissed like '%out%'
// ======================================================

router.get("/most-ducks", async (_req, res) => {
  const sql = `
    SELECT
      p.player_name,
      SUM(
        CASE
          WHEN COALESCE(pp.run_scored, 0) = 0
           AND COALESCE(pp.dismissed, '') ILIKE '%out%'
          THEN 1
          ELSE 0
        END
      ) AS ducks
    FROM player_performance pp
    JOIN players p
      ON pp.player_id = p.id
    GROUP BY p.player_name
    HAVING SUM(
             CASE
               WHEN COALESCE(pp.run_scored, 0) = 0
                AND COALESCE(pp.dismissed, '') ILIKE '%out%'
               THEN 1
               ELSE 0
             END
           ) > 0
    ORDER BY ducks DESC, p.player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      ducks: Number(row.ducks),
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /most-ducks:", err);
    res.status(500).json({ error: "Failed to fetch most ducks." });
  }
});

// ======================================================
// 9) Most Balls Faced in Test
// GET /api/player-report-card/most-balls-faced
// Only Test matches
// ======================================================

router.get("/most-balls-faced", async (_req, res) => {
  const sql = `
    SELECT
      p.player_name,
      SUM(pp.balls_faced) AS total_balls
    FROM player_performance pp
    JOIN players p
      ON pp.player_id = p.id
    WHERE pp.match_type = 'Test'
    GROUP BY p.player_name
    HAVING SUM(pp.balls_faced) > 0
    ORDER BY total_balls DESC, p.player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      totalBalls: Number(row.total_balls),
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /most-balls-faced:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch most balls faced in Test." });
  }
});

// ======================================================
// 10) Most 200s (double hundreds) – from player_performance
// GET /api/player-report-card/most-200s
// Uses player_performance.double_century (Test innings)
// ======================================================

router.get("/most-200s", async (_req, res) => {
  const sql = `
    SELECT
      p.player_name,
      SUM(COALESCE(pp.double_century, 0)) AS total_double_centuries
    FROM player_performance pp
    JOIN players p
      ON pp.player_id = p.id
    -- if you want only Test 200s, keep this line:
    WHERE pp.match_type = 'Test'
    GROUP BY p.player_name
    HAVING SUM(COALESCE(pp.double_century, 0)) > 0
    ORDER BY total_double_centuries DESC, p.player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      doubleCenturies: Number(row.total_double_centuries),
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /most-200s:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch most double centuries." });
  }
});

// ======================================================
// 11) Fastest Fifty
// GET /api/player-report-card/fastest-fifty?matchType=ALL|ODI|T20|Test
// Per player: best (min balls) innings with >= 50 runs
// ======================================================

router.get("/fastest-fifty", async (req, res) => {
  const matchTypeRaw = req.query.matchType || "ALL";
  const { where, params } = buildMatchFilter(matchTypeRaw, 1);

  const sql = `
    SELECT
      player_name,
      runs,
      balls,
      match_type
    FROM (
      SELECT
        p.player_name,
        pp.run_scored AS runs,
        pp.balls_faced AS balls,
        pp.match_type,
        ROW_NUMBER() OVER (
          PARTITION BY p.id
          ORDER BY pp.balls_faced ASC, pp.run_scored DESC
        ) AS rn
      FROM player_performance pp
      JOIN players p
        ON pp.player_id = p.id
      WHERE ${where}
        AND pp.run_scored >= 50
        AND pp.balls_faced > 0
    ) sub
    WHERE rn = 1
    ORDER BY balls ASC, runs DESC, player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      runs: Number(row.runs),
      balls: Number(row.balls),
      matchType: row.match_type,
      strikeRate:
        row.balls > 0
          ? Number(((row.runs * 100.0) / row.balls).toFixed(2))
          : null,
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /fastest-fifty:", err);
    res.status(500).json({ error: "Failed to fetch fastest fifties." });
  }
});

// ======================================================
// 12) Fastest Hundred
// GET /api/player-report-card/fastest-hundred?matchType=ALL|ODI|T20|Test
// ======================================================

router.get("/fastest-hundred", async (req, res) => {
  const matchTypeRaw = req.query.matchType || "ALL";
  const { where, params } = buildMatchFilter(matchTypeRaw, 1);

  const sql = `
    SELECT
      player_name,
      runs,
      balls,
      match_type
    FROM (
      SELECT
        p.player_name,
        pp.run_scored AS runs,
        pp.balls_faced AS balls,
        pp.match_type,
        ROW_NUMBER() OVER (
          PARTITION BY p.id
          ORDER BY pp.balls_faced ASC, pp.run_scored DESC
        ) AS rn
      FROM player_performance pp
      JOIN players p
        ON pp.player_id = p.id
      WHERE ${where}
        AND pp.run_scored >= 100
        AND pp.balls_faced > 0
    ) sub
    WHERE rn = 1
    ORDER BY balls ASC, runs DESC, player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      runs: Number(row.runs),
      balls: Number(row.balls),
      matchType: row.match_type,
      strikeRate:
        row.balls > 0
          ? Number(((row.runs * 100.0) / row.balls).toFixed(2))
          : null,
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /fastest-hundred:", err);
    res.status(500).json({ error: "Failed to fetch fastest hundreds." });
  }
});

// ======================================================
// 13) Highest Strike Rate (min X balls)
// GET /api/player-report-card/highest-strike-rate
//   ?matchType=ALL|ODI|T20|Test
//   &minBalls=250   (optional, default 250)
// ======================================================

router.get("/highest-strike-rate", async (req, res) => {
  const matchTypeRaw = req.query.matchType || "ALL";
  const { where, params } = buildMatchFilter(matchTypeRaw, 1);

  const rawMin = parseInt(req.query.minBalls, 10);
  const minBalls = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : 250;
  const minIdx = params.length + 1;
  params.push(minBalls);

  const sql = `
    SELECT
      p.player_name,
      SUM(pp.run_scored)  AS total_runs,
      SUM(pp.balls_faced) AS total_balls,
      ROUND(
        SUM(pp.run_scored)::numeric
        / NULLIF(SUM(pp.balls_faced), 0)
        * 100,
        2
      ) AS strike_rate
    FROM player_performance pp
    JOIN players p
      ON pp.player_id = p.id
    WHERE ${where}
    GROUP BY p.player_name
    HAVING SUM(pp.balls_faced) >= $${minIdx}
    ORDER BY strike_rate DESC,
             total_runs DESC,
             total_balls DESC,
             p.player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      totalRuns: Number(row.total_runs),
      totalBalls: Number(row.total_balls),
      strikeRate:
        row.strike_rate != null ? Number(row.strike_rate) : null,
      minBalls,
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /highest-strike-rate:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch highest strike rates." });
  }
});

// ======================================================
// 14) Best Bowling Figures in an Innings
// GET /api/player-report-card/best-bowling-figures?matchType=ALL|ODI|T20|Test
// One best spell per player (most wkts, then least runs)
// ======================================================

router.get("/best-bowling-figures", async (req, res) => {
  const matchTypeRaw = req.query.matchType || "ALL";
  const { where, params } = buildMatchFilter(matchTypeRaw, 1);

  const sql = `
    SELECT
      player_name,
      wickets,
      runs,
      match_type
    FROM (
      SELECT
        p.player_name,
        pp.wickets_taken AS wickets,
        pp.runs_given     AS runs,
        pp.match_type,
        ROW_NUMBER() OVER (
          PARTITION BY p.id
          ORDER BY pp.wickets_taken DESC, pp.runs_given ASC
        ) AS rn
      FROM player_performance pp
      JOIN players p
        ON pp.player_id = p.id
      WHERE ${where}
        AND pp.wickets_taken > 0
    ) sub
    WHERE rn = 1
    ORDER BY wickets DESC, runs ASC, player_name ASC
    LIMIT 10;
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const payload = rows.map((row, idx) => ({
      rank: idx + 1,
      playerName: row.player_name,
      wickets: Number(row.wickets),
      runs: Number(row.runs),
      matchType: row.match_type,
    }));
    res.json(payload);
  } catch (err) {
    console.error("Error in /best-bowling-figures:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch best bowling figures." });
  }
});

module.exports = router;