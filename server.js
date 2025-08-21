// ✅ server.js (CrickEdge Backend - FIXED CORS)
// ✅ [Updated by Ranaj Parida | 15-April-2025 15:06 pm IST | CORS support for custom domains crickedge.in]
// ✅ [2025-08-21 | Tournaments] Persist tournament fields in match_history + mount tournamentRoutes

require("dotenv").config();
const express = require("express");
const path = require('path'); // added for the bug..
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
const { startRatingScheduler } = require('./routes/ratingScheduler'); // scheduler 
const matchStoryRoutes = require("./routes/matchStoryRoutes"); // for matchStory 14th MAY 2025 Ranaj Parida
const playerInfoRoutes = require("./routes/playerInfoRoutes"); // for H2H comparison 15th MAY 2025 Ranaj Parida
const h2hRoutes = require("./routes/h2hRoutes"); // for H2H comparison 15th MAY 2025 Ranaj Parida
const aiRoutes = require("./routes/aiRoutes"); // AI enable QA
const dashboardFavoritesRoutes = require("./routes/dashboardFavoritesRoutes"); // dashboard
const dashboardPostsRoutes = require("./routes/dashboardPostsRoutes"); // dashboardpost
const dashboardAchievementsRoutes = require("./routes/dashboardAchievementsRoutes"); // achievement
const dashboardActivityRoutes = require("./routes/dashboardActivityRoutes"); // user activity
const dashboardMyPostsRoutes = require("./routes/dashboardMyPostsRoutes"); // user post
const dashboardProfileStatsRoutes = require("./routes/dashboardProfileStatsRoutes");
const dashboardWidgetsRoutes = require("./routes/dashboardWidgetsRoutes");
const dashboardSettingsRoutes = require("./routes/dashboardSettingsRoutes"); // user setting 
const dashboardNotificationsRoutes = require("./routes/dashboardNotificationsRoutes");
const userDashboardRoutes = require('./routes/userDashboardRoutes');
//const userDashboardV2Routes = require('./routes/userDashboardV2Routes');
const topPerformerRoutes = require('./routes/topPerformerRoutes');
const winLossTrendRoutes = require('./routes/winLossTrendRoutes');
const teamListRoutes = require('./routes/teamListRoutes');
const userAchievementsRoutes = require('./routes/userAchievementsRoutes');
const teamMatchStatsRoutes = require('./routes/teamMatchStats');
const adminRoutes = require('./routes/admin');  // ✅ At the top with your other requires
const galleryRoutes = require("./routes/gallery"); // for gallary
const schedulerRoutes = require("./routes/scheduler"); // ✅ Match Scheduler API
const boardRoutes = require('./routes/boardRoutes'); // ✅ Board Registration APIs
// 🔁 moved to routes folder (Linux is case-sensitive, file must be exactly routes/auth.js)
const { attachAdminIfPresent, requireAdminAuth } = require('./routes/auth');
const boardAnalyticsRoutes = require("./routes/boardAnalyticsRoutes");

const squadRoutes = require("./routes/squadRoutes");
const playerAnalyticsRoutes = require('./routes/playerAnalyticsRoutes');
// const squadImportRoutes = require("./routes/squadImportRoutes");  -- disbaled 

// ✅ NEW (tournaments API powering UI /api.js)
const tournamentRoutes = require("./routes/tournamentRoutes");
//const teamLeaderboardRoutes = require("./routes/teamLeaderboardRoutes");
const teamLeaderboardRoutes = require("./routes/teamLeaderboardRoutes");  // ✅ NEW

