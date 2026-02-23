// routes/crickedgeSeasonRoutes.js
// CrickEdge Season Module
const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ===========================================================
   1️⃣ CREATE SEASON (ADMIN)
=========================================================== */
router.post("/create", async (req, res) => {

  try {

    let {
      season_name,
      tournament_name,
      match_type
    } = req.body;

    season_name = String(season_name || "").trim();
    tournament_name = String(tournament_name || "").trim();
    match_type = String(match_type || "ALL").trim();

    if (!season_name || !tournament_name) {
      return res.status(400).json({
        error: "Season name and tournament name required"
      });
    }

    const fullTournamentName =
      `${season_name} ${tournament_name}`;

    const client = await pool.connect();

    try {

      await client.query("BEGIN");


      // 🔒 Only one active season allowed
      await client.query(`
        UPDATE crickedge_seasons
        SET status='COMPLETED'
        WHERE status='ACTIVE'
      `);


      const result = await client.query(`

        INSERT INTO crickedge_seasons
        (season_name,tournament_name,match_type,start_date,status)

        VALUES ($1,$2,$3,CURRENT_DATE,'ACTIVE')

        RETURNING *

      `,[
        season_name,
        fullTournamentName,
        match_type
      ]);

      await client.query("COMMIT");
      res.json({
        message:"Season created",
        season:result.rows[0]
      });
    }
    catch(err){
      await client.query("ROLLBACK");
      console.log(err);
      res.status(500).json({
        error:"Season creation failed"
      });
    }
    finally{

      client.release();
    }
  }
  catch(err){
    res.status(500).json({
      error:"Server error"
    });
  }
});
/* ===========================================================
   2️⃣ GET ALL SEASONS
=========================================================== */
router.get("/all", async(req,res)=>{
  try{
    const result = await pool.query(`
      SELECT *
      FROM crickedge_seasons
      ORDER BY id DESC
    `);
    res.json(result.rows);
  }
  catch(err){

    res.status(500).json({
      error:"Failed to load seasons"
    });
  }

});
/* ===========================================================
   3️⃣ GET ACTIVE SEASON
=========================================================== */
router.get("/active", async(req,res)=>{
  try{
    const result = await pool.query(`
      SELECT *
      FROM crickedge_seasons
      WHERE status='ACTIVE'
      LIMIT 1
    `);

    res.json(result.rows[0] || null);

  }
  catch(err){

    res.status(500).json({
      error:"Failed to load active season"
    });

  }

});
/* ===========================================================
   4️⃣ UPDATE SEASON (ADMIN)
=========================================================== */
router.put("/update/:id", async(req,res)=>{
  const {id}=req.params;
  let {
    season_name,
    tournament_name,
    match_type,
    status
  }=req.body;

  season_name = String(season_name || "").trim();
  tournament_name = String(tournament_name || "").trim();
  match_type = String(match_type || "ALL").trim();
  status = String(status || "ACTIVE").trim();
  try{

    const fullTournamentName =
      `${season_name} ${tournament_name}`;

    await pool.query(`

      UPDATE crickedge_seasons
      SET
      season_name=$1,
      tournament_name=$2,
      match_type=$3,
      status=$4
      WHERE id=$5

    `,[
      season_name,
      fullTournamentName,
      match_type,
      status,
      id
    ]);
    res.json({
      message:"Season updated"
    });

  }
  catch(err){

    res.status(500).json({
      error:"Update failed"
    });

  }

});
/* ===========================================================
   5️⃣ DELETE SEASON
=========================================================== */

