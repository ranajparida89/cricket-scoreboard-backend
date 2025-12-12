// routes/simpleAuctionRoutes.js
const express = require('express');
const router = express.Router();
const pool = require('../db'); // ensure your db module returns pg Pool

const toNumber = (v, f = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
};

// POST /api/auction/sessions   -> create auction
router.post('/sessions', async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, maxSquadSize = 13, initialWalletAmount = 120, bidTimerSeconds = 30, minBidIncrement = 0.5 } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });

    const q = `
      INSERT INTO auctions (name, max_squad_size, initial_wallet_amount, bid_timer_seconds, min_bid_increment, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,'NOT_STARTED', now(), now())
      RETURNING auction_id, name, status, max_squad_size, initial_wallet_amount, bid_timer_seconds, min_bid_increment;
    `;
    const r = await client.query(q, [name, maxSquadSize, initialWalletAmount, bidTimerSeconds, minBidIncrement]);
    return res.status(201).json({ session: r.rows[0] });
  } catch (err) {
    console.error('create session error', err.stack || err);
    return res.status(500).json({ error: 'failed' });
  } finally { client.release(); }
});

// POST /api/auction/player-pool/import  -> import players (simple)
router.post('/player-pool/import', async (req, res) => {
  const client = await pool.connect();
  try {
    const { players } = req.body || {};
    if (!Array.isArray(players) || players.length === 0) return res.status(400).json({ error:'players array required' });

    await client.query('BEGIN');
    for (const p of players) {
      await client.query(`
        INSERT INTO player_pool (external_player_code, player_name, country, skill_type, category, base_bid_amount, is_active, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,TRUE,now())
      `, [p.playerCode || null, p.playerName, p.country || null, p.skillType || null, p.category || null, toNumber(p.bidAmount,0)]);
    }
    await client.query('COMMIT');
    return res.json({ message: 'imported', count: players.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('player import', err.stack || err);
    return res.status(500).json({ error:'failed' });
  } finally { client.release(); }
});

// POST /api/auction/sessions/:auctionId/attach-players  -> attach all active players (simple)
router.post('/sessions/:auctionId/attach-players', async (req, res) => {
  const { auctionId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(`
      INSERT INTO session_players (auction_id, pool_player_id, status, created_at)
      SELECT $1, pool_player_id, 'PENDING', now() FROM player_pool WHERE is_active = TRUE
      RETURNING session_player_id
    `,[auctionId]);
    await client.query('COMMIT');
    return res.json({ attached: ins.rowCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('attach players', err.stack || err);
    return res.status(500).json({ error:'failed' });
  } finally { client.release(); }
});

// POST /api/auction/sessions/:auctionId/start  -> simple start, set first pending to LIVE
router.post('/sessions/:auctionId/start', async (req, res) => {
  const { auctionId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const aRes = await client.query('SELECT * FROM auctions WHERE auction_id = $1 FOR UPDATE', [auctionId]);
    if (aRes.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error:'not found' }); }
    const auction = aRes.rows[0];
    if (auction.status === 'RUNNING') { await client.query('ROLLBACK'); return res.status(400).json({ error:'already running' }); }

    // pick first pending
    const spRes = await client.query(`
      SELECT session_player_id FROM session_players WHERE auction_id = $1 AND status = 'PENDING' ORDER BY created_at ASC LIMIT 1
    `,[auctionId]);
    if (spRes.rowCount === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error:'no players' }); }
    const sessionPlayerId = spRes.rows[0].session_player_id;

    const now = new Date();
    const endsAt = new Date(now.getTime() + (auction.bid_timer_seconds || 30) * 1000);

    await client.query(`UPDATE auctions SET status='RUNNING', current_live_session_player_id=$2, current_round_started_at=$3, current_round_ends_at=$4, updated_at=now() WHERE auction_id=$1`, [auctionId, sessionPlayerId, now, endsAt]);
    await client.query(`UPDATE session_players SET status='LIVE', live_started_at=$2, live_ends_at=$3 WHERE session_player_id=$1`, [sessionPlayerId, now, endsAt]);

    await client.query('COMMIT');
    return res.json({ message:'started', sessionPlayerId, timeRemainingSeconds: Math.floor((endsAt - Date.now())/1000) });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('start err', err.stack || err);
    return res.status(500).json({ error:'failed' });
  } finally { client.release(); }
});

// GET /api/auction/sessions/:auctionId/live
router.get('/sessions/:auctionId/live', async (req, res) => {
  try {
    const { auctionId } = req.params;
    const aRes = await pool.query('SELECT * FROM auctions WHERE auction_id = $1', [auctionId]);
    if (aRes.rowCount === 0) return res.status(404).json({ error:'not found' });
    const auction = aRes.rows[0];
    if (!auction.current_live_session_player_id) return res.json({ auction, livePlayer: null });

    const pRes = await pool.query(`
      SELECT sp.*, pp.player_name, pp.base_bid_amount
      FROM session_players sp JOIN player_pool pp ON pp.pool_player_id = sp.pool_player_id
      WHERE sp.session_player_id = $1
    `, [auction.current_live_session_player_id]);
    if (pRes.rowCount === 0) return res.status(500).json({ error:'live player missing' });
    const livePlayer = pRes.rows[0];
    const timeRemainingSeconds = auction.current_round_ends_at ? Math.max(0, Math.floor((new Date(auction.current_round_ends_at) - Date.now())/1000)) : null;
    return res.json({ auction, livePlayer: { ...livePlayer, timeRemainingSeconds } });
  } catch (err) {
    console.error('live err', err.stack || err);
    return res.status(500).json({ error:'failed' });
  }
});

