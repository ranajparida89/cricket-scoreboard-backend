// routes/simpleAuctionRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// Helper to safely convert numbers
const toNum = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);

/* ---------------------------------------------------------------------
   CREATE AUCTION
------------------------------------------------------------------------*/
router.post("/sessions", async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      name,
      maxSquadSize = 13,
      initialWalletAmount = 120,
      bidTimerSeconds = 30,
      minBidIncrement = 0.5,
    } = req.body || {};

    if (!name) return res.status(400).json({ error: "name required" });

    const q = `
      INSERT INTO auctions 
      (name, max_squad_size, initial_wallet_amount, bid_timer_seconds, min_bid_increment, status, created_at) 
      VALUES ($1,$2,$3,$4,$5,'NOT_STARTED',NOW())
      RETURNING *;
    `;

    const r = await client.query(q, [
      name,
      maxSquadSize,
      initialWalletAmount,
      bidTimerSeconds,
      minBidIncrement,
    ]);

    return res.status(201).json({ auction: r.rows[0] });
  } catch (err) {
    console.error("Create auction error", err);
    return res.status(500).json({ error: "failed" });
  } finally {
    client.release();
  }
});

/* ---------------------------------------------------------------------
   IMPORT PLAYER POOL
------------------------------------------------------------------------*/
router.post("/player-pool/import", async (req, res) => {
  const client = await pool.connect();
  try {
    const { players } = req.body || {};
    if (!Array.isArray(players) || !players.length)
      return res.status(400).json({ error: "players required" });

    await client.query("BEGIN");

    for (const p of players) {
      await client.query(
        `
        INSERT INTO player_pool 
        (external_player_code, player_name, country, skill_type, category, base_bid_amount, is_active, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,TRUE,NOW())
      `,
        [
          p.playerCode || null,
          p.playerName,
          p.country,
          p.skillType,
          p.category,
          toNum(p.bidAmount, 0),
        ]
      );
    }

    await client.query("COMMIT");
    return res.json({ message: "imported", count: players.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Import error", err);
    return res.status(500).json({ error: "failed" });
  } finally {
    client.release();
  }
});

/* ---------------------------------------------------------------------
   ATTACH PLAYERS TO AUCTION
------------------------------------------------------------------------*/
router.post("/sessions/:auctionId/attach-players", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;

    await client.query("BEGIN");

    const r = await client.query(
      `
      INSERT INTO session_players (auction_id, pool_player_id, status, created_at)
      SELECT $1, pool_player_id, 'PENDING', NOW()
      FROM player_pool WHERE is_active = TRUE
      RETURNING session_player_id;
    `,
      [auctionId]
    );

    await client.query("COMMIT");
    return res.json({ attached: r.rowCount });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("attach error", err);
    return res.status(500).json({ error: "failed" });
  } finally {
    client.release();
  }
});

/* ---------------------------------------------------------------------
   START AUCTION
------------------------------------------------------------------------*/
router.post("/sessions/:auctionId/start", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;

    await client.query("BEGIN");

    const a = await client.query(
      "SELECT * FROM auctions WHERE auction_id=$1 FOR UPDATE",
      [auctionId]
    );
    if (a.rowCount === 0)
      return res.status(404).json({ error: "auction not found" });

    const auction = a.rows[0];

    const next = await client.query(
      `
      SELECT session_player_id 
      FROM session_players 
      WHERE auction_id=$1 AND status='PENDING'
      ORDER BY created_at ASC LIMIT 1
    `,
      [auctionId]
    );

    if (next.rowCount === 0)
      return res.status(400).json({ error: "no players to start" });

    const sessionPlayerId = next.rows[0].session_player_id;

    const now = new Date();
    const ends = new Date(
      now.getTime() + (auction.bid_timer_seconds || 30) * 1000
    );

    await client.query(
      `
      UPDATE auctions
      SET status='RUNNING',
          current_live_session_player_id=$2,
          current_round_started_at=$3,
          current_round_ends_at=$4
      WHERE auction_id=$1
    `,
      [auctionId, sessionPlayerId, now, ends]
    );

    await client.query(
      `
      UPDATE session_players 
      SET status='LIVE', live_started_at=$2, live_ends_at=$3
      WHERE session_player_id=$1
    `,
      [sessionPlayerId, now, ends]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Auction started",
      sessionPlayerId,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Start error", err);
    return res.status(500).json({ error: "failed" });
  } finally {
    client.release();
  }
});