const app = express();
const server = http.createServer(app);
startRatingScheduler();
app.set("db", pool); // ✅ make pg pool available to scheduler router


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
app.use("/api", performanceRoutes); // ✅ Mount the new route  for performacestats
app.use("/api", playerRoutes); // [NEW] Mount for Players routes 23-04-2025 Ranaj Parida
app.use("/api", upcomingMatchRoutes); // Mount the new route for up-coming matches
app.use("/api/ratings", ratingRoutes); // player_rating
app.use("/api/rankings", ratingRoutes);
app.use("/api/match-stories", matchStoryRoutes); // for matchstory 14th MAY 2025 Ranaj Parida
app.use("/api/players", playerInfoRoutes); // for H2H comaprison 15th MAY 2025 Ranaj Parida
app.use("/api/h2h", h2hRoutes); // for H2H comaprison 15th MAY 2025 Ranaj Parida
app.use("/api/analyzer", aiRoutes); // AI enabled QA
app.use("/api/dashboard/favorites", dashboardFavoritesRoutes); // For Dashboard
app.use("/api/dashboard/posts", dashboardPostsRoutes); // dashboardpost
app.use("/api/dashboard/achievements", dashboardAchievementsRoutes); // achievment
app.use("/api/dashboard/activity", dashboardActivityRoutes); // user activity
app.use("/api/dashboard/myposts", dashboardMyPostsRoutes); // user post
app.use("/api/dashboard/profile", dashboardProfileStatsRoutes);
app.use("/api/dashboard/widgets", dashboardWidgetsRoutes);
app.use("/api/dashboard/settings", dashboardSettingsRoutes); // user settings
app.use("/api/dashboard/notifications", dashboardNotificationsRoutes);
app.use('/api', userDashboardRoutes);
// app.use('/api', userDashboardV2Routes);
app.use("/api", require("./routes/userRecentMatchesV2Routes"));
app.use('/api', topPerformerRoutes);
app.use('/api/win-loss-trend', winLossTrendRoutes);
app.use('/api', teamListRoutes);
app.use('/api/user-achievements', userAchievementsRoutes);
app.use('/api/team-match-stats', teamMatchStatsRoutes);
app.use('/api/admin', adminRoutes);              // ✅ With your other app.use() lines
console.log("[ADMIN] adminRoutes mounted at /api/admin");
app.use('/api/match', require('./routes/match')); // added for automated approval.

// ✅ Mount tournaments API (NEW)
app.use("/api/tournaments", tournamentRoutes);

app.use('/uploads/gallery', express.static(path.join(__dirname, 'uploads/gallery'))); // serve images
app.use("/api/gallery", galleryRoutes);
app.use("/api/scheduler", schedulerRoutes); // ✅ /api/scheduler/*
// app.use("/api/boards", boardRoutes); // ✅ Mount Board Registration APIs
app.use("/api/boards", attachAdminIfPresent, boardRoutes);
app.use("/api/boards/analytics", boardAnalyticsRoutes);
app.use("/api/squads", attachAdminIfPresent, squadRoutes);
app.use('/api/players', playerAnalyticsRoutes); // keeps /api/players/* namespace
app.use("/api/tournaments", tournamentRoutes);
app.use("/api", teamLeaderboardRoutes);

