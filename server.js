require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "https://crickedge.in",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const sanitizeOversInput = (overs) => {
  const [fullOversStr, ballsStr = "0"] = overs.toString().split(".");
  const fullOvers = parseInt(fullOversStr);
  const balls = parseInt(ballsStr.slice(0, 1));
  if (isNaN(fullOvers) || isNaN(balls) || balls > 5) {
    throw new Error(`Invalid overs format: ${overs}`);
  }
  return fullOvers + balls / 6;
};

app.get("/api/ping", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ message: "DB connection alive" });
  } catch (err) {
    console.error("Ping DB error:", err);
    res.status(500).json({ message: "DB not reachable" });
  }
});

setInterval(() => {
  pool.query("SELECT 1").catch((err) => console.error("Periodic DB ping failed:", err));
}, 5000);

app.post("/api/match", async (req, res) => {
  try {
    const { match_name, match_type } = req.body;
    const result = await pool.query(
      "INSERT INTO matches (match_name, match_type) VALUES ($1, $2) RETURNING id",
      [match_name, match_type]
    );
    res.json({ match_id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/submit-result", async (req, res) => {
  try {
    const {
      match_id, team1, team2, match_type,
      runs1, overs1, wickets1,
      runs2, overs2, wickets2
    } = req.body;

    const matchResult = await pool.query("SELECT * FROM matches WHERE id = $1", [match_id]);
    if (matchResult.rows.length === 0) return res.status(400).json({ error: "Invalid match_id" });

    const { match_name } = matchResult.rows[0];

    const overs1Decimal = sanitizeOversInput(overs1);
    const overs2Decimal = sanitizeOversInput(overs2);

    let winner = "Match Draw";
    let points1 = 0;
    let points2 = 0;

    // ✅ Test match logic (Points only, No NRR)
    if (match_type === "Test") {
      if (runs1 > runs2) {
        winner = `${team1} won the Test match!`;
        points1 = 12;
      } else if (runs2 > runs1) {
        winner = `${team2} won the Test match!`;
        points2 = 12;
      } else {
        winner = "Test Match Draw";
        points1 = 4;
        points2 = 4;
      }
    }

    // ✅ T20/ODI logic (With NRR)
    if (match_type === "T20" || match_type === "ODI") {
      const maxOvers = match_type === "T20" ? 20 : 50;
      const actualOvers1 = (wickets1 === 10) ? maxOvers : overs1Decimal;
      const actualOvers2 = (wickets2 === 10) ? maxOvers : overs2Decimal;

      if (runs1 > runs2) {
        winner = `${team1} won the match!`;
        points1 = 2;
      } else if (runs2 > runs1) {
        winner = `${team2} won the match!`;
        points2 = 2;
      } else {
        winner = "Match Draw";
        points1 = 1;
        points2 = 1;
      }

      await pool.query(`INSERT INTO teams 
        (match_id, name, matches_played, wins, losses, points, total_runs, total_overs, total_runs_conceded, total_overs_bowled)
        VALUES 
        ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (match_id, name) DO UPDATE SET
          matches_played = teams.matches_played + 1,
          wins = teams.wins + $3,
          losses = teams.losses + $4,
          points = teams.points + $5,
          total_runs = teams.total_runs + $6,
          total_overs = teams.total_overs + $7,
          total_runs_conceded = teams.total_runs_conceded + $8,
          total_overs_bowled = teams.total_overs_bowled + $9`,
        [match_id, team1, points1 === 2 ? 1 : 0, points2 === 2 ? 1 : 0, points1, runs1, actualOvers1, runs2, overs2Decimal]
      );

      await pool.query(`INSERT INTO teams 
        (match_id, name, matches_played, wins, losses, points, total_runs, total_overs, total_runs_conceded, total_overs_bowled)
        VALUES 
        ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (match_id, name) DO UPDATE SET
          matches_played = teams.matches_played + 1,
          wins = teams.wins + $3,
          losses = teams.losses + $4,
          points = teams.points + $5,
          total_runs = teams.total_runs + $6,
          total_overs = teams.total_overs + $7,
          total_runs_conceded = teams.total_runs_conceded + $8,
          total_overs_bowled = teams.total_overs_bowled + $9`,
        [match_id, team2, points2 === 2 ? 1 : 0, points1 === 2 ? 1 : 0, points2, runs2, actualOvers2, runs1, overs1Decimal]
      );
    }

    // ✅ Final: Insert into match_history
    await pool.query(`
      INSERT INTO match_history 
      (match_name, match_type, team1, runs1, overs1, wickets1, team2, runs2, overs2, wickets2, winner) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [match_name, match_type, team1, runs1, overs1Decimal, wickets1, team2, runs2, overs2Decimal, wickets2, winner]);

    // ✅ Recalculate NRR only for T20/ODI
    if (match_type === "T20" || match_type === "ODI") {
      await pool.query(`
        WITH team_stats AS (
          SELECT name,
                 SUM(total_runs) AS total_runs,
                 SUM(total_overs) AS total_overs,
                 SUM(total_runs_conceded) AS total_runs_conceded,
                 SUM(total_overs_bowled) AS total_overs_bowled
          FROM teams
          GROUP BY name
        )
        UPDATE teams t
        SET nrr = (
          SELECT 
            CASE 
              WHEN ts.total_overs > 0 AND ts.total_overs_bowled > 0 THEN 
                (ts.total_runs::decimal / ts.total_overs) - 
                (ts.total_runs_conceded::decimal / ts.total_overs_bowled)
              ELSE 0
            END
          FROM team_stats ts
          WHERE ts.name = t.name
        )
      `);
    }

    io.emit("matchUpdate", { match_id, winner });
    res.json({ message: winner });

  } catch (err) {
    console.error("Submit Result Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/teams", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT name AS team_name, 
             SUM(matches_played) AS matches_played,
             SUM(wins) AS wins,
             SUM(losses) AS losses,
             SUM(points) AS points,
             ROUND(
               (SUM(total_runs)::decimal / NULLIF(SUM(total_overs), 0)) -
               (SUM(total_runs_conceded)::decimal / NULLIF(SUM(total_overs_bowled), 0)),
             2) AS nrr
      FROM teams
      GROUP BY name
      ORDER BY SUM(points) DESC, 
               ROUND(
                 (SUM(total_runs)::decimal / NULLIF(SUM(total_overs), 0)) -
                 (SUM(total_runs_conceded)::decimal / NULLIF(SUM(total_overs_bowled), 0)), 2
               ) DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

app.get("/api/match-history", async (req, res) => {
  try {
    const { match_type, team, winner } = req.query;
    let query = `SELECT * FROM match_history WHERE 1=1`;
    const params = [];

    if (match_type) {
      params.push(match_type);
      query += ` AND match_type = $${params.length}`;
    }
    if (team) {
      params.push(`%${team}%`);
      query += ` AND (team1 ILIKE $${params.length} OR team2 ILIKE $${params.length})`;
    }
    if (winner) {
      params.push(`%${winner}%`);
      query += ` AND winner ILIKE $${params.length}`;
    }

    query += ` ORDER BY match_time DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch match history" });
  }
});

io.on("connection", (socket) => {
  console.log("New client connected");
  socket.on("disconnect", () => console.log("Client disconnected"));
});

server.listen(5000, () => {
  console.log("✅ Server running on port 5000");
});
