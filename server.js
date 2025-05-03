// ✅ server.js (CrickEdge Backend - FIXED CORS)
// ✅ [Updated by Ranaj Parida | 15-April-2025 15:06 pm IST | CORS support for custom domains crickedge.in]

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const pool = require("./db");
const testMatchRoutes = require("./routes/testMatchRoutes");
const rankingRoutes = require("./routes/rankingRoutes");
const authRoutes = require("./routes/authRoutes"); // ✅ [NEW] Auth route
const playerRoutes = require("./routes/playerRoutes"); // Added for Players
const performanceRoutes = require("./routes/performanceRoutes"); // ✅ New performance
const upcomingMatchRoutes = require("./routes/upcomingMatchRoutes"); // upcomimg matches
const ratingRoutes = require("./routes/ratingRoutes"); // player ratings routes





const app = express();
const server = http.createServer(app);

// ✅ Enable CORS for Vercel + Custom Domains (Updated by Ranaj Parida | 15-April-2025)
const allowedOrigins = [
  "https://cricket-scoreboard-frontend.vercel.app",
  "https://crickedge.in",
  "https://www.crickedge.in"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: "*", // ✅ Allow all HTTP methods (GET, POST, PUT, DELETE, OPTIONS etc.)
    credentials: true,
  })
);


// ✅ Allow JSON requests
app.use(express.json());

// ✅ Mount routes
app.use("/api", testMatchRoutes);
app.use("/api", rankingRoutes);
app.use("/api", authRoutes); // ✅ [NEW] Mount Auth API routes
app.use("/api", playerRoutes); // [NEW] Mount for Players routes 23-04-2025 Ranaj Parida
app.use("/api", performanceRoutes); // ✅ Mount the new route  for performacestats
app.use("/api", upcomingMatchRoutes); // Mount the new route for up-coming matches
app.use("/api/ratings", ratingRoutes); // player_rating
app.use("/api/rankings", rankingRoutes); // add new  team rankings → correct module!




// ✅ Setup socket.io with CORS (support for multiple frontend domains)
const io = socketIo(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  }
});

// ✅ WebSocket listeners
io.on("connection", (socket) => {
  console.log("✅ New client connected");
  socket.on("disconnect", () => console.log("❌ Client disconnected"));
});

// ✅ Utility to sanitize overs (like 19.3)
const sanitizeOversInput = (overs) => {
  const [fullOversStr, ballsStr = "0"] = overs.toString().split(".");
  const fullOvers = parseInt(fullOversStr);
  const balls = parseInt(ballsStr.slice(0, 1));
  if (isNaN(fullOvers) || isNaN(balls) || balls > 5) {
    throw new Error(`Invalid overs format: ${overs}`);
  }
  return fullOvers + balls / 6;
};

// ✅ Keep DB alive (Render timeout fix)
app.get("/api/ping", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ message: "DB connection alive" });
  } catch (err) {
    res.status(500).json({ message: "DB not reachable" });
  }
});
setInterval(() => {
  pool.query("SELECT 1").catch((err) => console.error("DB ping failed", err));
}, 5000);

// ✅ Create Match Entry
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

