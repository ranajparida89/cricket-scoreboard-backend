const express = require("express");
const router = express.Router();
const pool = require("../db");
/*
=========================================
MODULE 2.1 – CREATE AUCTION
=========================================
POST /api/live-auction/create
*/
router.post("/create", async (req, res) => {
    try {
        const {
            auction_name,
            total_members_expected,
            members_failed
        } = req.body;
        // Basic Validation
        if (!auction_name || !total_members_expected) {
            return res.status(400).json({
                error: "Auction name and total members required"
            });
        }
        if (members_failed > total_members_expected) {

            return res.status(400).json({
                error: "Failed members cannot exceed total members"
            });
        }
        const active_members_count =
            total_members_expected - (members_failed || 0);
        const result = await pool.query(`
INSERT INTO auction_master_live(
auction_name,
total_members_expected,
members_failed,
active_members_count
)
VALUES($1,$2,$3,$4)
RETURNING *
`,

            [
                auction_name,
                total_members_expected,
                members_failed || 0,
                active_members_count
            ]

        );
        res.json({
            success: true,
            auction: result.rows[0]
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "Server Error"
        });
    }
});
/*
=========================================
MODULE 2.2 – REGISTER BOARDS
=========================================
POST /api/live-auction/register-board/:auction_id
*/
router.post("/register-board/:auction_id", async (req, res) => {

    try {
        const { auction_id } = req.params;
        const { board_name } = req.body;

        if (!board_name) {

            return res.status(400).json({
                error: "Board name required"
            });
        }
        /*
        STEP 1 — Check Auction Exists
        */
        const auctionCheck = await pool.query(
            `SELECT * FROM auction_master_live
WHERE id=$1`,
            [auction_id]
        );
        if (auctionCheck.rows.length === 0) {
            return res.status(404).json({
                error: "Auction not found"
            });
        }
        const auction = auctionCheck.rows[0];
        /*
        STEP 2 — Check Active Board Limit
        */
        const boardCount = await pool.query(
            `SELECT COUNT(*) FROM auction_boards_live
WHERE auction_id=$1
AND is_participating=true`,
            [auction_id]
        );
        if (
            parseInt(boardCount.rows[0].count)
            >= auction.active_members_count
        ) {
            return res.status(400).json({
                error: "Maximum participating boards reached"
            });
        }
        /*
        STEP 3 — Insert Board
        */
        const result = await pool.query(`
INSERT INTO auction_boards_live(
auction_id,
board_name,
purse_remaining,
is_participating
)
VALUES($1,$2,$3,true)
RETURNING *
`,
            [
                auction_id,
                board_name,
                auction.initial_budget
            ]
        );
        res.json({
            success: true,
            board: result.rows[0]
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "Server Error"
        });
    }
});

/*
=========================================
MODULE 2.3 – PLAYER UPLOAD
=========================================
POST /api/live-auction/add-player/:auction_id
*/

router.post("/add-player/:auction_id", async (req, res) => {
    try {
        const { auction_id } = req.params;
        const {
            player_name,
            category,
            role,
            is_wicketkeeper
        } = req.body;

        if (!player_name || !category || !role) {
            return res.status(400).json({
                error: "Missing player fields"
            });
        }
        /*
        STEP 1 — Validate Category
        */
        const validCategories = [
            'DIAMOND',
            'PLATINUM',
            'GOLD',
            'SILVER'
        ];
        if (!validCategories.includes(category)) {

            return res.status(400).json({
                error: "Invalid category"
            });
        }

        /*
        STEP 2 — Validate Role
        */
        const validRoles = [
            'BATSMAN',
            'ALLROUNDER',
            'BOWLER'
        ];

        if (!validRoles.includes(role)) {
            return res.status(400).json({
                error: "Invalid role"
            });
        }
        /*
        STEP 3 — Get Auction Rules
        */
        const auctionData = await pool.query(
            `SELECT * FROM auction_master_live
WHERE id=$1`,
            [auction_id]

        );
        const auction = auctionData.rows[0];
        /*
        STEP 4 — Set Base Price Automatically
        */
        let basePrice = 0;
        if (category === "DIAMOND")
            basePrice = auction.diamond_base_price;
        if (category === "PLATINUM")
            basePrice = auction.platinum_base_price;
        if (category === "GOLD")
            basePrice = auction.gold_base_price;
        if (category === "SILVER")
            basePrice = auction.silver_base_price;
        /*
        STEP 5 — Insert Player
        */
        const result = await pool.query(
            `
INSERT INTO auction_players_live(
auction_id,
player_name,
category,
role,
is_wicketkeeper,
base_price
)

VALUES($1,$2,$3,$4,$5,$6)
RETURNING *
`,

            [
                auction_id,
                player_name,
                category,
                role,
                is_wicketkeeper || false,
                basePrice
            ]

        );
        res.json({
            success: true,
            player: result.rows[0]

        });

    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "Server Error"
        });

    }

});

