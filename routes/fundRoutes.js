const express = require('express');
const router = express.Router();
const pool = require('../db');   // same pool used in other routes

/* ==========================================
GET WALLET BALANCE
========================================== */

router.get('/wallet/:board_id', async (req,res)=>{
    try{

        const {board_id} = req.params;

        const wallet = await pool.query(`
            SELECT 
            bw.wallet_id,
            bw.balance,
            bw.total_earned,
            bw.total_spent,
            bw.wallet_status,
            br.board_name

            FROM board_wallet bw
            JOIN board_registration br
            ON bw.board_id = br.board_id

            WHERE bw.board_id = $1
        `,[board_id]);

        if(wallet.rows.length === 0){
            return res.status(404).json({
                message:"Wallet not found"
            });
        }

        res.json(wallet.rows[0]);

    }
    catch(err){
        console.error(err);
        res.status(500).json({
            message:"Server error"
        });
    }
});


/* ==========================================
TRANSACTION HISTORY
========================================== */

router.get('/transactions/:board_id', async (req,res)=>{

    try{

        const {board_id} = req.params;

        const transactions = await pool.query(`
            SELECT
            transaction_id,
            transaction_type,
            amount,
            balance_before,
            balance_after,
            remarks,
            created_at

            FROM coin_transactions

            WHERE board_id = $1

            ORDER BY created_at DESC
        `,[board_id]);

        res.json(transactions.rows);

    }
    catch(err){

        console.error(err);

        res.status(500).json({
            message:"Server error"
        });

    }

});


module.exports = router;