router.delete("/delete/:id", async(req,res)=>{
  const {id}=req.params;
  const client = await pool.connect();
  try{
    await client.query("BEGIN");

    // Convert matches back to INTERNATIONAL
    await client.query(`

      UPDATE match_history
      SET
      season_type='INTERNATIONAL',
      crickedge_season_id=NULL
      WHERE crickedge_season_id=$1
    `,[id]);
    await client.query(`
      UPDATE test_match_results
      SET
      season_type='INTERNATIONAL',
      crickedge_season_id=NULL

      WHERE crickedge_season_id=$1

    `,[id]);
    await client.query(`
      DELETE FROM crickedge_seasons
      WHERE id=$1
    `,[id]);

    await client.query("COMMIT");
    res.json({
      message:"Season deleted"
    });

  }
  catch(err){
    await client.query("ROLLBACK");
    res.status(500).json({
      error:"Delete failed"
    });
  }
  finally{
    client.release();
  }
});
// =======================================================
// STEP 5 — CRICKEDGE SEASON LEADERBOARD
// =======================================================
router.get("/leaderboard", async (req, res) => {
try {
const { match_type } = req.query;

// ================================
// 1️⃣ GET ACTIVE SEASON
// ================================
const seasonResult = await pool.query(`
SELECT id
FROM crickedge_seasons
WHERE is_active = true
LIMIT 1
`);

if(seasonResult.rows.length === 0){
return res.status(404).json({
message:"No Active Season Found"
});
}
const seasonId = seasonResult.rows[0].id;

// ================================
// 2️⃣ ODI + T20 DATA
// ================================
let odiFilter = "";
if(match_type === "ODI" || match_type === "T20")
odiFilter = `AND match_type='${match_type}'`;
if(match_type === "Test")
odiFilter = "AND 1=0";
const odiQuery = `

SELECT
team,
COUNT(*) matches,

SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) wins,
SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END) losses,
SUM(CASE WHEN result='DRAW' THEN 1 ELSE 0 END) draws,

SUM(
CASE
WHEN result='WIN' THEN 2
WHEN result='DRAW' THEN 1
ELSE 0
END
) points
FROM(
SELECT
team1 team,
CASE
WHEN winner LIKE '%'||team1||'%' THEN 'WIN'
WHEN winner LIKE '%'||team2||'%' THEN 'LOSS'
ELSE 'DRAW'
END result,
match_type
FROM match_history
WHERE crickedge_season_id=$1
${odiFilter}
UNION ALL
SELECT
team2 team,
CASE
WHEN winner LIKE '%'||team2||'%' THEN 'WIN'
WHEN winner LIKE '%'||team1||'%' THEN 'LOSS'
ELSE 'DRAW'
END result,
match_type
FROM match_history
WHERE crickedge_season_id=$1
${odiFilter}
)t
GROUP BY team
`;

// ================================
// 3️⃣ TEST DATA
// ================================
let testFilter="";
if(match_type==="Test")
testFilter="";
else if(match_type)
testFilter="AND 1=0";
const testQuery = `
SELECT
team,
COUNT(*) matches,
SUM(CASE WHEN result='Win' THEN 1 ELSE 0 END) wins,
SUM(CASE WHEN result='Loss' THEN 1 ELSE 0 END) losses,
SUM(CASE WHEN result='Draw' THEN 1 ELSE 0 END) draws,
SUM(
CASE
WHEN result='Win' THEN 12
WHEN result='Loss' THEN 6
WHEN result='Draw' THEN 4
END
) points
FROM(
SELECT team1 team,result
FROM test_match_results
WHERE crickedge_season_id=$1
${testFilter}
UNION ALL
SELECT team2 team,result
FROM test_match_results
WHERE crickedge_season_id=$1
${testFilter}
)t
GROUP BY team
`;
// ================================
// 4️⃣ EXECUTE
// ================================
const odiData = await pool.query(odiQuery,[seasonId]);
const testData = await pool.query(testQuery,[seasonId]);
// ================================
// 5️⃣ MERGE
// ================================
const combined={};
const merge=(rows)=>{
rows.forEach(r=>{
if(!combined[r.team])
combined[r.team]={
team:r.team,
matches:0,
wins:0,
losses:0,
draws:0,
points:0
};
combined[r.team].matches+=Number(r.matches);
combined[r.team].wins+=Number(r.wins);
combined[r.team].losses+=Number(r.losses);
combined[r.team].draws+=Number(r.draws);
combined[r.team].points+=Number(r.points);
});

};
merge(odiData.rows);
merge(testData.rows);
// ================================
// 6️⃣ RANKING
// ================================
let leaderboard=Object.values(combined);
leaderboard.sort((a,b)=>b.points-a.points);
leaderboard=leaderboard.map((t,i)=>({
rank:i+1,
team:t.team,
matches:t.matches,
wins:t.wins,
losses:t.losses,
draws:t.draws,
points:t.points

}));
// ================================
// 7️⃣ RESPONSE
// ================================
res.json(leaderboard);

}
catch(err){
console.log(err);
res.status(500).json({
error:"Season leaderboard failed"
});
}
});

module.exports = router;