/*
=========================================
MODULE 2.4 – START AUCTION
=========================================
POST /api/live-auction/start/:auction_id
*/
router.post("/start/:auction_id", async (req, res) => {
    try {
        const { auction_id } = req.params;
        /*
        STEP 1 — Check Auction
        */
        const auctionData = await pool.query(
            `SELECT * FROM auction_master_live
WHERE id=$1`,
            [auction_id]
        );
        if (auctionData.rows.length === 0) {
            return res.status(404).json({
                error: "Auction not found"
            });
        }
        const auction = auctionData.rows[0];
        /*
        STEP 2 — Check Boards
        */
        const boards = await pool.query(
            `SELECT COUNT(*) FROM auction_boards_live
WHERE auction_id=$1
AND is_participating=true`,
            [auction_id]
        );
        if (parseInt(boards.rows[0].count) === 0) {
            return res.status(400).json({
                error: "No boards registered"
            });
        }

        /*
        STEP 3 — Check Players
        */
        const players = await pool.query(
            `SELECT COUNT(*) FROM auction_players_live
WHERE auction_id=$1`,
            [auction_id]
        );
        if (parseInt(players.rows[0].count) < 20) {
            return res.status(400).json({
                error: "Not enough players uploaded"
            });

        }
        /*
        STEP 4 — Select First Player
        */
        const firstPlayer = await pool.query(
            `SELECT *
FROM auction_players_live
WHERE auction_id=$1
AND status='PENDING'
ORDER BY RANDOM()
LIMIT 1`,
            [auction_id]
        );
        if (firstPlayer.rows.length === 0) {
            return res.status(400).json({
                error: "No pending players"
            });
        }
        const player = firstPlayer.rows[0];
        /*
        STEP 5 — Set Player LIVE
        */
        await pool.query(
            `UPDATE auction_players_live
SET status='LIVE'
WHERE id=$1`,
            [player.id]
        );
        /*
        STEP 6 — Insert Live State
        */
        await pool.query(
            `
INSERT INTO auction_live_state(
auction_id,
current_player_id,
current_highest_bid,
timer_end_time
)
VALUES($1,$2,$3,NOW() +
INTERVAL '50 seconds')
`,
            [
                auction_id,
                player.id,
                player.base_price
            ]
        );
        /*
        STEP 7 — Update Auction Status
        */
        await pool.query(
            `UPDATE auction_master_live
SET status='LIVE'
WHERE id=$1`,
            [auction_id]
        );
        res.json({
            success: true,
            message: "Auction Started",
            first_player: player
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "Server Error"
        });
    }
});

/*
=========================================
MODULE 2.5 – PLACE BID ENGINE
=========================================
POST /api/live-auction/place-bid
*/
router.post("/place-bid", async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const {
            auction_id,
            board_id
        } = req.body;
        /*
        STEP 1 — Get Live State (LOCKED)
        */
        const liveState = await client.query(
            `SELECT *
            FROM auction_live_state
            WHERE auction_id=$1
            FOR UPDATE`,
            [auction_id]
        );
        if (liveState.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                error: "Auction not live"
            });
        }
        const state = liveState.rows[0];
        /*
        STEP 2 — Get Player
        */
        const playerData = await client.query(
            `SELECT *
            FROM auction_players_live
            WHERE id=$1`,
            [state.current_player_id]
        );
        const player = playerData.rows[0];
        /*
        STEP 3 — Get Board (LOCKED)
        */
        const boardData = await client.query(
            `SELECT *
FROM auction_boards_live
WHERE id=$1
FOR UPDATE`,
            [board_id]
        );
        if (boardData.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                error: "Board not found"
            });
        }
        const board = boardData.rows[0];
        // 🚫 SQUAD LIMIT PROTECTION

        if (Number(board.players_bought) >= 13) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                error: "Squad Full. Cannot bid more players."
            });
        }
        /*
        STEP 4 — Get Auction Rules
        */
        const auctionData = await client.query(
            `SELECT *
FROM auction_master_live
WHERE id=$1`,
            [auction_id]
        );
        const auction = auctionData.rows[0];
        /*
        STEP 5 — Determine Increment
        */
        let increment = 0;
        const category = String(player.category)
            .trim()
            .toUpperCase();
        if (category === "DIAMOND" || category === "LEGEND")
            increment = Number(auction.diamond_increment);
        else if (category === "PLATINUM")
            increment = Number(auction.platinum_increment);
        else if (category === "GOLD")
            increment = Number(auction.gold_increment);
        else if (category === "SILVER")
            increment = Number(auction.silver_increment);
        /*
        STEP 6 — Calculate Next Bid
        */
        const nextBid =
            Number(state.current_highest_bid)
            +
            Number(increment);
        /*
        STEP 7 — Purse Check
        */
        /*
       IMMEDIATE AUTO RECOVERY ENGINE
       */

        let purseNow = Number(board.purse_remaining);

        let recoveryMessage = null;

        if (purseNow < nextBid) {

            console.log("IMMEDIATE RECOVERY STARTED");

            const highPlayers =
                await client.query(
                    `
SELECT id,
sold_price
FROM auction_players_live
WHERE auction_id=$1
AND sold_to_board_id=$2
AND status='SOLD'
ORDER BY sold_price DESC
`,
                    [auction_id, board.id]
                );

            let purseCredit = 0;
            let playersRemoved = 0;

            for (const hp of highPlayers.rows) {

                purseCredit += Number(hp.sold_price);
                playersRemoved++;

                await client.query(`
UPDATE auction_players_live
SET
status='PENDING',
sold_price=NULL,
sold_to_board_id=NULL
WHERE id=$1
`, [hp.id]);

                if ((purseNow + purseCredit) >= nextBid)
                    break;

            }

            await client.query(`
UPDATE auction_boards_live
SET
purse_remaining = purse_remaining + $1,
players_bought = players_bought - $2
WHERE id=$3
`,
                [
                    purseCredit,
                    playersRemoved,
                    board.id
                ]
            );

            purseNow =
                purseNow + purseCredit;

            console.log(
                "IMMEDIATE RECOVERY DONE:",
                purseCredit
            );

            recoveryMessage =
                "⚠️ AUTO RECOVERY\n\n"
                + board.board_name
                + " had insufficient purse.\n\n"
                + "₹ " + purseCredit.toLocaleString()
                + " credited back.\n\n"
                + playersRemoved
                + " player(s) returned to auction.";

        }
        /*
        STEP 8 — Insert Bid
        */
        await client.query(
            `
INSERT INTO auction_bids_live(
auction_id,
player_id,
board_id,
bid_amount
)
VALUES($1,$2,$3,$4)
`,
            [
                auction_id,
                player.id,
                board_id,
                nextBid
            ]
        );
        /*
        STEP 9 — Update Live State
      /*
STEP 9 — Smart Timer Extension Engine
*/
        let extensionSeconds =
            auction.bid_time_extension;
        const remainingTimeQuery =
            await client.query(
                `SELECT EXTRACT(EPOCH FROM
(timer_end_time - NOW()))
AS remaining
FROM auction_live_state
WHERE auction_id=$1`,
                [auction_id]
            );
        const remainingTime =
            Number(
                remainingTimeQuery.rows[0].remaining
            );
        /*
        Anti-sniping logic
        */
        if (
            remainingTime
            <
            auction.anti_sniping_threshold
        ) {
            extensionSeconds =
                auction.anti_sniping_extension;
        }
        /*
        Update Live State
        */
        await client.query(
            `
UPDATE auction_live_state
SET
current_highest_bid=$1,
highest_bidder_board_id=$2,
timer_end_time=
NOW()
+
($3 || ' seconds')::interval
WHERE auction_id=$4
`,
            [
                nextBid,
                board_id,
                extensionSeconds,
                auction_id
            ]
        );

        await client.query("COMMIT");
        res.json({
            success: true,
            bidAmount: nextBid,
            board: board.board_name,
            player: player.player_name,
            updatedPurse: purseNow,
            recoveryMessage: recoveryMessage
        });
    }
    catch (err) {
        await client.query("ROLLBACK");
        console.log(err);
        res.status(500).json({
            error: "Server Error"
        });
    }
    finally {
        client.release();
    }
});

