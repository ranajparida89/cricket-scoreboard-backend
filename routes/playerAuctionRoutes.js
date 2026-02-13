const express = require("express");
const router = express.Router();
const pool = require("../db"); // make sure this matches your DB connection file

// ===============================
// CREATE NEW AUCTION
// ===============================
router.post("/create-auction", async (req, res) => {
    try {
        const {
            auction_name,
            total_boards,
            created_by
        } = req.body;

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

module.exports = router;
