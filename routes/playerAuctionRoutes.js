const express = require("express");
const router = express.Router();
const pool = require("../db");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");

const upload = multer({ dest: "uploads/" });

/* ======================================================
   CREATE NEW AUCTION
====================================================== */
router.post("/create-auction", async (req, res) => {
    try {
        const { auction_name, total_boards, created_by } = req.body;

        if (!auction_name || !total_boards) {
            return res.status(400).json({
                success: false,
                message: "Auction name and total boards are required"
            });
        }

        const players_per_board = 14;
        const total_players_required = total_boards * players_per_board;

        const result = await pool.query(
            `INSERT INTO player_auction_master
            (auction_name, total_boards, players_per_board, total_players_required, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [
                auction_name,
                total_boards,
                players_per_board,
                total_players_required,
                created_by || "ADMIN"
            ]
        );

        res.json({
            success: true,
            message: "Auction created successfully",
            data: result.rows[0]
        });

    } catch (error) {
        console.error("Create Auction Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while creating auction"
        });
    }
});


/* ======================================================
   UPLOAD AUCTION PLAYERS (WITH FULL VALIDATION)
====================================================== */
router.post("/upload-players/:auction_id", upload.single("file"), async (req, res) => {

    try {

        const { auction_id } = req.params;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Excel file is required"
            });
        }

        // 1️⃣ Check auction exists
        const auctionCheck = await pool.query(
            "SELECT * FROM player_auction_master WHERE id = $1",
            [auction_id]
        );

        if (auctionCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Auction not found"
            });
        }

        const auction = auctionCheck.rows[0];

        // 2️⃣ Prevent upload if auction already started
        if (auction.auction_status !== "CREATED") {
            return res.status(400).json({
                success: false,
                message: "Cannot upload players after auction started"
            });
        }

        // 3️⃣ Prevent duplicate upload
        const existingPlayers = await pool.query(
            "SELECT COUNT(*) FROM player_auction_players_pool WHERE auction_id = $1",
            [auction_id]
        );

        if (parseInt(existingPlayers.rows[0].count) > 0) {
            return res.status(400).json({
                success: false,
                message: "Players already uploaded for this auction"
            });
        }

        // 4️⃣ Read Excel
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
      
const players = XLSX.utils.sheet_to_json(sheet, { defval: "" });
console.log("Total players read:", players.length);

console.log("Total players read:", players.length);


        if (players.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Excel file is empty"
            });
        }

        const totalBoards = auction.total_boards;
        const requiredPlayers = totalBoards * 14;

        if (players.length < requiredPlayers) {
            return res.status(400).json({
                success: false,
                message: `Minimum ${requiredPlayers} players required`
            });
        }

   // 5️⃣ VALIDATION COUNTERS (ROBUST VERSION)
let legendCount = 0;
let pureBowlerCount = 0;
let licensedPureBowlerCount = 0;
let allRounderCount = 0;
let batsmanCount = 0;

for (let p of players) {

// Normalize headers (VERY IMPORTANT)
const normalized = {};

for (let key in p) {
    normalized[key.trim().toUpperCase()] = p[key];
}

const category = (normalized["CATEGORY"] || "")
    .toString()
    .trim()
    .toUpperCase();

const skills = (normalized["SKILLS"] || normalized["SKILL"] || "")
    .toString()
    .trim()
    .toUpperCase();

const status = (normalized["STATUS"] || "")
    .toString()
    .trim()
    .toUpperCase();

    // 🔹 LEGEND COUNT
    if (category.includes("LEGEND")) {
        legendCount++;
    }

    // 🔹 PURE BOWLER COUNT
 if (skills.includes("PURE BOWLER")) {
    pureBowlerCount++;

    if (status === "LICENSED") {
        licensedPureBowlerCount++;
    }
}

    // 🔹 ALL ROUNDER COUNT
    if (skills.includes("ALL ROUNDER")) {
        allRounderCount++;
    }

    // 🔹 BATSMAN COUNT
    if (skills.includes("BATSMAN")) {
        batsmanCount++;
    }
}
console.log("=================================");
console.log("Total Boards:", totalBoards);
console.log("Pure Bowler Count:", pureBowlerCount);
console.log("Licensed Pure Bowler Count:", licensedPureBowlerCount);
console.log("Required Licensed Pure Bowlers:", totalBoards * 4);
console.log("=================================");


        const requiredLegends = totalBoards * 3;
        const requiredPureBowlers = totalBoards * 4;

        if (legendCount < requiredLegends) {
            return res.status(400).json({
                success: false,
                message: `Minimum ${requiredLegends} LEGEND players required`
            });
        }

        if (pureBowlerCount < requiredPureBowlers) {
            return res.status(400).json({
                success: false,
                message: `Minimum ${requiredPureBowlers} PURE BOWLERS required`
            });
        }

        if (licensedPureBowlerCount < requiredPureBowlers) {
            return res.status(400).json({
                success: false,
                message: `Minimum ${requiredPureBowlers} LICENSED PURE BOWLERS required`
            });
        }

        /* ============================
   ADD BELOW THIS LINE
============================ */

const requiredAllRounders = totalBoards * 5;
const requiredBatsmen = totalBoards * 5;

if (allRounderCount < requiredAllRounders) {
    return res.status(400).json({
        success: false,
        message: `Minimum ${requiredAllRounders} ALL ROUNDER players required`
    });
}

if (batsmanCount < requiredBatsmen) {
    return res.status(400).json({
        success: false,
        message: `Minimum ${requiredBatsmen} BATSMAN players required`
    });
}

        // 6️⃣ INSERT INTO DB
        for (let p of players) {

            const playerName = p["PLAYER NAME"]?.toString().trim();
            if (!playerName) continue;

           await pool.query(
    `INSERT INTO player_auction_players_pool
    (auction_id, player_name, batting_style, bowling_style, role_type, license_status, player_grade)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (auction_id, player_name) DO NOTHING`,
    [
        auction_id,
        playerName,
        p["ROLE"]?.toString().trim(),
        p["ROLE"]?.toString().trim(),
        p["SKILLS"]?.toString().trim().toUpperCase(),
        p["Status"]?.toString().trim().toUpperCase(),
        p["CATEGORY"]?.toString().trim().toUpperCase()
    ]
);

        }

        // Delete temp file
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            message: "Players uploaded and validated successfully",
            total_uploaded: players.length,
            legends_found: legendCount,
            pure_bowlers_found: pureBowlerCount,
            licensed_pure_bowlers_found: licensedPureBowlerCount
        });

    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error during upload"
        });
    }
});

module.exports = router;
