const cron = require("node-cron");
const pool = require("../db");

function startLoanScheduler() {

    console.log("Loan Scheduler Started");

    cron.schedule("0 2 * * *", async () => {

        console.log("Running Loan Automation Job");

        const client = await pool.connect();

        try {

            await client.query("BEGIN");

            /* STEP 1 — MARK OVERDUE */

            await client.query(`

UPDATE board_loans
SET loan_status='OVERDUE'

WHERE loan_status='ACTIVE'
AND due_date < NOW()

`);


            /* STEP 2 — APPLY PENALTY */

            const overdueLoans = await client.query(`

SELECT *
FROM board_loans

WHERE loan_status='OVERDUE'
AND remaining_amount > 0
AND penalty_amount = 0

FOR UPDATE

`);

            for (const loan of overdueLoans.rows) {

                const penalty = Math.floor(
                    loan.remaining_amount * loan.penalty_rate / 100
                );

                const newRemaining =
                    loan.remaining_amount + penalty;

                await client.query(`

UPDATE board_loans
SET penalty_amount=$1,
remaining_amount=$2,
total_payable=total_payable+$1

WHERE loan_id=$3

`, [
                    penalty,
                    newRemaining,
                    loan.loan_id
                ]);

                await client.query(`

INSERT INTO loan_transactions(

loan_id,
board_id,
amount,
balance_after,
transaction_type,
remarks,
balance_before

)

VALUES($1,$2,$3,$4,$5,$6,$7)

`, [
                    loan.loan_id,
                    loan.board_id,
                    penalty,
                    newRemaining,
                    "PENALTY",
                    "Auto penalty cron",
                    loan.remaining_amount
                ]);

            }


            /* STEP 3 — MARK DEFAULT */

            const defaultLoans = await client.query(`

SELECT *
FROM board_loans

WHERE loan_status='OVERDUE'
AND remaining_amount > 0
AND due_date < NOW() - INTERVAL '30 days'

FOR UPDATE

`);

            for (const loan of defaultLoans.rows) {

                await client.query(`

UPDATE board_loans

SET loan_status='DEFAULTED',
is_defaulted=true

WHERE loan_id=$1

`, [loan.loan_id]);

                await client.query(`

INSERT INTO loan_transactions(

loan_id,
board_id,
amount,
balance_after,
transaction_type,
remarks,
balance_before

)

VALUES($1,$2,$3,$4,$5,$6,$7)

`, [
                    loan.loan_id,
                    loan.board_id,
                    0,
                    loan.remaining_amount,
                    "DEFAULT",
                    "Auto default cron",
                    loan.remaining_amount
                ]);

                await client.query(`

UPDATE central_bank_wallet

SET total_defaults = total_defaults +1,
loan_outstanding = loan_outstanding - $1,
last_updated = NOW()

`, [
                    loan.remaining_amount
                ]);

            }

            await client.query("COMMIT");

            console.log("Loan Automation Completed");

        }
        catch (err) {

            await client.query("ROLLBACK");

            console.log("Loan Cron Error:", err);

        }
        finally {

            client.release();

        }

    }, {
        timezone: "Asia/Kolkata"
    });

}

module.exports = { startLoanScheduler };