/*
=========================================
MODULE 2.6 – CLOSE PLAYER (SOLD ENGINE)
=========================================
POST /api/live-auction/close-player/:auction_id
*/

router.post("/close-player/:auction_id", async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const { auction_id } = req.params;
        /*
        STEP 1 — Get Live State (LOCKED)
        */
        const liveState = await client.query(
            `SELECT *
FROM auction_live_state
WHERE auction_id=$1
FOR UPDATE`,
            [auction_id]
        );
        if (liveState.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                error: "Auction not live"
            });
        }
        const state = liveState.rows[0];
        /*
        STEP 2 — Get Player
        */
        const playerData = await client.query(
            `SELECT *
            FROM auction_players_live
            WHERE id=$1
            FOR UPDATE`,
            [state.current_player_id]

        );
        const player = playerData.rows[0];
        /*

🚫 NO BID PROTECTION
If no board bid → player UNSOLD
BUT AUTO RECOVERY MUST RUN
*/

        if (!state.highest_bidder_board_id) {

            const squadLimit = 13;

            /*
            Get Silver Base Price
            */

            const minPriceQuery =
                await client.query(`
SELECT silver_base_price
FROM auction_master_live
WHERE id=$1
`, [auction_id]);

            const minPrice =
                Number(minPriceQuery.rows[0].silver_base_price);


            /*
            Get all boards
            */

            const boardsCheck =
                await client.query(`
SELECT *
FROM auction_boards_live
WHERE auction_id=$1
FOR UPDATE
`, [auction_id]);


            for (const b of boardsCheck.rows) {

                /*
                Condition:
                Less than 13 players
                AND
                Cannot buy Silver player
                */

                if (
                    Number(b.players_bought) < squadLimit
                    &&
                    Number(b.purse_remaining) < minPrice
                ) {

                    console.log(
                        "AUTO RECOVERY (UNSOLD CASE):",
                        b.board_name
                    );

                    /*
                    Get highest price players
                    */

                    const highPlayers =
                        await client.query(`
SELECT id,
sold_price
FROM auction_players_live
WHERE auction_id=$1
AND sold_to_board_id=$2
AND status='SOLD'
ORDER BY sold_price DESC
`, [
                            auction_id,
                            b.id
                        ]);


                    let purseCredit = 0;
                    let removedPlayers = 0;


                    for (const hp of highPlayers.rows) {

                        purseCredit += Number(hp.sold_price);
                        removedPlayers++;

                        /*
                        Return player to auction
                        */

                        await client.query(`
UPDATE auction_players_live
SET
status='PENDING',
sold_price=NULL,
sold_to_board_id=NULL
WHERE id=$1
`, [hp.id]);


                        /*
                        Stop when purse enough
                        */

                        if (
                            (Number(b.purse_remaining) + purseCredit)
                            >= minPrice
                        ) {
                            break;
                        }

                    }


                    /*
                    Update board purse
                    */

                    await client.query(`
UPDATE auction_boards_live
SET
purse_remaining = purse_remaining + $1,
players_bought = players_bought - $2
WHERE id=$3
`, [
                        purseCredit,
                        removedPlayers,
                        b.id
                    ]);

                }

            }


            /*
            Mark Player Unsold
            */

            await client.query(`
UPDATE auction_players_live
SET status='UNSOLD'
WHERE id=$1
`, [player.id]);


            await client.query("COMMIT");


            return res.json({
                success: true,
                message:
                    "Player Unsold + Auto Recovery Executed"
            });

        }
        /*
        STEP 3 — Get Winning Board
        */
        const boardData = await client.query(
            `SELECT *
FROM auction_boards_live
WHERE id=$1
FOR UPDATE`,
            [state.highest_bidder_board_id]

        );
        const board = boardData.rows[0];
        /*
        STEP 4 — Mark Player SOLD
        */
        await client.query(
            `
UPDATE auction_players_live
SET
status='SOLD',
sold_price=$1,
sold_to_board_id=$2
WHERE id=$3
`,
            [
                state.current_highest_bid,
                board.id,
                player.id
            ]
        );
        /*
        STEP 5 — Deduct Purse
        */
        const newPurse =
            Number(board.purse_remaining)
            -
            Number(state.current_highest_bid);
        await client.query(
            `
UPDATE auction_boards_live
SET
purse_remaining=$1,
players_bought=players_bought+1
WHERE id=$2
`,
            [
                newPurse,
                board.id
            ]
        );

        /*
==============================================================
AUTO PURSE RECOVERY ENGINE updated by Ranaj Parida 01/03/2026
==============================================================
*/

        const squadLimit = 13;

        /*
        Get minimum silver price
        */

        const minPriceQuery =
            await client.query(`
SELECT silver_base_price
FROM auction_master_live
WHERE id=$1
`, [auction_id]);

        const minPrice =
            Number(minPriceQuery.rows[0].silver_base_price);

        /*
        Remaining players needed
        */

        const remainingPlayers =
            squadLimit -
            Number(board.players_bought);

        /*
        Minimum purse required
        */

        const minimumRequired =
            remainingPlayers * minPrice;

        /*
        Check purse viability
        */

        if (newPurse < minimumRequired) {

            console.log("AUTO RECOVERY STARTED");

            /*
            Get highest priced players
            */

            const highPlayers =
                await client.query(

                    `
SELECT id,
player_name,
sold_price,
category,
role,
is_wicketkeeper
FROM auction_players_live
WHERE auction_id=$1
AND sold_to_board_id=$2
AND status='SOLD'
ORDER BY sold_price DESC
`,
                    [
                        auction_id,
                        board.id
                    ]

                );

            let recoveryMessage = null;
            let purseCredit = 0;
            let playersRemoved = 0;

            for (const hp of highPlayers.rows) {

                purseCredit += Number(hp.sold_price);
                playersRemoved++;

                /*
                Return player to auction
                */

                await client.query(`
UPDATE auction_players_live
SET
status='PENDING',
sold_price=NULL,
sold_to_board_id=NULL
WHERE id=$1
`, [hp.id]);

                /*
                Stop when purse enough
                */

                const purseAfterRecovery =
                    newPurse + purseCredit;

                const playersAfterRecovery =
                    Number(board.players_bought)
                    -
                    playersRemoved;

                const remainingNeeded =
                    squadLimit -
                    playersAfterRecovery;

                const requiredAfterRecovery =
                    remainingNeeded * minPrice;

                if (purseAfterRecovery >= requiredAfterRecovery) {

                    break;

                }

            }

            /*
            Update board purse
            */

            await client.query(

                `
UPDATE auction_boards_live
SET
purse_remaining=$1,
players_bought=
players_bought-$2
WHERE id=$3
`,
                [
                    newPurse + purseCredit,
                    playersRemoved,
                    board.id
                ]

            );

            console.log(
                "RECOVERY COMPLETE:",
                purseCredit
            );

        }


        /*
        STEP 6 — Update Category Count
        */
        await client.query(`
UPDATE auction_boards_live
SET
diamond_count =
diamond_count +
CASE WHEN $1='DIAMOND' THEN 1 ELSE 0 END,
platinum_count =
platinum_count +
CASE WHEN $1='PLATINUM' THEN 1 ELSE 0 END,
gold_count =
gold_count +
CASE WHEN $1='GOLD' THEN 1 ELSE 0 END,
silver_count =
silver_count +
CASE WHEN $1='SILVER' THEN 1 ELSE 0 END
WHERE id=$2
`,
            [
                player.category,
                board.id
            ]);
        /*
        STEP 7 — Update Role Count
        */
        await client.query(`
UPDATE auction_boards_live
SET
batsmen_count =
batsmen_count +
CASE WHEN $1='BATSMAN' THEN 1 ELSE 0 END,
allrounder_count =
allrounder_count +
CASE WHEN $1='ALLROUNDER' THEN 1 ELSE 0 END,
bowler_count =
bowler_count +
CASE WHEN $1='BOWLER' THEN 1 ELSE 0 END,
wicketkeeper_count =
wicketkeeper_count +
CASE WHEN $2=true THEN 1 ELSE 0 END
WHERE id=$3
`,
            [
                player.role,
                player.is_wicketkeeper,
                board.id
            ]);
        /*
       /*
STEP 8 — Select Next Player (Admin Control + Random Mix)
*/

        // Get Admin Filters
        const controlData = await client.query(
            `
SELECT *
FROM auction_admin_control
WHERE auction_id=$1
`,
            [auction_id]
        );

        let categoryFilter = 'ALL';
        let roleFilter = 'ALL';

        if (controlData.rows.length > 0) {

            categoryFilter =
                controlData.rows[0].category_filter;

            roleFilter =
                controlData.rows[0].role_filter;

        }

        // Select Next Player

        const nextPlayer = await client.query(
            `
SELECT *
FROM auction_players_live
WHERE auction_id=$1
AND status='PENDING'

AND (
$2='ALL'
OR TRIM(UPPER(category))=$2
)

AND (
$3='ALL'
OR TRIM(UPPER(role))=$3
)

ORDER BY RANDOM()

LIMIT 1
`,
            [
                auction_id,
                categoryFilter,
                roleFilter
            ]
        );
        if (nextPlayer.rows.length > 0) {
            const np = nextPlayer.rows[0];
            await client.query(
                `
UPDATE auction_players_live
SET status='LIVE'
WHERE id=$1
`,
                [np.id]
            );
            await client.query(
                `
UPDATE auction_live_state
SET
current_player_id=$1,
current_highest_bid=$2,
highest_bidder_board_id=NULL,
timer_end_time=NOW()
+ INTERVAL '50 seconds'
WHERE auction_id=$3
`,

                [
                    np.id,
                    np.base_price,
                    auction_id
                ]
            );

        }
        await client.query("COMMIT");
        res.json({
            success: true,
            message:
                board.board_name
                + " bought "
                + player.player_name
                + " for ₹"
                + state.current_highest_bid,
            soldPlayer: player.player_name,
            soldTo: board.board_name,
            price: state.current_highest_bid
        });
    }
    catch (err) {
        await client.query("ROLLBACK");
        console.log(err);
        res.status(500).json({
            error: "Server Error"
        });
    }
    finally {
        client.release();
    }
});