// app.use("/api/squads/ocr", squadImportRoutes);  disbaled OCR

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
    const { match_name, match_type, user_id } = req.body;
    const result = await pool.query(
      "INSERT INTO matches (match_name, match_type, user_id) VALUES ($1, $2, $3) RETURNING id",
      [match_name, match_type, user_id]
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
      runs2, overs2, wickets2,
      user_id,
      // ✅ [TOURNAMENT] new fields
      tournament_name = null,
      season_year = null,
      match_date = null
    } = req.body;

    const matchResult = await pool.query("SELECT * FROM matches WHERE id = $1", [match_id]);
    if (matchResult.rows.length === 0) return res.status(400).json({ error: "Invalid match_id" });

    const { match_name, match_type } = matchResult.rows[0];
    const maxOvers = match_type === "T20" ? 20 : 50;

    const overs1DecimalRaw = sanitizeOversInput(overs1);
    const overs2DecimalRaw = sanitizeOversInput(overs2);

    // ✅ Use maxOvers if team is all out, otherwise actual overs used
    const actualOvers1 = (wickets1 === 10) ? maxOvers : overs1DecimalRaw;
    const actualOvers2 = (wickets2 === 10) ? maxOvers : overs2DecimalRaw;

    let winner = "Match Draw";
    let points1 = 1, points2 = 1;
    if (runs1 > runs2) { winner = `${team1} won the match!`; points1 = 2; points2 = 0; }
    else if (runs2 > runs1) { winner = `${team2} won the match!`; points1 = 0; points2 = 2; }

    // ✅ Insert team1 stats
    await pool.query(`
      INSERT INTO teams (
        match_id, name, matches_played, wins, losses, points,
        total_runs, total_overs, total_runs_conceded, total_overs_bowled, user_id
      ) VALUES (
        $1, $2, 1, $3, $4, $5,
        $6, $7, $8, $9, $10
      )
      ON CONFLICT (match_id, name) DO UPDATE SET
        wins = EXCLUDED.wins,
        losses = EXCLUDED.losses,
        points = EXCLUDED.points,
        total_runs = EXCLUDED.total_runs,
        total_overs = EXCLUDED.total_overs,
        total_runs_conceded = EXCLUDED.total_runs_conceded,
        total_overs_bowled = EXCLUDED.total_overs_bowled,
        user_id = EXCLUDED.user_id
    `, [
      match_id,
      team1,
      points1 === 2 ? 1 : 0,
      points2 === 2 ? 1 : 0,
      points1,
      runs1,
      actualOvers1,
      runs2,
      actualOvers2,
      user_id
    ]);

    // ✅ Insert team2 stats
    await pool.query(`
      INSERT INTO teams (
        match_id, name, matches_played, wins, losses, points,
        total_runs, total_overs, total_runs_conceded, total_overs_bowled, user_id
      ) VALUES (
        $1, $2, 1, $3, $4, $5,
        $6, $7, $8, $9, $10
      )
      ON CONFLICT (match_id, name) DO UPDATE SET
        wins = EXCLUDED.wins,
        losses = EXCLUDED.losses,
        points = EXCLUDED.points,
        total_runs = EXCLUDED.total_runs,
        total_overs = EXCLUDED.total_overs,
        total_runs_conceded = EXCLUDED.total_runs_conceded,
        total_overs_bowled = EXCLUDED.total_overs_bowled,
        user_id = EXCLUDED.user_id
    `, [
      match_id,
      team2,
      points2 === 2 ? 1 : 0,
      points1 === 2 ? 1 : 0,
      points2,
      runs2,
      actualOvers2,
      runs1,
      actualOvers1,
      user_id
    ]);

    // ✅ [NRR FIX | 17-July-2025 | by Ranaj Parida] Recalculate correct NRR for each team
    for (const team of [team1, team2]) {
      await pool.query(`
        WITH team_stats AS (
          SELECT 
            t.name,
            SUM(t.total_runs) AS total_runs,
            SUM(t.total_overs) AS total_overs,
            SUM(t.total_runs_conceded) AS total_runs_conceded,
            SUM(t.total_overs_bowled) AS total_overs_bowled
          FROM teams t
          JOIN matches m ON t.match_id = m.id
          WHERE t.name = $1 AND m.match_type IN ('T20', 'ODI')
          GROUP BY t.name
        )
        UPDATE teams t
        SET nrr = (
          SELECT 
            CASE 
              WHEN ts.total_overs > 0 AND ts.total_overs_bowled > 0 THEN 
                ROUND((ts.total_runs::decimal / ts.total_overs) - 
                      (ts.total_runs_conceded::decimal / ts.total_overs_bowled), 4)
              ELSE 0
            END
          FROM team_stats ts
          WHERE ts.name = t.name
        )
        WHERE t.name = $1 AND t.match_id = $2
      `, [team, match_id]);
    }

    // ✅ Save to match_history  (NOW includes tournament fields)
    const matchDateSafe = match_date || new Date().toISOString().slice(0,10);
    await pool.query(`
      INSERT INTO match_history 
        (match_name, match_type, team1, runs1, overs1, wickets1, team2, runs2, overs2, wickets2, winner, user_id, match_date, tournament_name, season_year)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      match_name, match_type,
      team1, runs1, actualOvers1, wickets1,
      team2, runs2, actualOvers2, wickets2,
      winner, user_id,
      matchDateSafe,
      tournament_name, season_year
    ]);

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