/* ---------------------------------------------------------------------
   GET LIVE STATE  (UI EXPECTED FORMAT)
------------------------------------------------------------------------*/
router.get("/sessions/:auctionId/live", async (req, res) => {
  try {
    const { auctionId } = req.params;

    const a = await pool.query(
      "SELECT * FROM auctions WHERE auction_id=$1",
      [auctionId]
    );
    if (a.rowCount === 0)
      return res.status(404).json({ error: "not found" });

    const auction = a.rows[0];

    // NO live player
    if (!auction.current_live_session_player_id) {
      return res.json({
        auction,
        livePlayer: null,
        highestBid: null,
        timeLeft: null,
      });
    }

    // FETCH LIVE PLAYER
    const p = await pool.query(
      `
      SELECT sp.*, 
             pp.player_name,
             pp.country,
             pp.skill_type,
             pp.category,
             pp.base_bid_amount
      FROM session_players sp
      JOIN player_pool pp ON pp.pool_player_id = sp.pool_player_id
      WHERE sp.session_player_id=$1
    `,
      [auction.current_live_session_player_id]
    );

    const row = p.rows[0];

    const highestBid =
      row.last_highest_bid_amount != null
        ? Number(row.last_highest_bid_amount)
        : null;

    const timeLeft = auction.current_round_ends_at
      ? Math.max(
          0,
          Math.floor(
            (new Date(auction.current_round_ends_at) - Date.now()) / 1000
          )
        )
      : null;

    // MAP INTO UI FORMAT
    const livePlayer = {
      sessionPlayerId: row.session_player_id,
      playerName: row.player_name,
      country: row.country,
      skillType: row.skill_type,
      category: row.category,
      basePrice: Number(row.base_bid_amount || 0),
      bidIncrement: Number(auction.min_bid_increment || 0.5),
      lastHighestBidAmount: highestBid,
    };

    return res.json({
      auction,
      livePlayer,
      highestBid,
      timeLeft,
    });
  } catch (err) {
    console.error("LIVE error", err);
    return res.status(500).json({ error: "failed" });
  }
});

/* ---------------------------------------------------------------------
   PLACE BID  (UI expects /bid not /bids)
------------------------------------------------------------------------*/
router.post("/sessions/:auctionId/bid", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    const { userId, amount } = req.body;

    if (!userId || !amount)
      return res.status(400).json({ error: "missing fields" });

    await client.query("BEGIN");

    const a = await client.query(
      "SELECT * FROM auctions WHERE auction_id=$1 FOR UPDATE",
      [auctionId]
    );
    if (a.rowCount === 0)
      return res.status(404).json({ error: "auction not found" });

    const auction = a.rows[0];

    if (auction.status !== "RUNNING")
      return res.status(400).json({ error: "auction not running" });

    const liveId = auction.current_live_session_player_id;

    const sp = await client.query(
      `
      SELECT sp.*, pp.base_bid_amount
      FROM session_players sp
      JOIN player_pool pp ON pp.pool_player_id = sp.pool_player_id
      WHERE session_player_id=$1
    `,
      [liveId]
    );

    const row = sp.rows[0];

    const base = Number(row.base_bid_amount);
    const last =
      row.last_highest_bid_amount != null
        ? Number(row.last_highest_bid_amount)
        : base;

    const minReq = last + Number(auction.min_bid_increment);

    if (Number(amount) < minReq)
      return res.status(400).json({ error: "bid too low", minReq });

    await client.query(
      `
      INSERT INTO bids (auction_id, session_player_id, user_id, bid_amount)
      VALUES ($1,$2,$3,$4)
    `,
      [auctionId, liveId, userId, amount]
    );

    await client.query(
      `
      UPDATE session_players 
      SET last_highest_bid_amount=$2, last_highest_bid_user_id=$3
      WHERE session_player_id=$1
    `,
      [liveId, amount, userId]
    );

    await client.query("COMMIT");
    return res.json({ message: "bid accepted", highestBid: amount });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("bid error", err);
    return res.status(500).json({ error: "failed" });
  } finally {
    client.release();
  }
});