/*
=========================================
MODULE 2.7 – FETCH REGISTERED BOARDS
(Admin Auction Setup)
=========================================
GET /api/live-auction/registered-boards
*/

router.get("/registered-boards", async (req, res) => {
    try {

        const boards =
            await pool.query(`
SELECT
registration_id AS board_id,
board_name,
owner_name
FROM board_registration
ORDER BY board_name
`);
        res.json({
            success: true,
            boards: boards.rows
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "Server Error"
        });
    }
});

/*
=========================================
MODULE 2.8 – SAVE PARTICIPATING BOARDS
(Admin Auction Setup)
=========================================
POST /api/live-auction/save-participants/:auction_id
*/

router.post(
    "/save-participants/:auction_id",
    async (req, res) => {

        try {

            const { auction_id } = req.params;
            const { boards } = req.body;

            if (!boards || boards.length === 0) {

                return res.status(400).json({
                    error: "No boards selected"
                });

            }

            /*
            STEP 1 — Clear old boards
            */

            /*
  STEP 1 — Delete old bids
  */

            await pool.query(
                `DELETE FROM auction_bids_live
 WHERE auction_id=$1`,
                [auction_id]
            );

            /*
            STEP 2 — Delete old boards
            */

            await pool.query(
                `DELETE FROM auction_boards_live
 WHERE auction_id=$1`,
                [auction_id]
            );

            /*
            STEP 2 — Insert boards
            */

            for (const b of boards) {

                /*
                Get board info safely
                */

                const boardInfo =
                    await pool.query(
                        `SELECT board_name
                    FROM board_registration
                    WHERE registration_id=$1`,
                        [b.board_id]
                    );

                /*
                If board not found
                */

                if (boardInfo.rows.length === 0) {

                    return res.status(400).json({

                        error:
                            "Board not found: "
                            + b.board_id

                    });

                }

                const boardName =
                    boardInfo.rows[0].board_name;

                /*
                Insert board
                */

                await pool.query(

                    `
INSERT INTO auction_boards_live
(
id,
auction_id,
board_name,
purse_remaining,
players_bought,
diamond_count,
platinum_count,
gold_count,
silver_count,
batsmen_count,
allrounder_count,
bowler_count,
wicketkeeper_count,
is_participating,
is_connected
)

VALUES(
gen_random_uuid(),
$1,$2,$3,
0,0,0,0,0,0,0,0,0,
true,
false
)

`,

                    [
                        auction_id,
                        boardName,
                        b.purse || 100000000
                    ]

                );

            }

            res.json({

                success: true,
                message: "Participants Saved"

            });

        }

        catch (err) {

            console.log("SAVE PARTICIPANTS ERROR:", err);

            res.status(500).json({

                error: "Server Error"

            });

        }

    });
