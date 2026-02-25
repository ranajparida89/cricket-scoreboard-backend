const pool = require("../db");
async function startAuctionTimer() {
    setInterval(async () => {
        try {
            /*
            Find expired auctions
            */
            const expiredAuctions = await pool.query(`
SELECT *
FROM auction_live_state
WHERE timer_end_time <= NOW()
`);
            for (const state of expiredAuctions.rows) {
                const client = await pool.connect();
                try {
                    await client.query("BEGIN");
                    /*
                    Get Player
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
                    If no bids → UNSOLD
                    */
                    if (!state.highest_bidder_board_id) {
                        await client.query(`
UPDATE auction_players_live
SET status='UNSOLD'
WHERE id=$1
`, [player.id]);
                    }
                    else {
                        /*
                        Get Board
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
                        Mark SOLD
                        */
                        await client.query(`
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
                            ]);

                        /*
                        Deduct Purse
                        */
                        const newPurse =
                            Number(board.purse_remaining)
                            -
                            Number(state.current_highest_bid);
                        await client.query(`
UPDATE auction_boards_live
SET
purse_remaining=$1,
players_bought=players_bought+1
WHERE id=$2
`,
                            [
                                newPurse,
                                board.id
                            ]);
                    }

                    /*
                    Next Player
                    */
                    const nextPlayer = await client.query(
                        `SELECT *
FROM auction_players_live
WHERE auction_id=$1
AND status='PENDING'
LIMIT 1`,
                        [state.auction_id]
                    );
                    if (nextPlayer.rows.length > 0) {
                        const np = nextPlayer.rows[0];
                        await client.query(`
UPDATE auction_players_live
SET status='LIVE'
WHERE id=$1
`, [np.id]);

                        await client.query(`
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
                                state.auction_id
                            ]);
                    }
                    else {
                        /*
                        Auction Complete
                        */
                        await client.query(`
UPDATE auction_master_live
SET status='COMPLETED'
WHERE id=$1
`, [state.auction_id]);
                    }
                    /*
                    Commit
                    */
                    await client.query("COMMIT");
                    console.log("Player Auto Closed");
                }
                catch (err) {
                    await client.query("ROLLBACK");
                    console.log("Timer Transaction Error", err);
                }
                finally {
                    client.release();
                }
            }
        }
        catch (err) {
            console.log("Timer Engine Error", err);
        }
    }, 1000);
}
module.exports = startAuctionTimer;