// ✅ Match Result Submission (T20/ODI)
app.post("/api/submit-result", async (req, res) => {
  try {
    const {
      match_id, team1, team2,
      runs1, overs1, wickets1,
      runs2, overs2, wickets2
    } = req.body;

    const matchResult = await pool.query("SELECT * FROM matches WHERE id = $1", [match_id]);
    if (matchResult.rows.length === 0) return res.status(400).json({ error: "Invalid match_id" });

    const { match_name, match_type } = matchResult.rows[0];
    const maxOvers = match_type === "T20" ? 20 : 50;

    const overs1DecimalRaw = sanitizeOversInput(overs1);
    const overs2DecimalRaw = sanitizeOversInput(overs2);

    const actualOvers1 = (wickets1 === 10) ? maxOvers : overs1DecimalRaw;
    const actualOvers2 = (wickets2 === 10) ? maxOvers : overs2DecimalRaw;

    let winner = "Match Draw";
    let points1 = 1, points2 = 1;
    if (runs1 > runs2) { winner = `${team1} won the match!`; points1 = 2; points2 = 0; }
    else if (runs2 > runs1) { winner = `${team2} won the match!`; points1 = 0; points2 = 2; }

    await pool.query(`
      INSERT INTO teams (match_id, name, matches_played, wins, losses, points, total_runs, total_overs, total_runs_conceded, total_overs_bowled)
      VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (match_id, name) DO UPDATE SET
        wins = EXCLUDED.wins,
        losses = EXCLUDED.losses,
        points = EXCLUDED.points,
        total_runs = EXCLUDED.total_runs,
        total_overs = EXCLUDED.total_overs,
        total_runs_conceded = EXCLUDED.total_runs_conceded,
        total_overs_bowled = EXCLUDED.total_overs_bowled
    `, [match_id, team1, points1 === 2 ? 1 : 0, points2 === 2 ? 1 : 0, points1, runs1, actualOvers1, runs2, overs2DecimalRaw]);

    await pool.query(`
      INSERT INTO teams (match_id, name, matches_played, wins, losses, points, total_runs, total_overs, total_runs_conceded, total_overs_bowled)
      VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (match_id, name) DO UPDATE SET
        wins = EXCLUDED.wins,
        losses = EXCLUDED.losses,
        points = EXCLUDED.points,
        total_runs = EXCLUDED.total_runs,
        total_overs = EXCLUDED.total_overs,
        total_runs_conceded = EXCLUDED.total_runs_conceded,
        total_overs_bowled = EXCLUDED.total_overs_bowled
    `, [match_id, team2, points2 === 2 ? 1 : 0, points1 === 2 ? 1 : 0, points2, runs2, actualOvers2, runs1, overs1DecimalRaw]);

    await pool.query(`
      WITH team_stats AS (
        SELECT name, SUM(total_runs) AS total_runs, SUM(total_overs) AS total_overs,
               SUM(total_runs_conceded) AS total_runs_conceded, SUM(total_overs_bowled) AS total_overs_bowled
        FROM teams
        GROUP BY name
      )
      UPDATE teams t
      SET nrr = (
        SELECT CASE 
          WHEN ts.total_overs > 0 AND ts.total_overs_bowled > 0 THEN 
            (ts.total_runs::decimal / ts.total_overs) - (ts.total_runs_conceded::decimal / ts.total_overs_bowled)
          ELSE 0
        END
        FROM team_stats ts WHERE ts.name = t.name
      )
    `);

    await pool.query(`
      INSERT INTO match_history 
        (match_name, match_type, team1, runs1, overs1, wickets1, team2, runs2, overs2, wickets2, winner)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [match_name, match_type, team1, runs1, actualOvers1, wickets1, team2, runs2, actualOvers2, wickets2, winner]);

    io.emit("matchUpdate", { match_id, winner });
    res.json({ message: winner });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Leaderboard
// ✅ Leaderboard with manual point calculation [Updated by Ranaj Parida - 19-April-2025]
app.get("/api/teams", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        name AS team_name,
        COUNT(DISTINCT match_id) AS matches_played,
        SUM(wins) AS wins,
        SUM(losses) AS losses,
        COUNT(DISTINCT match_id) - SUM(wins) - SUM(losses) AS draws,
        -- ✅ Manual point logic for T20/ODI (win=2, draw=1)
        (CASE 
          WHEN SUM(wins) IS NOT NULL AND (COUNT(DISTINCT match_id) - SUM(wins) - SUM(losses)) IS NOT NULL 
          THEN (SUM(wins) * 2 + (COUNT(DISTINCT match_id) - SUM(wins) - SUM(losses)) * 1)
          ELSE 0
        END) AS points,
        ROUND(
          (SUM(total_runs)::decimal / NULLIF(SUM(total_overs), 0)) - 
          (SUM(total_runs_conceded)::decimal / NULLIF(SUM(total_overs_bowled), 0)), 
          2
        ) AS nrr
      FROM teams
      GROUP BY name
      ORDER BY points DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});


// ✅ Point Table
// ✅ Point Table with Manual Point Logic [Ranaj Parida - 19-April-2025]
app.get("/api/points", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        name AS team,
        COUNT(*) AS total_matches,
        SUM(wins) AS wins,
        SUM(losses) AS losses,
        COUNT(*) - SUM(wins) - SUM(losses) AS draws,
        -- ✅ Manual point logic: Win=2, Draw=1
        (CASE 
          WHEN SUM(wins) IS NOT NULL AND (COUNT(*) - SUM(wins) - SUM(losses)) IS NOT NULL 
          THEN (SUM(wins) * 2 + (COUNT(*) - SUM(wins) - SUM(losses)) * 1)
          ELSE 0
        END) AS points
      FROM teams
      GROUP BY name
      ORDER BY points DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch point table" });
  }
});


// ✅ Test Match Ranking - Manual Calculation (Win=12, Loss=6, Draw=4) [Ranaj Parida - 19-April-2025]
app.get("/api/rankings/test", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.name AS team_name,
        COUNT(DISTINCT t.match_id) AS matches,
        SUM(t.wins) AS wins,
        SUM(t.losses) AS losses,
        COUNT(DISTINCT t.match_id) - SUM(t.wins) - SUM(t.losses) AS draws,
        (SUM(t.wins) * 12 + SUM(t.losses) * 6 + 
         (COUNT(DISTINCT t.match_id) - SUM(t.wins) - SUM(t.losses)) * 4) AS points,
        ROUND(
          (SUM(t.wins) * 12 + SUM(t.losses) * 6 + 
          (COUNT(DISTINCT t.match_id) - SUM(t.wins) - SUM(t.losses)) * 4)::decimal 
          / NULLIF(COUNT(DISTINCT t.match_id), 0),
          2
        ) AS rating
      FROM teams t
      JOIN matches m ON t.match_id = m.id
      WHERE m.match_type = 'Test'
      GROUP BY t.name
      ORDER BY rating DESC;
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch Test match rankings" });
  }
});

// ✅ Match History
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


// ✅ Start the backend server
server.listen(5000, () => {
  console.log("✅ Server running on port 5000");
});
