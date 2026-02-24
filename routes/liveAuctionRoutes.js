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
module.exports = router;