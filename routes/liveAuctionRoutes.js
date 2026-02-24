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

try{
const { auction_id } = req.params;
const { board_name } = req.body;

if(!board_name){

return res.status(400).json({
error:"Board name required"
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
if(auctionCheck.rows.length === 0){
return res.status(404).json({
error:"Auction not found"
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
if(
parseInt(boardCount.rows[0].count)
>= auction.active_members_count
){
return res.status(400).json({
error:"Maximum participating boards reached"
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
success:true,
board:result.rows[0]
});
}
catch(err){
console.log(err);
res.status(500).json({
error:"Server Error"
});
}
});
module.exports = router;