/*
=========================================
MODULE 4.1 – LIVE AUCTION STATUS API
=========================================
GET /api/live-auction/status/:auction_id
*/
router.get("/status/:auction_id", async (req, res) => {
    try {
        const { auction_id } = req.params;
        /*
        STEP 1 — Live State
        */
        const liveState = await pool.query(
            `SELECT *
FROM auction_live_state
WHERE auction_id=$1`,
            [auction_id]
        );
        if (liveState.rows.length === 0) {
            return res.status(400).json({
                error: "Auction not live"
            });
        }
        const state = liveState.rows[0];
        /*
        STEP 2 — Player Info
        */
        const playerData = await pool.query(
            `SELECT *
FROM auction_players_live
WHERE id=$1`,
            [state.current_player_id]
        );
        const player = playerData.rows[0];
        /*
        STEP 3 — Leading Board
        */
        let boardName = null;
        if (state.highest_bidder_board_id) {
            const boardData = await pool.query(
                `SELECT board_name
FROM auction_boards_live
WHERE id=$1`,
                [state.highest_bidder_board_id]

            );
            boardName =
                boardData.rows[0].board_name;
        }
        /*
        STEP 4 — Timer Remaining
        */
        const timerQuery =
            await pool.query(
                `SELECT EXTRACT(EPOCH FROM
(timer_end_time - NOW()))
AS seconds
FROM auction_live_state
WHERE auction_id=$1`,
                [auction_id]
            );
        const secondsRemaining =
            Math.max(
                0,
                Math.floor(
                    timerQuery.rows[0].seconds
                )
            );

        /*
        STEP 5 — Response
        */
        res.json({
            success: true,
            player_name:
                player.player_name,
            category:
                player.category,
            role:
                player.role,
            base_price:
                player.base_price,
            current_price:
                state.current_highest_bid,
            leading_board:
                boardName,
            timer_seconds:
                state.is_paused
                    ?
                    state.paused_seconds
                    :
                    secondsRemaining,

            is_paused:
                state.is_paused
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "Server Error"
        });
    }
});

