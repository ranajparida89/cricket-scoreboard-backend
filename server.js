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
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const convertOversToDecimal = (overs) => {
  const whole = Math.floor(overs);
  const balls = (overs - whole) * 10;
  return whole + balls / 6;
};

// 🔐 Admin Login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM admins WHERE username = $1", [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid username" });
    }

    const admin = result.rows[0];
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: "1h" });
    res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 🏏 Add a match
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

// 📝 Submit match result
app.post("/api/submit-result", async (req, res) => {
  try {
    const {
      match_id,
      team1,
      team2,
      runs1,
      overs1,
      wickets1,
      runs2,
      overs2,
      wickets2,
    } = req.body;

    // Fetch match info
    const matchResult = await pool.query("SELECT * FROM matches WHERE id = $1", [match_id]);

    if (matchResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid match_id. Match not found." });
    }

    const match = matchResult.rows[0];

    if (!match.match_type || !match.match_name) {
      return res.status(400).json({ error: "match_name or match_type is missing for the provided match_id." });
    }

    const match_type = match.match_type;
    const match_name = match.match_name;

    const maxOvers = match_type === "T20" ? 20 : 50;
    if (overs1 > maxOvers || overs2 > maxOvers) {
      return res.status(400).json({
        error: `Invalid overs! Max allowed for ${match_type} is ${maxOvers}`,
      });
    }

    const overs1Decimal = convertOversToDecimal(overs1);
    const overs2Decimal = convertOversToDecimal(overs2);

    let winner = "Match Draw";
    let points1 = 1, points2 = 1;
    if (runs1 > runs2) {
      winner = `${team1} won the match!`;
      points1 = 2;
      points2 = 0;
    } else if (runs2 > runs1) {
      winner = `${team2} won the match!`;
      points1 = 0;
      points2 = 2;
    }

    // Insert/update team 1
    await pool.query(
      `
      INSERT INTO teams 
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
        total_overs_bowled = teams.total_overs_bowled + $9
    `,
      [
        match_id,
        team1,
        points1 === 2 ? 1 : 0,
        points2 === 2 ? 1 : 0,
        points1,
        runs1,
        overs1Decimal,
        runs2,
        overs2Decimal,
      ]
    );

    // Insert/update team 2
    await pool.query(
      `
      INSERT INTO teams 
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
        total_overs_bowled = teams.total_overs_bowled + $9
    `,
      [
        match_id,
        team2,
        points2 === 2 ? 1 : 0,
        points1 === 2 ? 1 : 0,
        points2,
        runs2,
        overs2Decimal,
        runs1,
        overs1Decimal,
      ]
    );

    // Update NRR
    await pool.query(
      `
      UPDATE teams
      SET nrr = 
        CASE 
          WHEN total_overs > 0 AND total_overs_bowled > 0 THEN 
            (total_runs::decimal / total_overs) - 
            (total_runs_conceded::decimal / total_overs_bowled)
          ELSE 0
        END
      WHERE match_id = $1
    `,
      [match_id]
    );

    // Add to match history
    await pool.query(
      `INSERT INTO match_history 
        (match_name, match_type, team1, runs1, overs1, wickets1, team2, runs2, overs2, wickets2, winner) 
       VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        match_name,
        match_type,
        team1,
        runs1,
        overs1Decimal,
        wickets1,
        team2,
        runs2,
        overs2Decimal,
        wickets2,
        winner,
      ]
    );

    io.emit("matchUpdate", { match_id, winner });
    res.json({ message: winner });

  } catch (err) {
    console.error("Submit Result Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🏆 Leaderboard
app.get("/api/teams", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT name AS team_name, 
             SUM(matches_played) AS matches_played,
             SUM(wins) AS wins,
             SUM(losses) AS losses,
             SUM(points) AS points,
             ROUND(SUM(nrr)::numeric, 2) AS nrr
      FROM teams
      GROUP BY name
      ORDER BY SUM(points) DESC, SUM(nrr) DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// 📜 Match History with filters
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
    console.error("Error fetching match history:", err);
    res.status(500).json({ error: "Failed to fetch match history" });
  }
});

// 🔌 Socket connection
io.on("connection", (socket) => {
  console.log("New client connected");
  socket.on("disconnect", () => console.log("Client disconnected"));
});

// ✅ Start server
server.listen(5000, () => {
  console.log("✅ Server running on port 5000");
});