// POST /api/auction/sessions/:auctionId/bids  -> place bid (simple, no reserve hold)
router.post('/sessions/:auctionId/bids', async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    const { userId, sessionPlayerId, bidAmount } = req.body || {};
    if (!userId || !sessionPlayerId || bidAmount == null) return res.status(400).json({ error:'missing' });
    const bid = Number(bidAmount);
    if (!Number.isFinite(bid) || bid <= 0) return res.status(400).json({ error:'invalid bid' });

    await client.query('BEGIN');

    const aRes = await client.query('SELECT * FROM auctions WHERE auction_id = $1 FOR UPDATE', [auctionId]);
    if (aRes.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error:'auction not found' }); }
    const auction = aRes.rows[0];
    if (auction.status !== 'RUNNING') { await client.query('ROLLBACK'); return res.status(400).json({ error:'auction not running' }); }

    const spRes = await client.query('SELECT status, last_highest_bid_amount, base_bid_amount FROM session_players sp JOIN player_pool pp ON pp.pool_player_id = sp.pool_player_id WHERE sp.session_player_id = $1 AND sp.auction_id = $2', [sessionPlayerId, auctionId]);
    if (spRes.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error:'session player not found' }); }
    const sp = spRes.rows[0];
    if (sp.status !== 'LIVE') { await client.query('ROLLBACK'); return res.status(400).json({ error:'player not live' }); }

    const base = Number(sp.base_bid_amount || 0);
    const lastHighest = sp.last_highest_bid_amount != null ? Number(sp.last_highest_bid_amount) : base;
    const minReq = lastHighest + Number(auction.min_bid_increment || 0.5);
    if (bid < minReq) { await client.query('ROLLBACK'); return res.status(400).json({ error:'bid too low', minReq }); }

    // record bid
    await client.query('INSERT INTO bids (auction_id, session_player_id, user_id, bid_amount) VALUES ($1,$2,$3,$4)', [auctionId, sessionPlayerId, userId, bid]);

    // update session_players last_highest
    await client.query('UPDATE session_players SET last_highest_bid_amount=$2, last_highest_bid_user_id=$3 WHERE session_player_id=$1', [sessionPlayerId, bid, userId]);

    await client.query('COMMIT');
    return res.status(201).json({ message:'bid accepted', bidAmount: bid });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('bid err', err.stack || err);
    return res.status(500).json({ error:'failed' });
  } finally { client.release(); }
});

// POST /api/auction/sessions/:auctionId/live/close  -> close round (SOLD/UNSOLD)
router.post('/sessions/:auctionId/live/close', async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    await client.query('BEGIN');

    const aRes = await client.query('SELECT * FROM auctions WHERE auction_id=$1 FOR UPDATE', [auctionId]);
    if (aRes.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error:'auction not found' }); }
    const auction = aRes.rows[0];
    const liveId = auction.current_live_session_player_id;
    if (!liveId) { await client.query('ROLLBACK'); return res.status(400).json({ error:'no live player' }); }

    const spRes = await client.query('SELECT session_player_id, last_highest_bid_amount, last_highest_bid_user_id FROM session_players WHERE session_player_id=$1 AND auction_id=$2 FOR UPDATE', [liveId, auctionId]);
    if (spRes.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error:'live not found' }); }
    const sp = spRes.rows[0];

    if (sp.last_highest_bid_amount && sp.last_highest_bid_user_id) {
      // SOLD
      const lastBid = Number(sp.last_highest_bid_amount);
      const winner = sp.last_highest_bid_user_id;

      // deduct wallet (simple)
      const wRes = await client.query('SELECT wallet_id, current_balance FROM wallets WHERE auction_id=$1 AND user_id=$2 FOR UPDATE', [auctionId, winner]);
      if (wRes.rowCount === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error:'winner wallet not found' }); }
      const w = wRes.rows[0];
      const newBalance = Number(w.current_balance) - lastBid;
      if (newBalance < 0) { await client.query('ROLLBACK'); return res.status(400).json({ error:'insufficient balance' }); }

      await client.query('UPDATE wallets SET current_balance=$2 WHERE wallet_id=$1', [w.wallet_id, newBalance]);
      await client.query('INSERT INTO squad_players (auction_id, user_id, session_player_id, purchase_price) VALUES ($1,$2,$3,$4)', [auctionId, winner, liveId, lastBid]);
      await client.query('UPDATE session_players SET status=$2 WHERE session_player_id=$1', [liveId, 'SOLD']);
    } else {
      // UNSOLD
      await client.query('UPDATE session_players SET status=$2 WHERE session_player_id=$1', [liveId, 'UNSOLD']);
    }

    // clear live pointer
    await client.query('UPDATE auctions SET current_live_session_player_id=null, current_round_started_at=null, current_round_ends_at=null WHERE auction_id=$1', [auctionId]);

    await client.query('COMMIT');
    return res.json({ message:'round closed' });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('close err', err.stack || err);
    return res.status(500).json({ error:'failed' });
  } finally { client.release(); }
});

module.exports = router;
