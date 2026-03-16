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

/* ==========================================
TOURNAMENT REGISTRATION + ENTRY DEDUCTION
========================================== */

router.post('/register-tournament', async (req, res) => {

    try {

        const { tournament_id, board_id, consent_given } = req.body;

        if (!tournament_id || !board_id) {

            return res.status(400).json({
                message: "Tournament and board required"
            });

        }

        if (consent_given !== true) {

            return res.status(400).json({
                message: "Consent required"
            });

        }

        const client = await pool.connect();

        try {

            await client.query('BEGIN');

            /* GET TOURNAMENT */

            const tournament = await client.query(`

SELECT entry_fee,tournament_status
FROM ce_tournaments
WHERE tournament_id=$1

`, [tournament_id]);

            if (tournament.rows.length === 0) {

                await client.query('ROLLBACK');

                return res.status(404).json({
                    message: "Tournament not found"
                });

            }

            const entryFee = tournament.rows[0].entry_fee;

            /* CHECK REGISTRATION STATUS */

            if (tournament.rows[0].tournament_status !== 'REGISTRATION_OPEN') {

                await client.query('ROLLBACK');

                return res.status(400).json({
                    message: "Registration closed"
                });

            }

            /* CHECK IF ALREADY REGISTERED */

            const existing = await client.query(`

SELECT registration_id
FROM tournament_registrations

WHERE tournament_id=$1
AND board_id=$2

`, [tournament_id, board_id]);

            if (existing.rows.length > 0) {

                await client.query('ROLLBACK');

                return res.status(400).json({
                    message: "Board already registered"
                });

            }
            /* GET WALLET */

            const wallet = await client.query(`

SELECT wallet_id,balance
FROM board_wallet
WHERE board_id=$1

`, [board_id]);

            if (wallet.rows.length === 0) {

                await client.query('ROLLBACK');

                return res.status(404).json({
                    message: "Wallet not found"
                });

            }

            const walletId = wallet.rows[0].wallet_id;
            const balance = wallet.rows[0].balance;


            /* CHECK BALANCE */

            if (balance < entryFee) {

                await client.query(`

INSERT INTO failed_transactions(

board_id,
tournament_id,
required_amount,
available_balance,
reason

)

VALUES($1,$2,$3,$4,'INSUFFICIENT_FUNDS')

`, [board_id, tournament_id, entryFee, balance]);

                await client.query('ROLLBACK');

                return res.status(400).json({
                    message: "Insufficient funds"
                });

            }


            /* DEDUCT ENTRY FEE */

            const newBalance = balance - entryFee;

            await client.query(`

UPDATE board_wallet

SET balance=$1,
total_spent = total_spent + $2

WHERE board_id=$3

`, [newBalance, entryFee, board_id]);


            /* INSERT REGISTRATION */

            await client.query(`

INSERT INTO tournament_registrations(

tournament_id,
board_id,
entry_fee,
consent_given

)

VALUES($1,$2,$3,$4)

`, [tournament_id, board_id, entryFee, consent_given]);


            /* LEDGER ENTRY */

            await client.query(`

INSERT INTO coin_transactions(

board_id,
wallet_id,
transaction_type,
amount,
balance_before,
balance_after,
reference_id,
reference_type,
remarks

)

VALUES(

$1,
$2,
'TOURNAMENT_ENTRY',
$3,
$4,
$5,
$6,
'TOURNAMENT',
'Tournament entry fee deducted'

)

`, [board_id, walletId, entryFee, balance, newBalance, tournament_id]);


            /* UPDATE REWARD BANK */

            await client.query(`

UPDATE reward_bank

SET total_collected = total_collected + $1,
remaining_balance = remaining_balance + $1

WHERE tournament_id=$2

`, [entryFee, tournament_id]);


            await client.query('COMMIT');

            res.json({

                message: "Tournament registered",

                entry_fee_deducted: entryFee,

                remaining_balance: newBalance

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

        console.error("Tournament registration error:", err.message);

        res.status(500).json({
            message: "Server error"
        });

    }

});
/* ==========================================
GET ALL TOURNAMENTS
========================================== */

router.get('/tournaments', async (req, res) => {

    try {

        const tournaments = await pool.query(`

SELECT
tournament_id,
tournament_name,
tournament_type,
entry_fee,
start_date,
tournament_status,
created_at

FROM ce_tournaments

ORDER BY created_at DESC

`);

        res.json(tournaments.rows);

    }
    catch (err) {

        console.error(err);

        res.status(500).json({
            message: "Server error"
        });

    }

});

/* ==========================================
GET REGISTERED BOARDS IN TOURNAMENT
========================================== */

router.get('/tournament-boards/:tournament_id', async (req, res) => {

    try {

        const { tournament_id } = req.params;

        const boards = await pool.query(`

SELECT

tr.board_id,
br.board_name,
tr.entry_fee,
tr.registered_at

FROM tournament_registrations tr

JOIN board_registration br
ON tr.board_id = br.id

WHERE tr.tournament_id=$1

ORDER BY tr.registered_at

`, [tournament_id]);

        res.json(boards.rows);

    }
    catch (err) {

        console.error(err);

        res.status(500).json({
            message: "Server error"
        });

    }

});

/* ==========================================
CLOSE TOURNAMENT
========================================== */

router.put('/close-tournament/:tournament_id', async (req, res) => {

    try {

        const { tournament_id } = req.params;

        const result = await pool.query(`

UPDATE ce_tournaments

SET tournament_status='REGISTRATION_CLOSED'

WHERE tournament_id=$1

RETURNING tournament_id

`, [tournament_id]);

        if (result.rows.length === 0) {

            return res.status(404).json({
                message: "Tournament not found"
            });

        }

        res.json({
            message: "Tournament closed",
            tournament_id: tournament_id
        });

    }
    catch (err) {

        console.error(err);

        res.status(500).json({
            message: "Server error"
        });

    }

});
/* ==========================================
GET OPEN TOURNAMENTS
========================================== */

router.get('/open-tournaments', async (req, res) => {

    try {

        const tournaments = await pool.query(`

SELECT
tournament_id,
tournament_name,
tournament_type,
entry_fee,
start_date

FROM ce_tournaments

WHERE tournament_status='REGISTRATION_OPEN'

ORDER BY created_at DESC

`);

        res.json(tournaments.rows);

    }
    catch (err) {

        console.error(err);

        res.status(500).json({
            message: "Server error"
        });

    }

});
/* ==========================================
GET BOARD TOURNAMENTS
========================================== */

router.get('/board-tournaments/:board_id', async (req, res) => {

    try {

        const { board_id } = req.params;

        const data = await pool.query(`

SELECT

ct.tournament_id,
ct.tournament_name,
ct.tournament_type,
tr.entry_fee,
tr.registered_at

FROM tournament_registrations tr

JOIN ce_tournaments ct
ON tr.tournament_id = ct.tournament_id

WHERE tr.board_id=$1

ORDER BY tr.registered_at DESC

`, [board_id]);

        res.json(data.rows);

    }
    catch (err) {

        console.error(err);

        res.status(500).json({
            message: "Server error"
        });

    }

});

/* ==========================================
DECLARE TOURNAMENT RESULT + DISTRIBUTE REWARD
========================================== */

router.post('/declare-result', async (req, res) => {

    try {

        const { tournament_id, winner_team, runner_team } = req.body;

        if (!tournament_id || !winner_team || !runner_team) {

            return res.status(400).json({
                message: "Tournament, winner and runner required"
            });

        }

        const client = await pool.connect();

        try {

            await client.query('BEGIN');

            /* GET REWARD BANK */

            const reward = await client.query(`

SELECT reward_bank_id,
total_collected,
remaining_balance

FROM reward_bank

WHERE tournament_id=$1

`, [tournament_id]);

            if (reward.rows.length === 0) {

                await client.query('ROLLBACK');

                return res.status(404).json({
                    message: "Reward bank not found"
                });

            }

            const rewardBankId = reward.rows[0].reward_bank_id;
            const totalAmount = reward.rows[0].remaining_balance;

            /* GET TOURNAMENT TYPE */

            const tournament = await client.query(`

SELECT tournament_type

FROM ce_tournaments

WHERE tournament_id=$1

`, [tournament_id]);

            const tournamentType = tournament.rows[0].tournament_type;

            /* GET RULE */

            const rule = await client.query(`

SELECT winner_percentage,
runner_percentage

FROM fund_rules

WHERE tournament_type=$1

`, [tournamentType]);

            const winnerPercent = rule.rows[0].winner_percentage;
            const runnerPercent = rule.rows[0].runner_percentage;

            /* CALCULATE REWARD */

            const winnerReward = Math.floor(totalAmount * winnerPercent / 100);

            const runnerReward = Math.floor(totalAmount * runnerPercent / 100);

            /* FIND WINNER BOARD */

            const winnerBoard = await client.query(`

SELECT board_id

FROM board_teams

WHERE team_name=$1

`, [winner_team]);

            const runnerBoard = await client.query(`

SELECT board_id

FROM board_teams

WHERE team_name=$1

`, [runner_team]);

            if (winnerBoard.rows.length === 0 || runnerBoard.rows.length === 0) {

                await client.query('ROLLBACK');

                return res.status(404).json({
                    message: "Board not found"
                });

            }

            const winnerBoardId = winnerBoard.rows[0].board_id;

            const runnerBoardId = runnerBoard.rows[0].board_id;

            /* CREDIT WINNER */

            await client.query(`

UPDATE board_wallet

SET balance = balance + $1,
total_earned = total_earned + $1

WHERE board_id=$2

`, [winnerReward, winnerBoardId]);

            /* CREDIT RUNNER */

            await client.query(`

UPDATE board_wallet

SET balance = balance + $1,
total_earned = total_earned + $1

WHERE board_id=$2

`, [runnerReward, runnerBoardId]);

            /* GET WALLET IDS */

            const winnerWallet = await client.query(`

SELECT wallet_id,balance

FROM board_wallet

WHERE board_id=$1

`, [winnerBoardId]);

            const runnerWallet = await client.query(`

SELECT wallet_id,balance

FROM board_wallet

WHERE board_id=$1

`, [runnerBoardId]);

            /* TRANSACTION WINNER */

            await client.query(`

INSERT INTO coin_transactions(

board_id,
wallet_id,
transaction_type,
amount,
balance_before,
balance_after,
reference_id,
reference_type,
remarks

)

VALUES(

$1,$2,
'TOURNAMENT_WINNER',
$3,
$4-$3,
$4,
$5,
'TOURNAMENT',
'Tournament winner reward'

)

`, [
                winnerBoardId,
                winnerWallet.rows[0].wallet_id,
                winnerReward,
                winnerWallet.rows[0].balance,
                tournament_id
            ]);

            /* TRANSACTION RUNNER */

            await client.query(`

INSERT INTO coin_transactions(

board_id,
wallet_id,
transaction_type,
amount,
balance_before,
balance_after,
reference_id,
reference_type,
remarks

)

VALUES(

$1,$2,
'TOURNAMENT_RUNNER',
$3,
$4-$3,
$4,
$5,
'TOURNAMENT',
'Tournament runner reward'

)

`, [
                runnerBoardId,
                runnerWallet.rows[0].wallet_id,
                runnerReward,
                runnerWallet.rows[0].balance,
                tournament_id
            ]);

            /* SAVE RESULT */

            await client.query(`

INSERT INTO tournament_results(

tournament_id,
winner_team,
runner_team,
winner_board_id,
runner_board_id,
winner_reward,
runner_reward,
reward_bank_id,
distributed,
distributed_at

)

VALUES(

$1,$2,$3,$4,$5,$6,$7,$8,true,NOW()

)

`, [
                tournament_id,
                winner_team,
                runner_team,
                winnerBoardId,
                runnerBoardId,
                winnerReward,
                runnerReward,
                rewardBankId
            ]);

            /* UPDATE BANK */

            await client.query(`

UPDATE reward_bank

SET total_distributed = total_distributed + $1,
remaining_balance = remaining_balance - $1

WHERE tournament_id=$2

`, [
                winnerReward + runnerReward,
                tournament_id
            ]);

            /* CLOSE TOURNAMENT */

            await client.query(`

UPDATE ce_tournaments

SET tournament_status='COMPLETED'

WHERE tournament_id=$1

`, [tournament_id]);

            await client.query('COMMIT');

            res.json({

                message: "Rewards distributed",

                winner_reward: winnerReward,

                runner_reward: runnerReward

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

        console.error("DECLARE RESULT ERROR:", err);

        res.status(500).json({
            message: "Server error",
            error: err.message   // add this temporarily
        });

    }

});

module.exports = router;