/* ---------------------------------------------------------------------
   CLOSE ROUND  (UI expects /close)
------------------------------------------------------------------------*/
router.post("/sessions/:auctionId/close", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;

    await client.query("BEGIN");

    const a = await client.query(
      "SELECT * FROM auctions WHERE auction_id=$1 FOR UPDATE",
      [auctionId]
    );
    if (a.rowCount === 0)
      return res.status(404).json({ error: "auction not found" });

    const auction = a.rows[0];
    const liveId = auction.current_live_session_player_id;

    if (!liveId)
      return res.status(400).json({ error: "no live player" });

    const sp = await client.query(
      `
      SELECT * FROM session_players WHERE session_player_id=$1 FOR UPDATE
    `,
      [liveId]
    );

    const row = sp.rows[0];

    // SOLD
    if (row.last_highest_bid_amount && row.last_highest_bid_user_id) {
      const winner = row.last_highest_bid_user_id;
      const bid = Number(row.last_highest_bid_amount);

      // Deduct wallet
      const w = await client.query(
        `
        SELECT * FROM wallets WHERE auction_id=$1 AND user_id=$2 FOR UPDATE
      `,
        [auctionId, winner]
      );

      const wallet = w.rows[0];
      const newBal = Number(wallet.current_balance) - bid;

      if (newBal < 0)
        return res.status(400).json({ error: "insufficient wallet" });

      await client.query(
        `UPDATE wallets SET current_balance=$2 WHERE wallet_id=$1`,
        [wallet.wallet_id, newBal]
      );

      await client.query(
        `
        INSERT INTO squad_players (auction_id,user_id,session_player_id,purchase_price)
        VALUES ($1,$2,$3,$4)
      `,
        [auctionId, winner, liveId, bid]
      );

      await client.query(
        `
        UPDATE session_players SET status='SOLD' WHERE session_player_id=$1
      `,
        [liveId]
      );
    } else {
      // UNSOLD
      await client.query(
        `UPDATE session_players SET status='UNSOLD' WHERE session_player_id=$1`,
        [liveId]
      );
    }

    // CLEAR LIVE POINTER
    await client.query(
      `
      UPDATE auctions 
      SET current_live_session_player_id=null,
          current_round_started_at=null,
          current_round_ends_at=null
      WHERE auction_id=$1
    `,
      [auctionId]
    );

    await client.query("COMMIT");
    return res.json({ message: "round closed" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("close error", err);
    return res.status(500).json({ error: "failed" });
  } finally {
    client.release();
  }
});

/* ---------------------------------------------------------------------
   NEXT PLAYER  (UI expects /next)
------------------------------------------------------------------------*/
router.post("/sessions/:auctionId/next", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;

    await client.query("BEGIN");

    const pending = await client.query(
      `
      SELECT session_player_id 
      FROM session_players 
      WHERE auction_id=$1 AND status='PENDING'
      ORDER BY created_at ASC LIMIT 1
    `,
      [auctionId]
    );

    if (pending.rowCount === 0)
      return res.json({ message: "No more players" });

    const sessionPlayerId = pending.rows[0].session_player_id;

    const now = new Date();
    const a = await client.query(
      "SELECT * FROM auctions WHERE auction_id=$1 FOR UPDATE",
      [auctionId]
    );
    const auction = a.rows[0];

    const ends = new Date(
      now.getTime() + auction.bid_timer_seconds * 1000
    );

    await client.query(
      `
      UPDATE auctions 
      SET current_live_session_player_id=$2,
          current_round_started_at=$3,
          current_round_ends_at=$4,
          status='RUNNING'
      WHERE auction_id=$1
    `,
      [auctionId, sessionPlayerId, now, ends]
    );

    await client.query(
      `
      UPDATE session_players 
      SET status='LIVE', live_started_at=$2, live_ends_at=$3
      WHERE session_player_id=$1
    `,
      [sessionPlayerId, now, ends]
    );

    await client.query("COMMIT");
    return res.json({ message: "Next player loaded", sessionPlayerId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("next error", err);
    return res.status(500).json({ error: "failed" });
  } finally {
    client.release();
  }
});

/* ---------------------------------------------------------------------
   END AUCTION
------------------------------------------------------------------------*/
router.post("/sessions/:auctionId/end", async (req, res) => {
  try {
    await pool.query(
      `UPDATE auctions SET status='ENDED' WHERE auction_id=$1`,
      [req.params.auctionId]
    );
    return res.json({ message: "Auction ended" });
  } catch (err) {
    console.error("end error", err);
    return res.status(500).json({ error: "failed" });
  }
});

/* ---------------------------------------------------------------------
   PARTICIPANTS LIST  (UI uses this)
------------------------------------------------------------------------*/
router.get("/sessions/:auctionId/participants", async (req, res) => {
  try {
    const { auctionId } = req.params;

    const r = await pool.query(
      `SELECT user_id FROM auction_participants WHERE auction_id=$1`,
      [auctionId]
    );

    return res.json({ participants: r.rows });
  } catch (err) {
    console.error("participants error", err);
    return res.status(500).json({ error: "failed" });
  }
});

module.exports = router;
