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

SELECT wallet_id,balance,wallet_status
FROM board_wallet
WHERE board_id=$1
FOR UPDATE

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

                /* LOG FAILED FUNDING */

                await client.query(`

INSERT INTO failed_transactions(

board_id,
tournament_id,
required_amount,
available_balance,
reason

)

VALUES($1,$2,$3,$4,'INSUFFICIENT_FUNDS')

`, [

                    board_id,
                    tournament_id,
                    entryFee,
                    balance

                ]);

                /* COMMIT FAILED RECORD */

                await client.query('COMMIT');

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

/* ==========================================
DECLARE TOURNAMENT RESULT + DISTRIBUTE REWARD
PROTECTION:
1 Prevent double distribution
2 Prevent cancelled tournaments
3 Prevent open tournaments
4 Financial safety validation
========================================== */

router.post('/declare-result', async (req, res) => {

    try {

        const { tournament_id, winner_team, runner_team } = req.body;

        /* BASIC VALIDATION */

        if (!tournament_id || !winner_team || !runner_team) {

            return res.status(400).json({
                message: "Tournament, winner and runner required"
            });

        }

        /* PREVENT SAME TEAM */

        if (winner_team.toLowerCase() === runner_team.toLowerCase()) {

            return res.status(400).json({
                message: "Winner and runner cannot be same team"
            });

        }

        const client = await pool.connect();

        try {

            await client.query('BEGIN');

            /* PREVENT DOUBLE DISTRIBUTION */

            const existingResult = await client.query(`

SELECT result_id
FROM tournament_results
WHERE tournament_id=$1

`, [tournament_id]);

            if (existingResult.rows.length > 0) {

                await client.query('ROLLBACK');

                return res.status(400).json({
                    message: "Reward already distributed"
                });

            }

            /* GET TOURNAMENT */

            const tournament = await client.query(`

SELECT 
tournament_type,
tournament_status

FROM ce_tournaments

WHERE tournament_id=$1

`, [tournament_id]);

            if (tournament.rows.length === 0) {

                throw new Error("Tournament not found");

            }

            const tournamentType = tournament.rows[0].tournament_type;
            const tournamentStatus = tournament.rows[0].tournament_status;

            /* PREVENT CANCELLED */

            if (tournamentStatus === 'CANCELLED') {

                throw new Error("Cannot declare result. Tournament cancelled");

            }

            /* PREVENT OPEN */

            if (tournamentStatus === 'REGISTRATION_OPEN') {

                throw new Error("Close registration before declaring result");

            }

            /* GET REWARD BANK */

            const reward = await client.query(`

SELECT 
reward_bank_id,
remaining_balance

FROM reward_bank

WHERE tournament_id=$1

`, [tournament_id]);

            if (reward.rows.length === 0) {

                throw new Error("Reward bank missing");

            }

            const rewardBankId = reward.rows[0].reward_bank_id;
            const totalAmount = reward.rows[0].remaining_balance;

            if (totalAmount <= 0) {

                throw new Error("Reward pool empty");

            }

            /* GET FUND RULE */

            const rule = await client.query(`

SELECT 
winner_percentage,
runner_percentage

FROM fund_rules

WHERE tournament_type=$1

`, [tournamentType]);

            if (rule.rows.length === 0) {

                throw new Error("Fund rule missing");

            }

            const winnerPercent = rule.rows[0].winner_percentage;
            const runnerPercent = rule.rows[0].runner_percentage;

            /* CALCULATE REWARDS */

            const winnerReward = Math.floor(totalAmount * winnerPercent / 100);

            const runnerReward = Math.floor(totalAmount * runnerPercent / 100);

            /* FIND WINNER BOARD */

            const winnerBoard = await client.query(`

SELECT board_id
FROM board_teams
WHERE LOWER(team_name)=LOWER($1)

`, [winner_team]);

            if (winnerBoard.rows.length === 0) {

                throw new Error("Winner team board mapping missing");

            }

            /* FIND RUNNER BOARD */

            const runnerBoard = await client.query(`

SELECT board_id
FROM board_teams
WHERE LOWER(team_name)=LOWER($1)

`, [runner_team]);

            if (runnerBoard.rows.length === 0) {

                throw new Error("Runner team board mapping missing");

            }

            const winnerBoardId = winnerBoard.rows[0].board_id;
            const runnerBoardId = runnerBoard.rows[0].board_id;

            /* CREDIT WINNER */

            await client.query(`

UPDATE board_wallet

SET 
balance = balance + $1,
total_earned = total_earned + $1

WHERE board_id=$2

`, [
                winnerReward,
                winnerBoardId
            ]);

            /* CREDIT RUNNER */

            await client.query(`

UPDATE board_wallet

SET 
balance = balance + $1,
total_earned = total_earned + $1

WHERE board_id=$2

`, [
                runnerReward,
                runnerBoardId
            ]);

            /* GET UPDATED WALLET */

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

            const winnerBalanceAfter = winnerWallet.rows[0].balance;
            const winnerBalanceBefore = winnerBalanceAfter - winnerReward;

            const runnerBalanceAfter = runnerWallet.rows[0].balance;
            const runnerBalanceBefore = runnerBalanceAfter - runnerReward;

            /* WINNER TRANSACTION */

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
$4,
$5,
$6,
'TOURNAMENT',
'Tournament winner reward'

)

`, [
                winnerBoardId,
                winnerWallet.rows[0].wallet_id,
                winnerReward,
                winnerBalanceBefore,
                winnerBalanceAfter,
                tournament_id
            ]);

            /* RUNNER TRANSACTION */

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
$4,
$5,
$6,
'TOURNAMENT',
'Tournament runner reward'

)

`, [
                runnerBoardId,
                runnerWallet.rows[0].wallet_id,
                runnerReward,
                runnerBalanceBefore,
                runnerBalanceAfter,
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

SET 
total_distributed = total_distributed + $1,
remaining_balance = GREATEST(remaining_balance-$1,0)

WHERE tournament_id=$2

`, [
                winnerReward + runnerReward,
                tournament_id
            ]);

            /* COMPLETE */

            await client.query(`

UPDATE ce_tournaments

SET 
tournament_status='COMPLETED',
completed_at=NOW()

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

        console.error("DECLARE RESULT ERROR:", err.message);

        res.status(500).json({
            error: err.message
        });

    }

});

/* ==========================================
CANCEL TOURNAMENT + REFUND SYSTEM
LOGIC:

1 Prevent cancel completed
2 Refund all boards
3 Ledger entry
4 Prevent double refund
5 Mark cancelled

========================================== */

router.post('/cancel-tournament', async (req, res) => {

    try {

        const { tournament_id, reason } = req.body;

        if (!tournament_id) {

            return res.status(400).json({
                message: "Tournament id required"
            });

        }

        const client = await pool.connect();

        try {

            await client.query('BEGIN');

            /* GET TOURNAMENT */

            const tournament = await client.query(`

SELECT tournament_status

FROM ce_tournaments

WHERE tournament_id=$1

`, [tournament_id]);

            if (tournament.rows.length === 0) {

                throw new Error("Tournament not found");

            }

            if (tournament.rows[0].tournament_status === 'COMPLETED') {

                throw new Error("Completed tournament cannot cancel");

            }

            if (tournament.rows[0].tournament_status === 'CANCELLED') {

                throw new Error("Tournament already cancelled");

            }

            /* GET BOARDS */

            const boards = await client.query(`

SELECT 
board_id,
entry_fee

FROM tournament_registrations

WHERE tournament_id=$1
AND refunded=false

`, [tournament_id]);

            let totalRefund = 0;

            /* REFUND LOOP */

            for (const board of boards.rows) {

                const boardId = board.board_id;
                const entryFee = board.entry_fee;

                totalRefund += entryFee;

                /* WALLET */

                const wallet = await client.query(`

SELECT wallet_id,balance

FROM board_wallet

WHERE board_id=$1

`, [boardId]);

                const walletId = wallet.rows[0].wallet_id;

                const balanceBefore = wallet.rows[0].balance;

                const balanceAfter = balanceBefore + entryFee;

                /* REFUND */

                await client.query(`

UPDATE board_wallet

SET 
balance=balance+$1,
total_earned=total_earned+$1

WHERE board_id=$2

`, [
                    entryFee,
                    boardId
                ]);

                /* TRANSACTION */

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
'TOURNAMENT_REFUND',
$3,
$4,
$5,
$6,
'TOURNAMENT',
'Tournament cancelled refund'

)

`, [
                    boardId,
                    walletId,
                    entryFee,
                    balanceBefore,
                    balanceAfter,
                    tournament_id
                ]);

                /* MARK REFUNDED */

                await client.query(`

UPDATE tournament_registrations

SET 
refunded=true,
refunded_at=NOW()

WHERE tournament_id=$1
AND board_id=$2

`, [
                    tournament_id,
                    boardId
                ]);

            }

            /* UPDATE BANK */

            await client.query(`

UPDATE reward_bank

SET 
total_distributed=total_distributed+$1,
remaining_balance=GREATEST(remaining_balance-$1,0)

WHERE tournament_id=$2

`, [
                totalRefund,
                tournament_id
            ]);

            /* CANCEL */

            await client.query(`

UPDATE ce_tournaments

SET 
tournament_status='CANCELLED',
cancel_reason=$2,
cancelled_at=NOW()

WHERE tournament_id=$1

`, [
                tournament_id,
                reason || 'Admin cancelled'
            ]);

            await client.query('COMMIT');

            res.json({

                message: "Tournament cancelled",

                boards_refunded: boards.rows.length,

                total_refunded: totalRefund

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

        console.error("CANCEL ERROR:", err.message);

        res.status(500).json({
            error: err.message
        });

    }

});
/* ==========================================
FUNDS LEADERBOARD
========================================== */

router.get('/leaderboard', async (req, res) => {

    try {

        const data = await pool.query(`

SELECT
br.board_name,
bw.balance,
bw.total_earned,
bw.total_spent,
bw.wallet_status
FROM board_wallet bw
JOIN board_registration br
ON bw.board_id = br.id
ORDER BY bw.balance DESC

`);

        res.json(data.rows || []);

    }
    catch (err) {

        console.error("Leaderboard error:", err);

        res.status(500).json({

            message: "Server error"

        });

    }

});
/* ==========================================
REWARD BANK DASHBOARD
Financial pool overview
========================================== */

router.get('/reward-banks', async (req, res) => {

    try {

        const data = await pool.query(`

SELECT

rb.reward_bank_id,

ct.tournament_id,
ct.tournament_name,
ct.tournament_type,
ct.entry_fee,

rb.total_collected,
rb.total_distributed,
rb.remaining_balance,

ct.tournament_status,

rb.created_at,

CASE

WHEN rb.total_collected = 0
THEN 0

ELSE ROUND(
(rb.total_distributed::numeric /
rb.total_collected::numeric)*100
)

END as distribution_percent,

CASE

WHEN rb.remaining_balance = 0
THEN 'EMPTY'

WHEN rb.remaining_balance <
(rb.total_collected * 0.20)
THEN 'LOW'

WHEN rb.remaining_balance <
(rb.total_collected * 0.50)
THEN 'MODERATE'

ELSE 'HEALTHY'

END as pool_health

FROM reward_bank rb

JOIN ce_tournaments ct
ON rb.tournament_id = ct.tournament_id

ORDER BY rb.created_at DESC

`);

        res.json(data.rows || []);

    }
    catch (err) {

        console.error("Reward bank error:", err);

        res.status(500).json({

            message: "Server error"

        });

    }

});

/* ==========================================
FUNDS ANALYTICS
========================================== */

router.get('/analytics', async (req, res) => {

    try {

        const summary = await pool.query(`

SELECT

SUM(balance) as current_total_funds,

SUM(total_earned) as lifetime_funds_added,

SUM(total_spent) as total_entry_fees

FROM board_wallet

`);

        const rewards = await pool.query(`

SELECT COALESCE(SUM(amount),0) as total_rewards_distributed

FROM coin_transactions

WHERE transaction_type IN (

'TOURNAMENT_WINNER',
'TOURNAMENT_RUNNER',
'MATCH_WIN'

)

`);

        const topBoards = await pool.query(`

SELECT

br.board_name,
bw.total_earned

FROM board_wallet bw

JOIN board_registration br
ON bw.board_id = br.id

ORDER BY bw.total_earned DESC

LIMIT 5

`);

        const tournaments = await pool.query(`

SELECT

ct.tournament_name,
rb.total_collected

FROM reward_bank rb

JOIN ce_tournaments ct
ON rb.tournament_id=ct.tournament_id

ORDER BY rb.total_collected DESC

LIMIT 5

`);

        res.json({

            summary: {
                current_total_funds: summary.rows[0].current_total_funds,
                lifetime_funds_added: summary.rows[0].lifetime_funds_added,
                total_entry_fees: summary.rows[0].total_entry_fees,
                total_rewards_distributed: rewards.rows[0].total_rewards_distributed
            },

            topBoards: topBoards.rows,

            tournaments: tournaments.rows

        });

    }
    catch (err) {

        res.status(500).json({ message: "Server error" });

    }

});
router.get('/failed-transactions', async (req, res) => {

    try {

        const data = await pool.query(`

SELECT
f.failed_id,
f.required_amount,
f.available_balance,
f.created_at,
COALESCE(br.board_name,'Unknown') as board_name,
COALESCE(ct.tournament_name,'Unknown') as tournament_name
FROM failed_transactions f
LEFT JOIN board_registration br
ON br.id = f.board_id
LEFT JOIN ce_tournaments ct
ON ct.tournament_id = f.tournament_id
ORDER BY f.created_at DESC
`);

        res.json(data.rows);

    }
    catch (err) {

        console.error("FAILED TX ERROR:", err);

        res.status(500).json({
            message: err.message
        });

    }

});

/* ==========================================
REQUEST LOAN
Board requests loan after insufficient funds
========================================== */

router.post('/request-loan', async (req, res) => {

    try {

        const { board_id, tournament_id } = req.body;

        if (!board_id || !tournament_id) {

            return res.status(400).json({

                message: "Board and tournament required"

            });

        }


        /* CHECK FAILED TRANSACTION */

        const failed = await pool.query(`

SELECT required_amount,available_balance

FROM failed_transactions

WHERE board_id=$1
AND tournament_id=$2

ORDER BY created_at DESC

LIMIT 1

`, [board_id, tournament_id]);


        if (failed.rows.length === 0) {

            return res.status(400).json({

                message: "No failed funding record found"

            });

        }


        const loanAmount =
            failed.rows[0].required_amount;


        /* PREVENT DUPLICATE LOAN */

        const existingLoan =
            await pool.query(`

SELECT loan_id

FROM board_loans

WHERE board_id=$1
AND tournament_id=$2
AND loan_status
IN ('PENDING','ACTIVE')

`, [board_id, tournament_id]);


        if (existingLoan.rows.length > 0) {

            return res.status(400).json({

                message: "Loan already requested"

            });

        }


        /* CALCULATE INTEREST */

        const interestRate = 12;
        const penaltyRate = 3;

        const interestAmount =
            Math.floor(
                loanAmount * interestRate / 100
            );

        const totalPayable =
            loanAmount + interestAmount;


        /* CREATE LOAN */
        await pool.query(`

INSERT INTO board_loans(

board_id,
tournament_id,
loan_amount,
interest_rate,
penalty_rate,
interest_amount,
penalty_amount,
total_payable,
remaining_amount,
loan_status,
remarks

)

VALUES(

$1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',
'Loan requested for tournament entry'

)

`, [

            board_id,
            tournament_id,
            loanAmount,
            interestRate,
            3,                // penalty rate
            interestAmount,
            0,                // penalty amount initially 0
            totalPayable,
            totalPayable

        ]);

        res.json({

            message: "Loan request submitted",

            loan_amount: loanAmount,

            interest: interestAmount,

            total_payable: totalPayable,

            status: "PENDING_APPROVAL"

        });

    }
    catch (err) {

        console.error("LOAN REQUEST ERROR:", err);

        res.status(500).json({

            message: "Loan request failed"

        });

    }

});

/* ==========================================
TOURNAMENT INTEREST LOG VIEW
(Admin view)
========================================== */

router.get('/tournament-interest', async (req, res) => {

    try {

        const data = await pool.query(`

SELECT

til.interest_id,

br.board_name,

ct.tournament_name,

til.interest_status,

til.created_at

FROM tournament_interest_log til

JOIN board_registration br
ON br.id = til.board_id

JOIN ce_tournaments ct
ON ct.tournament_id = til.tournament_id

ORDER BY til.created_at DESC

`);

        res.json(data.rows || []);

    }
    catch (err) {

        console.error("INTEREST FETCH ERROR:", err);

        res.status(500).json({

            message: "Server error"

        });

    }

});

router.post('/tournament-interest', async (req, res) => {

    try {

        const {
            board_id,
            tournament_id,
            interest_status
        } = req.body;

        if (!board_id || !tournament_id) {
            return res.status(400).json({
                message: "Board and tournament required"
            });
        }

        await pool.query(`

INSERT INTO tournament_interest_log(

board_id,
tournament_id,
interest_status

)

VALUES($1,$2,$3)

ON CONFLICT (board_id,tournament_id)

DO UPDATE SET
interest_status = EXCLUDED.interest_status,
created_at = NOW()

`, [

            parseInt(board_id),
            tournament_id,
            interest_status || 'NOT_INTERESTED'

        ]);

        res.json({
            message: "Interest saved"
        });

    }
    catch (err) {

        console.error("INTEREST ERROR:", err);

        res.status(500).json({
            message: err.message
        });

    }

});

/* ==========================================
MATCH REWARD AUDIT
========================================== */

router.get('/transactions/all-match-rewards', async (req, res) => {

    try {

        const data = await pool.query(`

SELECT
br.board_name,
ct.reference_id as match_ref,
ct.amount,
ct.balance_before,
ct.balance_after,
ct.created_at,
ct.transaction_type,
ct.reference_type
FROM coin_transactions ct
JOIN board_registration br
ON br.id = ct.board_id
WHERE ct.reference_type='MATCH'
OR ct.transaction_type LIKE 'TOUR%'
ORDER BY ct.created_at DESC
`);

        res.json(data.rows);
    }
    catch (err) {
        console.error("MATCH AUDIT ERROR:", err);
        res.status(500).json({
            error: err.message
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

/* GET BOARD BY OWNER EMAIL */

router.get('/by-owner/:email', async (req, res) => {

    try {

        const { email } = req.params;

        const board = await pool.query(`

SELECT 
id as board_id,
board_name,
owner_email
FROM board_registration
WHERE owner_email=$1

`, [email]);

        if (board.rows.length === 0) {

            return res.status(404).json({
                message: "Board not found"
            });

        }

        res.json(board.rows[0]);

    }
    catch (err) {

        res.status(500).json({
            message: "Server error"
        });

    }

});

/* ==========================================
CENTRAL BANK SUMMARY
System Treasury Overview
========================================== */

router.get('/central-bank-summary', async (req, res) => {

    try {

        /* TOTAL BOARDS */

        const boards = await pool.query(`

SELECT COUNT(*) FROM board_wallet

`);

        const totalBoards =
            parseInt(boards.rows[0].count);


        /* INITIAL GRANT */

        const initialGrant = 200000;

        const totalSystemFunds =
            totalBoards * initialGrant;


        /* TOURNAMENT CONTRIBUTION (10%) */

        const contribution =
            await pool.query(`

SELECT
COALESCE(SUM(total_collected * 0.10),0)
AS total

FROM reward_bank

`);

        const tournamentContribution =
            parseInt(contribution.rows[0].total);


        /* LOAN OUTSTANDING */

        const loans =
            await pool.query(`

SELECT
COALESCE(SUM(remaining_amount),0)
AS outstanding

FROM board_loans

WHERE loan_status='ACTIVE'

`);

        const loanOutstanding =
            parseInt(loans.rows[0].outstanding);


        /* INTEREST EARNED */

        const interest =
            await pool.query(`

SELECT
COALESCE(SUM(interest_amount),0)
AS interest

FROM board_loans

WHERE loan_status
IN ('ACTIVE','CLOSED')

`);

        const interestEarned =
            parseInt(interest.rows[0].interest);


        /* RECOVERED */

        const recovered =
            await pool.query(`

SELECT
COALESCE(SUM(amount),0)
AS recovered

FROM loan_transactions

WHERE txn_type='RECOVERY_PAYMENT'

`);

        const recoveredAmount =
            parseInt(recovered.rows[0].recovered);


        /* AVAILABLE LIQUIDITY */

        const availableLiquidity =

            tournamentContribution
            + recoveredAmount
            + interestEarned
            - loanOutstanding;


        /* UPDATE CENTRAL BANK */

        await pool.query(`

UPDATE central_bank_wallet

SET

total_system_funds=$1,
tournament_contributions=$2,
loan_outstanding=$3,
interest_earned=$4,
recovered_amount=$5,
available_liquidity=$6,
last_updated=NOW()

`, [

            totalSystemFunds,
            tournamentContribution,
            loanOutstanding,
            interestEarned,
            recoveredAmount,
            availableLiquidity

        ]);


        /* RESPONSE */

        res.json({

            totalBoards,
            totalSystemFunds,
            tournamentContribution,
            loanOutstanding,
            interestEarned,
            recoveredAmount,
            availableLiquidity

        });

    }
    catch (err) {

        console.error("CENTRAL BANK ERROR:", err);

        res.status(500).json({

            message: "Central bank summary failed"

        });

    }

});

module.exports = router;