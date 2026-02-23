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


module.exports = router;