/*
=========================================
MODULE 4.2 – BID HISTORY API
=========================================
GET /api/live-auction/bids/:auction_id
*/

router.get("/bids/:auction_id", async (req, res) => {
    try {
        const { auction_id } = req.params;
        /*
        STEP 1 — Current Player
        */
        const liveState = await pool.query(
            `SELECT current_player_id
FROM auction_live_state
WHERE auction_id=$1`,
            [auction_id]
        );
        if (liveState.rows.length === 0) {
            return res.status(400).json({
                error: "Auction not live"
            });
        }
        const player_id =
            liveState.rows[0].current_player_id;

        /*
        STEP 2 — Bid History
        */
        const bids =
            await pool.query(
                `
SELECT
b.bid_amount,
b.bid_time,
bd.board_name
FROM auction_bids_live b
JOIN auction_boards_live bd
ON b.board_id=bd.id
WHERE b.player_id=$1
ORDER BY b.bid_time DESC
LIMIT 20
`,
                [player_id]
            );

        /*
        STEP 3 — Response
        */
        res.json({
            success: true,
            bids: bids.rows
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "Server Error"
        });
    }
});

/*
=========================================
MODULE 4.3 – BOARD PURSE API
=========================================
GET /api/live-auction/boards/:auction_id
*/
router.get("/boards/:auction_id", async (req, res) => {
    try {
        const { auction_id } = req.params;
        /*
        STEP 1 — Get Boards
        */
        const boards =
            await pool.query(
                `
SELECT
b.id as board_id,
b.board_name,
br.owner_name,
b.board_name || '-' || br.owner_name
AS display_name,
b.purse_remaining,
b.players_bought,
b.diamond_count,
b.platinum_count,
b.gold_count,
b.silver_count,
b.batsmen_count,
b.allrounder_count,
b.bowler_count,
b.wicketkeeper_count
FROM auction_boards_live b
LEFT JOIN board_registration br
ON TRIM(UPPER(br.board_name)) = TRIM(UPPER(b.board_name))
WHERE b.auction_id=$1
ORDER BY b.board_name
`,
                [auction_id]
            );

        /*
        STEP 2 — Response
        */
        res.json({
            success: true,
            boards: boards.rows
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({
            error: "Server Error"
        });
    }
});

// ✅ GET SOLD PLAYERS LIST
router.get("/sold-players/:auction_id", async (req, res) => {

    try {

        const { auction_id } = req.params;

        const result = await pool.query(
            `
SELECT
p.player_name,
p.category,
p.role,
p.sold_price,
b.board_name
FROM auction_players_live p
LEFT JOIN auction_boards_live b
ON p.sold_to_board_id = b.id
WHERE p.auction_id = $1
AND p.status = 'SOLD'
ORDER BY p.id DESC
`,
            [auction_id]
        );

        res.json(result.rows);

    }
    catch (err) {
        console.error("Sold Players Error", err);
        res.status(500).json({ error: "Server Error" });
    }

});
// ✅ BOARD SQUAD API

router.get("/board-squad/:auction_id/:board_id", async (req, res) => {
    try {
        const { auction_id, board_id } = req.params;

        /* Get Squad Players */
        const players = await pool.query(
            `
SELECT
player_name,
category,
role,
sold_price
FROM auction_players_live
WHERE auction_id=$1
AND sold_to_board_id=$2
ORDER BY category DESC
`,
            [auction_id, board_id]
        );
        /* Get Board Purse (REAL-TIME CALCULATION) */

        const board = await pool.query(
            `
        SELECT
        b.board_name,
        b.purse_remaining,
        COUNT(p.id) AS players_bought
        FROM auction_boards_live b
        LEFT JOIN auction_players_live p
        ON p.sold_to_board_id=b.id
        AND p.status='SOLD'
        WHERE b.id=$1
        GROUP BY
        b.board_name,
        b.purse_remaining
`,
            [board_id]
        );
        res.json({
            board: board.rows[0],
            players: players.rows
        });
    }
    catch (err) {
        console.log("Board Squad Error", err);
        res.status(500).json({
            error: "Server Error"
        });
    }
});
// ✅ EXPORT BOARD SQUADS TO EXCEL (CSV)

router.get("/export-squads/:auction_id", async (req, res) => {
    try {
        const { auction_id } = req.params;
        const result = await pool.query(
            `
SELECT
b.board_name,
p.player_name,
p.category,
p.role,
p.sold_price
FROM auction_players_live p
JOIN auction_boards_live b
ON p.sold_to_board_id=b.id
WHERE p.auction_id=$1
AND p.status='SOLD'
ORDER BY b.board_name,p.category DESC
`,
            [auction_id]
        );
        /* Convert to CSV */
        let csv =
            "Board Name,Player Name,Category,Role,Sold Price\n";
        result.rows.forEach(r => {
            csv +=
                r.board_name + "," +
                r.player_name + "," +
                r.category + "," +
                r.role + "," +
                r.sold_price +
                "\n";
        });
        res.setHeader(
            "Content-Type",
            "text/csv"
        );
        res.setHeader(
            "Content-Disposition",
            "attachment; filename=auction_squads.csv"
        );
        res.send(csv);
    }
    catch (err) {
        console.log("Export Error", err);
        res.status(500).json({
            error: "Export Failed"
        });
    }
});

// ✅ RESET AUCTION API

router.post("/reset-auction/:auction_id", async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const { auction_id } = req.params;
        /* Reset Players */
        await client.query(
            `
UPDATE auction_players_live
SET
status='PENDING',
sold_price=NULL,
sold_to_board_id=NULL
WHERE auction_id=$1
`,
            [auction_id]
        );
        /* Reset Boards */
        await client.query(
            `
UPDATE auction_boards_live
SET
purse_remaining=1200000000,
players_bought=0,
diamond_count=0,
platinum_count=0,
gold_count=0,
silver_count=0,
batsmen_count=0,
allrounder_count=0,
bowler_count=0,
wicketkeeper_count=0
WHERE auction_id=$1
`,
            [auction_id]
        );

        /* Delete Bids */
        await client.query(
            `
DELETE FROM auction_bids_live
WHERE auction_id=$1
`,
            [auction_id]
        );
        /* Delete Live State */
        await client.query(
            `
DELETE FROM auction_live_state
WHERE auction_id=$1
`,
            [auction_id]
        );
        await client.query("COMMIT");
        res.json({
            success: true,
            message: "Auction Reset Complete"
        });
    }
    catch (err) {
        await client.query("ROLLBACK");
        console.log("RESET ERROR", err);
        res.status(500).json({
            error: "Reset Failed"
        });
    }
    finally {
        client.release();
    }
});

