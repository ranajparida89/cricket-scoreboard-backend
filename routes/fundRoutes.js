const express = require('express');
const router = express.Router();
const pool = require('../db');   // same pool used in other routes

/* ==========================================
GET WALLET BALANCE
========================================== */

router.get('/wallet/:board_id', async (req, res) => {

    try {

        const { board_id } = req.params;

        const wallet = await pool.query(`

SELECT 
bw.wallet_id,
bw.board_id,
bw.balance,
bw.total_earned,
bw.total_spent,
bw.wallet_status,
br.board_name

FROM board_wallet bw

JOIN board_registration br
ON bw.board_id = br.id

WHERE bw.board_id = $1

`, [board_id]);

        if (wallet.rows.length === 0) {

            return res.status(404).json({
                message: "Wallet not found"
            });

        }

        res.json(wallet.rows[0]);

    }
    catch (err) {

        console.error("Wallet API error:", err.message);

        res.status(500).json({
            message: "Server error"
        });

    }

});


/* ==========================================
TRANSACTION HISTORY
========================================== */

router.get('/transactions/:board_id', async (req, res) => {

    try {

        const { board_id } = req.params;

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
        `, [board_id]);

        res.json(transactions.rows);

    }
    catch (err) {

        console.error(err);

        res.status(500).json({
            message: "Server error"
        });

    }

});

/* ==========================================
CREATE TOURNAMENT (ADMIN)
========================================== */

router.post('/create-tournament', async (req, res) => {

    try {

        const { tournament_name, tournament_type, start_date } = req.body;

        if (!tournament_name || !tournament_type) {

            return res.status(400).json({
                message: "Tournament name and type required"
            });

        }

        const client = await pool.connect();

        try {

            await client.query('BEGIN');

            /* FETCH ENTRY FEE */

            const rule = await client.query(`
SELECT entry_fee
FROM fund_rules
WHERE tournament_type=$1
`, [tournament_type]);

            if (rule.rows.length === 0) {

                await client.query('ROLLBACK');

                return res.status(400).json({
                    message: "Invalid tournament type"
                });

            }

            const entryFee = rule.rows[0].entry_fee;


            /* CREATE TOURNAMENT */

            const tournament = await client.query(`

INSERT INTO ce_tournaments(

tournament_name,
tournament_type,
entry_fee,
start_date

)

VALUES($1,$2,$3,$4)

RETURNING tournament_id

`, [tournament_name, tournament_type, entryFee, start_date]);

            const tournamentId = tournament.rows[0].tournament_id;


            /* CREATE REWARD BANK */

            await client.query(`

INSERT INTO reward_bank(

tournament_id,
total_collected,
total_distributed,
remaining_balance

)

VALUES($1,0,0,0)

`, [tournamentId]);


            await client.query('COMMIT');

            res.json({

                message: "Tournament created successfully",

                tournament_id: tournamentId,

                entry_fee: entryFee

            });

        }
        catch (err) {

            await client.query('ROLLBACK');

            throw err;

        }
        finally {

            client.release();

        }

    }
    catch (err) {

        console.error("Tournament creation error:", err.message);

        res.status(500).json({
            message: "Server error"
        });

    }

});
module.exports = router;