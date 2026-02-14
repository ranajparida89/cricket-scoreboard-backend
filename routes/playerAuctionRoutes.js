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

    // Normalize headers again
    const normalized = {};
    for (let key in p) {
        normalized[key.trim().toUpperCase()] = p[key];
    }

    const playerName = (normalized["PLAYER NAME"] || "")
        .toString()
        .trim();

    if (!playerName) continue;

    const roleType = (normalized["SKILLS"] || normalized["SKILL"] || "")
        .toString()
        .trim()
        .toUpperCase();

    const licenseStatus = (normalized["STATUS"] || "")
        .toString()
        .trim()
        .toUpperCase();

    const playerGrade = (normalized["CATEGORY"] || "")
        .toString()
        .trim()
        .toUpperCase();

    await pool.query(
        `INSERT INTO player_auction_players_pool
        (auction_id, player_name, batting_style, bowling_style, role_type, license_status, player_grade)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (auction_id, player_name) DO NOTHING`,
        [
            auction_id,
            playerName,
            normalized["ROLE"] || "",
            normalized["ROLE"] || "",
            roleType,
            licenseStatus,
            playerGrade
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


/* ======================================================
   START AUCTION – RANDOMIZER ENGINE
====================================================== */
router.post("/start-auction/:auction_id", async (req, res) => {

    const { auction_id } = req.params;
     console.log("Auction ID received:", auction_id);
    const client = await pool.connect();

    try {

        await client.query("BEGIN");

        // 1️⃣ Lock auction
        const auctionRes = await client.query(
            `SELECT * FROM player_auction_master 
             WHERE id = $1 
             FOR UPDATE`,
            [auction_id]
        );

        if (auctionRes.rows.length === 0)
            throw new Error("Auction not found");

        const auction = auctionRes.rows[0];

        if (auction.auction_status === "STARTED")
            throw new Error("Auction already started");

        const totalBoards = auction.total_boards;

        // 2️⃣ Fetch Boards
        const boardsRes = await client.query(
    `SELECT board_id as id, board_name
     FROM player_auction_boards
     WHERE auction_id = $1`,
    [auction_id]
);

if (boardsRes.rows.length !== totalBoards)
    throw new Error("Participating boards not configured properly");

        const boards = boardsRes.rows;

        // 3️⃣ Reset previous allocation
        await client.query(
            `DELETE FROM player_auction_assignments
             WHERE auction_id = $1`,
            [auction_id]
        );

        await client.query(
            `UPDATE player_auction_players_pool
             SET sold_status = 'UNSOLD',
                 assigned_board_id = NULL
             WHERE auction_id = $1`,
            [auction_id]
        );

        // Helper function
        const getRandomPlayers = async (condition, limit) => {

            const result = await client.query(
                `
                SELECT *
                FROM player_auction_players_pool
                WHERE auction_id = $1
                AND sold_status = 'UNSOLD'
                ${condition}
                ORDER BY RANDOM()
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
                `,
                [auction_id]
            );

            return result.rows;
        };

        // 4️⃣ Allocation Loop
        for (const board of boards) {

            let selected = [];

            // 4 Licensed Pure Bowlers
            const bowlers = await getRandomPlayers(
                `AND role_type ILIKE '%PURE BOWLER%'
                 AND license_status = 'LICENSED'`,
                4
            );

            if (bowlers.length < 4)
                throw new Error("Insufficient Licensed Pure Bowlers");

            selected.push(...bowlers);

            // 5 All Rounders
            const allRounders = await getRandomPlayers(
                `AND role_type ILIKE '%ALL ROUNDER%'`,
                5
            );

            if (allRounders.length < 5)
                throw new Error("Insufficient All Rounders");

            selected.push(...allRounders);

            // 5 Batsmen
            const batsmen = await getRandomPlayers(
                `AND role_type ILIKE '%BATSMAN%'`,
                5
            );

            if (batsmen.length < 5)
                throw new Error("Insufficient Batsmen");

            selected.push(...batsmen);

            // Legend validation
            const legendCount = selected.filter(
                p => p.player_grade === "LEGEND"
            ).length;

            if (legendCount < 3) {

                const needed = 3 - legendCount;

                const extraLegends = await getRandomPlayers(
                    `AND player_grade = 'LEGEND'`,
                    needed
                );

                if (extraLegends.length < needed)
                    throw new Error("Not enough Legends available");

                if (legendCount < 3) {

    let needed = 3 - legendCount;

    const extraLegends = await getRandomPlayers(
        `AND player_grade = 'LEGEND'`,
        needed
    );

    if (extraLegends.length < needed)
        throw new Error("Not enough Legends available");

    // Replace only NON-LEGEND players
    for (let i = 0; i < selected.length && needed > 0; i++) {

        if (selected[i].player_grade !== "LEGEND") {

            selected[i] = extraLegends.pop();
            needed--;
        }
    }
}

            }

            // Insert assignments
            for (const player of selected) {

                await client.query(
                    `
                    INSERT INTO player_auction_assignments (
                        auction_id,
                        board_id,
                        board_name,
                        player_id,
                        player_name,
                        batting_style,
                        bowling_style,
                        role_type,
                        license_status,
                        player_grade
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    `,
                    [
                        auction_id,
                        board.id,
                        board.board_name,
                        player.id,
                        player.player_name,
                        player.batting_style,
                        player.bowling_style,
                        player.role_type,
                        player.license_status,
                        player.player_grade
                    ]
                );

                await client.query(
                    `
                    UPDATE player_auction_players_pool
                    SET sold_status = 'SOLD',
                        assigned_board_id = $1
                    WHERE id = $2
                    `,
                    [board.id, player.id]
                );
            }
        }

        // 5️⃣ Mark auction started
        await client.query(
            `UPDATE player_auction_master
             SET auction_status = 'STARTED'
             WHERE id = $1`,
            [auction_id]
        );

        await client.query("COMMIT");

        res.json({
            success: true,
            message: "Auction completed successfully"
        });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error("Auction Error FULL:", error);
    console.error("Message:", error.message);
    console.error("Detail:", error.detail);
    console.error("Stack:", error.stack);

    res.status(500).json({
        success: false,
        message: error.message
    });

} finally {
    client.release();
}
});

/* ======================================================
   AUCTION SUMMARY
====================================================== */
router.get("/summary/:auction_id", async (req, res) => {

    const { auction_id } = req.params;

    try {

        const auctionRes = await pool.query(
            `SELECT auction_name, total_boards, auction_status
             FROM player_auction_master
             WHERE id = $1`,
            [auction_id]
        );

        if (auctionRes.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Auction not found"
            });
        }

        const soldRes = await pool.query(
            `SELECT COUNT(*) FROM player_auction_players_pool
             WHERE auction_id = $1 AND sold_status = 'SOLD'`,
            [auction_id]
        );

        const unsoldRes = await pool.query(
            `SELECT COUNT(*) FROM player_auction_players_pool
             WHERE auction_id = $1 AND sold_status = 'UNSOLD'`,
            [auction_id]
        );

        res.json({
            success: true,
            auction: auctionRes.rows[0],
            total_sold: parseInt(soldRes.rows[0].count),
            total_unsold: parseInt(unsoldRes.rows[0].count)
        });

    } catch (error) {
        console.error("Summary Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

/* ======================================================
   BOARD SQUAD
====================================================== */
router.get("/board/:auction_id/:board_id", async (req, res) => {

    const { auction_id, board_id } = req.params;

    try {

        const playersRes = await pool.query(
            `SELECT player_name, role_type, player_grade
             FROM player_auction_assignments
             WHERE auction_id = $1 AND board_id = $2`,
            [auction_id, board_id]
        );

        if (playersRes.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No players found for this board"
            });
        }

        const legendCount = playersRes.rows.filter(
            p => p.player_grade === "LEGEND"
        ).length;

        res.json({
            success: true,
            total_players: playersRes.rows.length,
            legends: legendCount,
            players: playersRes.rows
        });

    } catch (error) {
        console.error("Board Squad Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


/* ======================================================
   FULL AUCTION RESULTS
====================================================== */
router.get("/results/:auction_id", async (req, res) => {

    const { auction_id } = req.params;

    try {

        const auctionRes = await pool.query(
            `SELECT auction_name FROM player_auction_master
             WHERE id = $1`,
            [auction_id]
        );

        if (auctionRes.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Auction not found"
            });
        }

        const boardsRes = await pool.query(
            `SELECT DISTINCT board_id, board_name
             FROM player_auction_assignments
             WHERE auction_id = $1`,
            [auction_id]
        );

    let boards = [];

for (const board of boardsRes.rows) {

    const allPlayers = await pool.query(
        `SELECT 
            player_id,
            player_name,
            role_type,
            player_grade,
            license_status,
            reveal_status
         FROM player_auction_assignments
         WHERE auction_id = $1 
         AND board_id = $2`,
        [auction_id, board.board_id]
    );

    boards.push({
        board_id: board.board_id,
        board_name: board.board_name,
        players: allPlayers.rows
    });
}


        const unsoldRes = await pool.query(
            `SELECT player_name, role_type, player_grade
             FROM player_auction_players_pool
             WHERE auction_id = $1 AND sold_status = 'UNSOLD'`,
            [auction_id]
        );

        res.json({
            success: true,
            auction_name: auctionRes.rows[0].auction_name,
            boards,
            unsold_players: unsoldRes.rows
        });

    } catch (error) {
        console.error("Results Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

/* ======================================================
   REVEAL BOARD
====================================================== */
router.post("/reveal-board/:auction_id/:board_id", async (req, res) => {

    const { auction_id, board_id } = req.params;

    try {

        const result = await pool.query(
            `UPDATE player_auction_assignments
             SET reveal_status = TRUE
             WHERE auction_id = $1 
             AND board_id = $2`,
            [auction_id, board_id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Board not found"
            });
        }

        res.json({
            success: true,
            message: "Board revealed successfully"
        });

    } catch (error) {
        console.error("Reveal Board Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

/* ======================================================
   GET LATEST AUCTION
====================================================== */
router.get("/latest", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id
             FROM player_auction_master
             ORDER BY created_at DESC
             LIMIT 1`
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No auction found"
            });
        }

        res.json({
            success: true,
            id: result.rows[0].id
        });

    } catch (error) {
        console.error("Latest Auction Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

router.post("/add-boards/:auction_id", async (req, res) => {
    try {
        const { auction_id } = req.params;
        const { boards } = req.body; // array of board_id

        if (!boards || boards.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Boards are required"
            });
        }

        for (let boardId of boards) {
            const boardRes = await pool.query(
                `SELECT board_name FROM board_registration WHERE id = $1`,
                [boardId]
            );

            if (boardRes.rows.length === 0) continue;

            await pool.query(
                `INSERT INTO player_auction_boards
                 (auction_id, board_id, board_name)
                 VALUES ($1,$2,$3)`,
                [
                    auction_id,
                    boardId,
                    boardRes.rows[0].board_name
                ]
            );
        }

        res.json({
            success: true,
            message: "Boards added successfully"
        });

    } catch (error) {
        console.error("Add Boards Error:", error);
        res.status(500).json({ success: false });
    }
});


module.exports = router;