// ✅ PAUSE AUCTION API

// ✅ PAUSE AUCTION API

// ✅ PAUSE AUCTION API (FINAL FIXED)

router.post("/pause-auction/:auction_id", async (req, res) => {
    try {
        const { auction_id } = req.params;
        /*
        STEP 1 — Get Live State
        */
        const stateCheck = await pool.query(
            `
            SELECT is_paused,timer_end_time
            FROM auction_live_state
            WHERE auction_id=$1
            `,
            [auction_id]
        );
        if (stateCheck.rows.length === 0) {
            return res.status(400).json({
                error: "Auction not live"
            });
        }
        const state = stateCheck.rows[0];
        /*
        STEP 2 — If already paused → DO NOTHING
        */
        if (state.is_paused) {
            return res.json({
                success: true,
                message: "Auction Already Paused"
            });
        }
        /*
        STEP 3 — Calculate Remaining Seconds
        */
        const secondsQuery =
            await pool.query(
                `
                SELECT EXTRACT(EPOCH FROM
                (timer_end_time - NOW()))
                AS seconds
                FROM auction_live_state
                WHERE auction_id=$1
                `,
                [auction_id]
            );
        const secondsRemaining =
            Math.max(
                0,
                Math.floor(
                    secondsQuery.rows[0].seconds
                )
            );
        /*
        STEP 4 — Store Pause
        */
        await pool.query(
            `
            UPDATE auction_live_state
            SET
            is_paused=true,
            paused_seconds=$1
            WHERE auction_id=$2
            `,
            [
                secondsRemaining,
                auction_id
            ]
        );
        res.json({
            success: true,
            message: "Auction Paused",
            secondsRemaining
        });
    }
    catch (err) {
        console.log("Pause Error:", err);
        res.status(500).json({
            error: "Pause Failed"
        });
    }
});

/*
=========================================
RESUME AUCTION API
=========================================
POST /api/live-auction/resume-auction/:auction_id
*/

router.post("/resume-auction/:auction_id", async (req, res) => {

    try {

        const { auction_id } = req.params;

        /*
        STEP 1 — Get Live State
        */

        const stateCheck = await pool.query(
            `
            SELECT is_paused, paused_seconds
            FROM auction_live_state
            WHERE auction_id=$1
            `,
            [auction_id]
        );

        if (stateCheck.rows.length === 0) {

            return res.status(400).json({
                error: "Auction not live"
            });

        }

        const state = stateCheck.rows[0];

        /*
        STEP 2 — If not paused
        */

        if (!state.is_paused) {

            return res.json({
                success: true,
                message: "Auction Already Running"
            });

        }

        /*
        STEP 3 — Resume Timer
        */

        await pool.query(
            `
            UPDATE auction_live_state
            SET
            is_paused=false,
            timer_end_time =
            NOW() + (paused_seconds || ' seconds')::interval
            WHERE auction_id=$1
            `,
            [auction_id]
        );

        res.json({

            success: true,
            message: "Auction Resumed"

        });

    }

    catch (err) {

        console.log("Resume Error:", err);

        res.status(500).json({
            error: "Resume Failed"
        });

    }

});

/*
=========================================
/*
=========================================
MODULE 2.9 – LOAD PLAYERS FROM MASTER
=========================================
POST /api/live-auction/load-from-master/:auction_id
*/

/*
=========================================
MODULE 2.9 – LOAD PLAYERS FROM MASTER
=========================================
POST /api/live-auction/load-from-master/:auction_id
*/
/*
=========================================
MODULE 2.9 – LOAD PLAYERS FROM MASTER (FINAL STABLE)
=========================================
POST /api/live-auction/load-from-master/:auction_id
*/

/*
=========================================
MODULE 2.9 – LOAD PLAYERS FROM MASTER (FINAL STABLE)
=========================================
POST /api/live-auction/load-from-master/:auction_id
*/

router.post("/load-from-master/:auction_id", async (req, res) => {
    try {
        const { auction_id } = req.params;

        /*
        STEP 1 — Check Auction Exists
        */
        const auctionCheck = await pool.query(
            `SELECT * FROM auction_master_live
 WHERE id=$1`,
            [auction_id]
        );
        if (auctionCheck.rows.length === 0) {
            return res.status(404).json({
                error: "Auction not found"
            });
        }
        const auction = auctionCheck.rows[0];
        /*
        STEP 2 — SAFE DELETE ORDER
        */
        await pool.query(
            `DELETE FROM auction_live_state
 WHERE auction_id=$1`,
            [auction_id]
        );
        await pool.query(
            `DELETE FROM auction_bids_live
 WHERE auction_id=$1`,
            [auction_id]
        );
        await pool.query(
            `DELETE FROM auction_players_live
 WHERE auction_id=$1`,
            [auction_id]
        );
        /*
        STEP 3 — INSERT FROM MASTER (FINAL SAFE)
        */
        const insertResult = await pool.query(

            `
INSERT INTO auction_players_live
(
auction_id,
player_name,
category,
role,
is_wicketkeeper,
base_price,
status
)
SELECT
$1,
player_name,
UPPER(category),
CASE
WHEN skills ILIKE '%round%' THEN 'ALLROUNDER'
WHEN skills ILIKE '%bowl%' 
OR skills ILIKE '%rf%'
OR skills ILIKE '%lf%'
OR skills ILIKE '%spin%'
OR skills ILIKE '%os%'
OR skills ILIKE '%slo%'
OR skills ILIKE '%ls%'
THEN 'BOWLER'
ELSE 'BATSMAN'
END,
CASE
WHEN role ILIKE '%wk%'
OR skills ILIKE '%wk%'
THEN true
ELSE false
END,
CASE
WHEN UPPER(category)='LEGEND'
THEN $2::bigint
WHEN UPPER(category)='DIAMOND'
THEN $2::bigint
WHEN UPPER(category)='PLATINUM'
THEN $3::bigint
WHEN UPPER(category)='GOLD'
THEN $4::bigint
WHEN UPPER(category)='SILVER'
THEN $5::bigint
ELSE $5::bigint
END,
'PENDING'
FROM player_master
`,
            [
                auction_id,
                auction.diamond_base_price,
                auction.platinum_base_price,
                auction.gold_base_price,
                auction.silver_base_price
            ]

        );

        res.json({

            success: true,
            message: insertResult.rowCount + " Players Loaded From Master"

        });

    }

    catch (err) {

        console.log("LOAD PLAYERS ERROR:", err);

        res.status(500).json({
            error: err.message
        });

    }
});

// ===========================================
// END LIVE AUCTION (FINAL FIX)
// ===========================================

router.post("/end-auction/:auction_id", async (req, res) => {
    const { auction_id } = req.params;

    try {
        console.log("Ending auction:", auction_id);
        // Update auction status
        await pool.query(`
      UPDATE auction_master_live
      SET status='COMPLETED'
      WHERE id=$1
    `, [auction_id]);

        // Remove live state
        await pool.query(`
      DELETE FROM auction_live_state
      WHERE auction_id=$1
    `, [auction_id]);

        res.json({
            success: true,
            message: "Auction Ended Successfully"
        });

    } catch (err) {

        console.error("END AUCTION ERROR:", err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }

});

/*
=========================================
ADMIN CONTROL – CATEGORY / ROLE FILTER
=========================================
POST /api/live-auction/admin-control/:auction_id
*/

router.post("/admin-control/:auction_id", async (req, res) => {
    try {
        const { auction_id } = req.params;
        const { category, role } = req.body;
        await pool.query(`
INSERT INTO auction_admin_control
(
auction_id,
category_filter,
role_filter
)
VALUES($1,$2,$3)
ON CONFLICT(auction_id)
DO UPDATE SET
category_filter=$2,
role_filter=$3,
updated_at=NOW()
`, [
            auction_id,
            category || 'ALL',
            role || 'ALL'
        ]);
        res.json({
            success: true,
            message: "Admin Control Updated"
        });
    }
    catch (err) {
        console.log("Admin Control Error", err);
        res.status(500).json({
            error: "Admin Control Failed"
        });
    }
});
module.exports = router;