// routes/auctionRoutes.js
// CrickEdge Auction Module – Phase 1 + Phase 2
// Phase 1:
//   - Player pool import & listing
//   - Create auction sessions
//   - List sessions & session players
//   - Register participants + wallet
// Phase 2:
//   - Start auction (set first LIVE player)
//   - Get live state for UI
//   - Place bids with full validation
//   - Close current round (SOLD/UNSOLD)
//   - Pick next player

const express = require("express");
const router = express.Router();
const pool = require("../db"); // your existing pg pool

// Allowed enums
const VALID_SKILLS = ["Batsman", "Bowler", "Allrounder", "WicketKeeper/Batsman"];
const VALID_CATEGORIES = ["Legend", "Platinum", "Gold"];

// Helpers
const toNumber = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// --- PHASE 1.1 – IMPORT PLAYER POOL --------------------------

/**
 * POST /api/auction/player-pool/import
 *
 * Body:
 * {
 *   "players": [
 *     {
 *       "playerCode": "P001",
 *       "playerName": "Sachin Tendulkar",
 *       "country": "India",
 *       "skillType": "Batsman",
 *       "category": "Legend",
 *       "bidAmount": 10
 *     },
 *     ...
 *   ]
 * }
 */
router.post("/player-pool/import", async (req, res) => {
  const client = await pool.connect();
  try {
    const { players } = req.body || {};
    if (!Array.isArray(players) || players.length === 0) {
      return res.status(400).json({ error: "Players array is required and cannot be empty." });
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    await client.query("BEGIN");

    for (let idx = 0; idx < players.length; idx++) {
      const row = players[idx];

      const playerCode = row.playerCode?.trim() || null;
      const playerName = row.playerName?.trim();
      const country = row.country?.trim();
      const skillType = row.skillType?.trim();
      const category = row.category?.trim();
      const bidAmount = toNumber(row.bidAmount);

      // Basic validation
      if (!playerName || !country || !skillType || !category || bidAmount == null) {
        skipped++;
        errors.push({
          index: idx,
          reason: "Missing required fields (playerName, country, skillType, category, bidAmount).",
        });
        continue;
      }

      if (!VALID_SKILLS.includes(skillType)) {
        skipped++;
        errors.push({
          index: idx,
          reason: `Invalid skillType: ${skillType}`,
        });
        continue;
      }

      if (!VALID_CATEGORIES.includes(category)) {
        skipped++;
        errors.push({
          index: idx,
          reason: `Invalid category: ${category}`,
        });
        continue;
      }

      // Upsert by external_player_code (playerCode). If no code, treat as insert-only.
      if (playerCode) {
        const result = await client.query(
          `
          INSERT INTO auction_player_pool
            (external_player_code, player_name, country, skill_type, category, base_bid_amount, is_active, created_at, updated_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
          ON CONFLICT (external_player_code)
          DO UPDATE SET
            player_name = EXCLUDED.player_name,
            country = EXCLUDED.country,
            skill_type = EXCLUDED.skill_type,
            category = EXCLUDED.category,
            base_bid_amount = EXCLUDED.base_bid_amount,
            is_active = TRUE,
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted
        `,
          [playerCode, playerName, country, skillType, category, bidAmount]
        );

        const rowInserted = result.rows[0]?.inserted;
        if (rowInserted) {
          inserted++;
        } else {
          updated++;
        }
      } else {
        // No playerCode (should not happen with your CSV, but keep safe)
        await client.query(
          `
          INSERT INTO auction_player_pool
            (external_player_code, player_name, country, skill_type, category, base_bid_amount, is_active, created_at, updated_at)
          VALUES
            (NULL, $1, $2, $3, $4, $5, TRUE, NOW(), NOW())
        `,
          [playerName, country, skillType, category, bidAmount]
        );
        inserted++;
      }
    }

    await client.query("COMMIT");

    return res.json({
      message: "Player pool import completed.",
      total: players.length,
      inserted,
      updated,
      skipped,
      errors,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error importing player pool:", err);
    return res.status(500).json({ error: "Failed to import player pool." });
  } finally {
    client.release();
  }
});

// --- PHASE 1.2 – LIST PLAYER POOL ----------------------------

/**
 * GET /api/auction/player-pool?country=India&skillType=Batsman&category=Legend&search=sachin
 */
router.get("/player-pool", async (req, res) => {
  try {
    const { country, skillType, category, search } = req.query;

    const where = [];
    const params = [];

    if (country) {
      params.push(country);
      where.push(`country = $${params.length}`);
    }
    if (skillType) {
      params.push(skillType);
      where.push(`skill_type = $${params.length}`);
    }
    if (category) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`player_name ILIKE $${params.length}`);
    }

    let sql = `
      SELECT
        pool_player_id,
        external_player_code AS "playerCode",
        player_name AS "playerName",
        country,
        skill_type AS "skillType",
        category,
        base_bid_amount AS "bidAmount",
        is_active
      FROM auction_player_pool
    `;
    if (where.length > 0) {
      sql += " WHERE " + where.join(" AND ");
    }
    sql += " ORDER BY country, category, player_name";

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Error listing player pool:", err);
    return res.status(500).json({ error: "Failed to fetch player pool." });
  }
});

// --- PHASE 1.3 – CREATE AUCTION SESSION ----------------------

/**
 * POST /api/auction/sessions
 * Body:
 * {
 *   "name": "CrickEdge Mega Auction 2026",
 *   "maxSquadSize": 13,
 *   "minExitSquadSize": 11,
 *   "initialWalletAmount": 120,
 *   "bidTimerSeconds": 30,
 *   "minBidIncrement": 0.5,
 *   "useEntirePool": true
 * }
 */
router.post("/sessions", async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      name,
      maxSquadSize = 13,
      minExitSquadSize = 11,
      initialWalletAmount = 120,
      bidTimerSeconds = 30,
      minBidIncrement = 0.5,
      useEntirePool = true,
    } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Auction name is required." });
    }

    const maxSquad = parseInt(maxSquadSize, 10) || 13;
    const minExit = parseInt(minExitSquadSize, 10) || 11;
    const initWallet = toNumber(initialWalletAmount, 120);
    const timerSec = parseInt(bidTimerSeconds, 10) || 30;
    const minInc = toNumber(minBidIncrement, 0.5);

    await client.query("BEGIN");

    const insertSession = await client.query(
      `
      INSERT INTO auction_sessions
        (name, status, max_squad_size, min_exit_squad_size,
         initial_wallet_amount, bid_timer_seconds, min_bid_increment,
         created_at, updated_at)
      VALUES
        ($1, 'NOT_STARTED', $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING auction_id, name, status, max_squad_size, min_exit_squad_size,
                initial_wallet_amount, bid_timer_seconds, min_bid_increment, created_at
    `,
      [name.trim(), maxSquad, minExit, initWallet, timerSec, minInc]
    );

    const session = insertSession.rows[0];
    const auctionId = session.auction_id;

    let attachedPlayers = 0;

    if (useEntirePool) {
      const attach = await client.query(
        `
        INSERT INTO auction_session_players
          (auction_id, pool_player_id, status, created_at, updated_at)
        SELECT
          $1 AS auction_id,
          pool_player_id,
          'PENDING' AS status,
          NOW() AS created_at,
          NOW() AS updated_at
        FROM auction_player_pool
        WHERE is_active = TRUE
        RETURNING session_player_id
      `,
        [auctionId]
      );
      attachedPlayers = attach.rowCount;
    }

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Auction session created.",
      session: {
        auctionId,
        name: session.name,
        status: session.status,
        maxSquadSize: session.max_squad_size,
        minExitSquadSize: session.min_exit_squad_size,
        initialWalletAmount: Number(session.initial_wallet_amount),
        bidTimerSeconds: session.bid_timer_seconds,
        minBidIncrement: Number(session.min_bid_increment),
        createdAt: session.created_at,
        attachedPlayers,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating auction session:", err);
    return res.status(500).json({ error: "Failed to create auction session." });
  } finally {
    client.release();
  }
});

// --- PHASE 1.4 – LIST AUCTION SESSIONS -----------------------

/**
 * GET /api/auction/sessions
 */
router.get("/sessions", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        s.auction_id AS "auctionId",
        s.name,
        s.status,
        s.max_squad_size AS "maxSquadSize",
        s.min_exit_squad_size AS "minExitSquadSize",
        s.initial_wallet_amount AS "initialWalletAmount",
        s.bid_timer_seconds AS "bidTimerSeconds",
        s.min_bid_increment AS "minBidIncrement",
        s.created_at AS "createdAt",
        COUNT(sp.session_player_id) AS "totalPlayers"
      FROM auction_sessions s
      LEFT JOIN auction_session_players sp
        ON sp.auction_id = s.auction_id
      GROUP BY s.auction_id
      ORDER BY s.created_at DESC
    `
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Error listing auction sessions:", err);
    return res.status(500).json({ error: "Failed to fetch auction sessions." });
  }
});

// --- PHASE 1.5 – LIST PLAYERS FOR A SESSION ------------------

/**
 * GET /api/auction/sessions/:auctionId/players?status=PENDING&skillType=Batsman&category=Legend
 */
router.get("/sessions/:auctionId/players", async (req, res) => {
  try {
    const { auctionId } = req.params;
    const { status, skillType, category } = req.query;

    if (!auctionId) {
      return res.status(400).json({ error: "auctionId is required." });
    }

    const where = ["sp.auction_id = $1"];
    const params = [auctionId];

    if (status) {
      params.push(status);
      where.push(`sp.status = $${params.length}`);
    }
    if (skillType) {
      params.push(skillType);
      where.push(`pp.skill_type = $${params.length}`);
    }
    if (category) {
      params.push(category);
      where.push(`pp.category = $${params.length}`);
    }

    const sql = `
      SELECT
        sp.session_player_id AS "sessionPlayerId",
        sp.status,
        sp.final_bid_amount AS "finalBidAmount",
        sp.sold_to_user_id AS "soldToUserId",
        pp.pool_player_id AS "poolPlayerId",
        pp.external_player_code AS "playerCode",
        pp.player_name AS "playerName",
        pp.country,
        pp.skill_type AS "skillType",
        pp.category,
        pp.base_bid_amount AS "baseBidAmount"
      FROM auction_session_players sp
      JOIN auction_player_pool pp
        ON pp.pool_player_id = sp.pool_player_id
      WHERE ${where.join(" AND ")}
      ORDER BY
        sp.status DESC,
        pp.category DESC,
        pp.player_name ASC
    `;

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error("Error listing session players:", err);
    return res.status(500).json({ error: "Failed to fetch auction session players." });
  }
});

// --- PHASE 1.6 – REGISTER PARTICIPANT + WALLET ---------------

/**
 * POST /api/auction/sessions/:auctionId/participants
 * Body:
 * { "userId": "some-user-uuid", "roleInAuction": "PARTICIPANT" }
 */
router.post("/sessions/:auctionId/participants", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    let { userId, roleInAuction } = req.body || {};

    if (!auctionId) {
      return res.status(400).json({ error: "auctionId is required." });
    }

    // TODO: integrate with auth (req.user.id)
    if (!userId) {
      return res.status(400).json({ error: "userId is required (until auth is wired)." });
    }

    roleInAuction = roleInAuction || "PARTICIPANT";

    await client.query("BEGIN");

    const sRes = await client.query(
      `SELECT auction_id, initial_wallet_amount FROM auction_sessions WHERE auction_id = $1`,
      [auctionId]
    );
    if (sRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Auction session not found." });
    }
    const session = sRes.rows[0];

    const pRes = await client.query(
      `
      INSERT INTO auction_participants
        (auction_id, user_id, role_in_auction, status, is_active, created_at, updated_at)
      VALUES
        ($1, $2, $3, 'ACTIVE', TRUE, NOW(), NOW())
      ON CONFLICT (auction_id, user_id)
      DO UPDATE SET
        role_in_auction = EXCLUDED.role_in_auction,
        status = 'ACTIVE',
        is_active = TRUE,
        updated_at = NOW()
      RETURNING participant_id, role_in_auction, status
    `,
      [auctionId, userId, roleInAuction]
    );
    const participant = pRes.rows[0];

    const wRes = await client.query(
      `
      INSERT INTO auction_wallets
        (auction_id, user_id, initial_amount, current_balance, status, created_at, updated_at)
      VALUES
        ($1, $2, $3, $3, 'ACTIVE', NOW(), NOW())
      ON CONFLICT (auction_id, user_id)
      DO UPDATE SET
        status = 'ACTIVE',
        updated_at = NOW()
      RETURNING wallet_id, initial_amount, current_balance, status
    `,
      [auctionId, userId, session.initial_wallet_amount]
    );
    const wallet = wRes.rows[0];

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Participant registered for auction.",
      participant: {
        participantId: participant.participant_id,
        auctionId,
        userId,
        roleInAuction: participant.role_in_auction,
        status: participant.status,
      },
      wallet: {
        walletId: wallet.wallet_id,
        initialAmount: Number(wallet.initial_amount),
        currentBalance: Number(wallet.current_balance),
        status: wallet.status,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error registering auction participant:", err);
    return res.status(500).json({ error: "Failed to register participant." });
  } finally {
    client.release();
  }
});

// =============================================================
// ===============  PHASE 2 – CORE AUCTION FLOW  ===============
// =============================================================

// Helper: get auction with session-level fields
async function getAuctionById(clientOrPool, auctionId) {
  const res = await clientOrPool.query(
    `
    SELECT
      auction_id,
      name,
      status,
      max_squad_size,
      min_exit_squad_size,
      initial_wallet_amount,
      bid_timer_seconds,
      min_bid_increment,
      current_live_session_player_id,
      current_round_started_at,
      current_round_ends_at
    FROM auction_sessions
    WHERE auction_id = $1
  `,
    [auctionId]
  );
  return res.rows[0] || null;
}

// --- PHASE 2.1 – START AUCTION (set first LIVE player) -------

/**
 * POST /api/auction/sessions/:auctionId/start
 */
router.post("/sessions/:auctionId/start", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    await client.query("BEGIN");

    const auction = await getAuctionById(client, auctionId);
    if (!auction) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Auction session not found." });
    }

    if (auction.status !== "NOT_STARTED") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Auction is already ${auction.status}.` });
    }

    // Find first PENDING player
    const pRes = await client.query(
      `
      SELECT session_player_id, pool_player_id
      FROM auction_session_players
      WHERE auction_id = $1
        AND status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT 1
    `,
      [auctionId]
    );

    if (pRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No players available to start the auction." });
    }

    const sessionPlayerId = pRes.rows[0].session_player_id;
    const now = new Date();
    const bidTimerSeconds = auction.bid_timer_seconds || 30;
    const endsAt = new Date(now.getTime() + bidTimerSeconds * 1000);

    await client.query(
      `
      UPDATE auction_sessions
      SET
        status = 'RUNNING',
        current_live_session_player_id = $2,
        current_round_started_at = $3,
        current_round_ends_at = $4,
        updated_at = NOW()
      WHERE auction_id = $1
    `,
      [auctionId, sessionPlayerId, now, endsAt]
    );

    await client.query(
      `
      UPDATE auction_session_players
      SET
        status = 'LIVE',
        live_started_at = $2,
        live_ends_at = $3,
        last_highest_bid_amount = NULL,
        last_highest_bid_user_id = NULL,
        updated_at = NOW()
      WHERE session_player_id = $1
    `,
      [sessionPlayerId, now, endsAt]
    );

    // Fetch player info for response
    const liveRes = await client.query(
      `
      SELECT
        sp.session_player_id AS "sessionPlayerId",
        sp.status,
        sp.live_started_at,
        sp.live_ends_at,
        pp.pool_player_id AS "poolPlayerId",
        pp.external_player_code AS "playerCode",
        pp.player_name AS "playerName",
        pp.country,
        pp.skill_type AS "skillType",
        pp.category,
        pp.base_bid_amount AS "baseBidAmount"
      FROM auction_session_players sp
      JOIN auction_player_pool pp
        ON pp.pool_player_id = sp.pool_player_id
      WHERE sp.session_player_id = $1
    `,
      [sessionPlayerId]
    );
    const livePlayer = liveRes.rows[0];

    await client.query("COMMIT");

    const timeRemainingSeconds = Math.max(
      0,
      Math.floor((new Date(livePlayer.live_ends_at).getTime() - Date.now()) / 1000)
    );

    return res.json({
      message: "Auction started.",
      auction: {
        auctionId: auction.auction_id,
        status: "RUNNING",
      },
      livePlayer: {
        ...livePlayer,
        timeRemainingSeconds,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error starting auction:", err);
    return res.status(500).json({ error: "Failed to start auction." });
  } finally {
    client.release();
  }
});

// --- PHASE 2.2 – GET LIVE STATE FOR UI -----------------------

/**
 * GET /api/auction/sessions/:auctionId/live?userId=...
 *
 * NOTE: userId is TEMP until you wire auth & use req.user.id
 */
router.get("/sessions/:auctionId/live", async (req, res) => {
  try {
    const { auctionId } = req.params;
    const { userId } = req.query;

    if (!auctionId) {
      return res.status(400).json({ error: "auctionId is required." });
    }

    const auction = await getAuctionById(pool, auctionId);
    if (!auction) {
      return res.status(404).json({ error: "Auction session not found." });
    }

    // Live player info (if any)
    let livePlayer = null;
    if (auction.current_live_session_player_id) {
      const pRes = await pool.query(
        `
        SELECT
          sp.session_player_id AS "sessionPlayerId",
          sp.status,
          sp.live_started_at,
          sp.live_ends_at,
          sp.last_highest_bid_amount AS "lastHighestBidAmount",
          sp.last_highest_bid_user_id AS "lastHighestBidUserId",
          pp.pool_player_id AS "poolPlayerId",
          pp.external_player_code AS "playerCode",
          pp.player_name AS "playerName",
          pp.country,
          pp.skill_type AS "skillType",
          pp.category,
          pp.base_bid_amount AS "baseBidAmount"
        FROM auction_session_players sp
        JOIN auction_player_pool pp
          ON pp.pool_player_id = sp.pool_player_id
        WHERE sp.session_player_id = $1
      `,
        [auction.current_live_session_player_id]
      );
      if (pRes.rowCount > 0) {
        livePlayer = pRes.rows[0];
      }
    }

    let timeRemainingSeconds = null;
    if (auction.current_round_ends_at) {
      timeRemainingSeconds = Math.max(
        0,
        Math.floor((new Date(auction.current_round_ends_at).getTime() - Date.now()) / 1000)
      );
    }

    // User context (wallet + squad size + status)
    let userContext = null;
    if (userId) {
      const [partRes, walletRes, squadRes] = await Promise.all([
        pool.query(
          `
          SELECT role_in_auction, status
          FROM auction_participants
          WHERE auction_id = $1 AND user_id = $2
        `,
          [auctionId, userId]
        ),
        pool.query(
          `
          SELECT current_balance, status
          FROM auction_wallets
          WHERE auction_id = $1 AND user_id = $2
        `,
          [auctionId, userId]
        ),
        pool.query(
          `
          SELECT COUNT(*)::int AS squad_size
          FROM auction_squad_players
          WHERE auction_id = $1 AND user_id = $2
        `,
          [auctionId, userId]
        ),
      ]);

      const participant = partRes.rows[0] || null;
      const wallet = walletRes.rows[0] || null;
      const squadSize = squadRes.rows[0]?.squad_size || 0;

      userContext = {
        userId,
        roleInAuction: participant?.role_in_auction || "PARTICIPANT",
        participantStatus: participant?.status || "ACTIVE",
        walletBalance: wallet ? Number(wallet.current_balance) : null,
        walletStatus: wallet?.status || null,
        currentSquadSize: squadSize,
      };
    }

    return res.json({
      auction: {
        auctionId: auction.auction_id,
        name: auction.name,
        status: auction.status,
        maxSquadSize: auction.max_squad_size,
        minExitSquadSize: auction.min_exit_squad_size,
        initialWalletAmount: Number(auction.initial_wallet_amount),
        bidTimerSeconds: auction.bid_timer_seconds,
        minBidIncrement: Number(auction.min_bid_increment),
      },
      livePlayer: livePlayer
        ? {
            ...livePlayer,
            timeRemainingSeconds,
          }
        : null,
      userContext,
    });
  } catch (err) {
    console.error("Error fetching live auction state:", err);
    return res.status(500).json({ error: "Failed to fetch live auction state." });
  }
});

// --- PHASE 2.3 – PLACE BID -----------------------------------

/**
 * POST /api/auction/sessions/:auctionId/bids
 *
 * Body:
 * {
 *   "userId": "...",          // TEMP until auth is wired
 *   "sessionPlayerId": "...",
 *   "bidAmount": 10.75
 * }
 */
router.post("/sessions/:auctionId/bids", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    const { userId, sessionPlayerId, bidAmount } = req.body || {};

    if (!auctionId || !userId || !sessionPlayerId || bidAmount == null) {
      return res.status(400).json({ error: "auctionId, userId, sessionPlayerId, bidAmount are required." });
    }

    const bid = toNumber(bidAmount);
    if (!Number.isFinite(bid) || bid <= 0) {
      return res.status(400).json({ error: "Invalid bidAmount." });
    }

    await client.query("BEGIN");

    const auction = await getAuctionById(client, auctionId);
    if (!auction) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Auction session not found." });
    }

    if (auction.status !== "RUNNING") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Auction is not running (status: ${auction.status}).` });
    }

    if (!auction.current_live_session_player_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No live player at the moment." });
    }

    if (auction.current_live_session_player_id !== sessionPlayerId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "This player is not the current live player." });
    }

    if (auction.current_round_ends_at && new Date() > new Date(auction.current_round_ends_at)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Bidding time is over for this player." });
    }

    // Participant & wallet
    const partRes = await client.query(
      `
      SELECT role_in_auction, status
      FROM auction_participants
      WHERE auction_id = $1 AND user_id = $2
    `,
      [auctionId, userId]
    );
    const participant = partRes.rows[0];
    if (!participant) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "User is not registered as a participant for this auction." });
    }
    if (participant.status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: `Participant is not active (status: ${participant.status}).` });
    }

    const walletRes = await client.query(
      `
      SELECT current_balance
      FROM auction_wallets
      WHERE auction_id = $1 AND user_id = $2
      FOR UPDATE
    `,
      [auctionId, userId]
    );
    const wallet = walletRes.rows[0];
    if (!wallet) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Wallet not found for this participant." });
    }

    const currentBalance = Number(wallet.current_balance);

    // Squad size
    const squadRes = await client.query(
      `
      SELECT COUNT(*)::int AS squad_size
      FROM auction_squad_players
      WHERE auction_id = $1 AND user_id = $2
    `,
      [auctionId, userId]
    );
    const squadSize = squadRes.rows[0]?.squad_size || 0;
    if (squadSize >= auction.max_squad_size) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "You already reached maximum squad size." });
    }

    // Live player info & last highest bid
    const spRes = await client.query(
      `
      SELECT
        sp.session_player_id,
        sp.status,
        sp.last_highest_bid_amount,
        sp.last_highest_bid_user_id,
        pp.base_bid_amount
      FROM auction_session_players sp
      JOIN auction_player_pool pp
        ON pp.pool_player_id = sp.pool_player_id
      WHERE sp.session_player_id = $1
        AND sp.auction_id = $2
    `,
      [sessionPlayerId, auctionId]
    );
    if (spRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Session player not found." });
    }

    const sp = spRes.rows[0];
    if (sp.status !== "LIVE") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "This player is not LIVE." });
    }

    const base = Number(sp.base_bid_amount);
    const lastHighest = sp.last_highest_bid_amount != null ? Number(sp.last_highest_bid_amount) : null;
    const minInc = Number(auction.min_bid_increment) || 0.5;

    const floorBase = base;
    const floorCurrent = lastHighest != null ? lastHighest : base;
    const minRequired = floorCurrent + minInc;

    if (bid < minRequired) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Bid too low. Minimum allowed is ${minRequired}.` });
    }

    if (bid > currentBalance) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance for this bid." });
    }

    // Insert bid
    await client.query(
      `
      INSERT INTO auction_bids
        (auction_id, session_player_id, user_id, bid_amount, is_winning, created_at)
      VALUES
        ($1, $2, $3, $4, FALSE, NOW())
    `,
      [auctionId, sessionPlayerId, userId, bid]
    );

    // Update highest bid
    await client.query(
      `
      UPDATE auction_session_players
      SET
        last_highest_bid_amount = $2,
        last_highest_bid_user_id = $3,
        updated_at = NOW()
      WHERE session_player_id = $1
    `,
      [sessionPlayerId, bid, userId]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Bid accepted.",
      sessionPlayerId,
      lastHighestBidAmount: bid,
      lastHighestBidUserId: userId,
      minNextBidAmount: minRequired + minInc,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error placing bid:", err);
    return res.status(500).json({ error: "Failed to place bid." });
  } finally {
    client.release();
  }
});

// --- PHASE 2.4 – CLOSE CURRENT ROUND -------------------------

/**
 * POST /api/auction/sessions/:auctionId/live/close
 *
 * Closes current LIVE player:
 * - If there is a highest bid -> SOLD
 * - Else -> UNSOLD
 *
 * NOTE: No auto-redeem or participant completion here yet (Phase 4).
 */
router.post("/sessions/:auctionId/live/close", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;

    await client.query("BEGIN");

    const auction = await getAuctionById(client, auctionId);
    if (!auction) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Auction session not found." });
    }

    const liveSessionPlayerId = auction.current_live_session_player_id;
    if (!liveSessionPlayerId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No live player to close." });
    }

    // Fetch session player + pool info
    const spRes = await client.query(
      `
      SELECT
        sp.session_player_id,
        sp.status,
        sp.last_highest_bid_amount,
        sp.last_highest_bid_user_id,
        pp.player_name,
        pp.skill_type,
        pp.category
      FROM auction_session_players sp
      JOIN auction_player_pool pp
        ON pp.pool_player_id = sp.pool_player_id
      WHERE sp.session_player_id = $1
        AND sp.auction_id = $2
    `,
      [liveSessionPlayerId, auctionId]
    );
    if (spRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Live session player not found." });
    }
    const sp = spRes.rows[0];

    if (sp.status !== "LIVE") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Live player is not marked as LIVE." });
    }

    const lastBid = sp.last_highest_bid_amount != null ? Number(sp.last_highest_bid_amount) : null;
    const lastBidUserId = sp.last_highest_bid_user_id;

    let resultPayload = {};

    if (lastBid != null && lastBidUserId) {
      // SOLD case
      // Deduct from winner's wallet
      const walletRes = await client.query(
        `
        SELECT wallet_id, current_balance
        FROM auction_wallets
        WHERE auction_id = $1 AND user_id = $2
        FOR UPDATE
      `,
        [auctionId, lastBidUserId]
      );
      const wallet = walletRes.rows[0];
      if (!wallet) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Winner's wallet not found." });
      }

      const newBalance = Number(wallet.current_balance) - lastBid;
      if (newBalance < 0) {
        // Shouldn't happen with validation, but protect anyway
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Winner does not have enough balance." });
      }

      await client.query(
        `
        UPDATE auction_wallets
        SET current_balance = $3, updated_at = NOW()
        WHERE wallet_id = $1
      `,
        [wallet.wallet_id, lastBidUserId, newBalance]
      );

      // Mark bid as winning
      await client.query(
        `
        UPDATE auction_bids
        SET is_winning = TRUE
        WHERE auction_id = $1
          AND session_player_id = $2
          AND user_id = $3
          AND bid_amount = $4
      `,
        [auctionId, sp.session_player_id, lastBidUserId, lastBid]
      );

      // Add to squad
      await client.query(
        `
        INSERT INTO auction_squad_players
          (auction_id, user_id, session_player_id, purchase_price, skill_type, category, created_at, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      `,
        [auctionId, lastBidUserId, sp.session_player_id, lastBid, sp.skill_type, sp.category]
      );

      // Update session player as SOLD
      await client.query(
        `
        UPDATE auction_session_players
        SET
          status = 'SOLD',
          final_bid_amount = $2,
          sold_to_user_id = $3,
          updated_at = NOW()
        WHERE session_player_id = $1
      `,
        [sp.session_player_id, lastBid, lastBidUserId]
      );

      resultPayload = {
        result: "SOLD",
        playerName: sp.player_name,
        amount: lastBid,
        winnerUserId: lastBidUserId,
      };
    } else {
      // UNSOLD case
      await client.query(
        `
        UPDATE auction_session_players
        SET
          status = 'UNSOLD',
          final_bid_amount = NULL,
          sold_to_user_id = NULL,
          updated_at = NOW()
        WHERE session_player_id = $1
      `,
        [sp.session_player_id]
      );

      resultPayload = {
        result: "UNSOLD",
        playerName: sp.player_name,
      };
    }

    // Clear live state on auction
    await client.query(
      `
      UPDATE auction_sessions
      SET
        current_live_session_player_id = NULL,
        current_round_started_at = NULL,
        current_round_ends_at = NULL,
        updated_at = NOW()
      WHERE auction_id = $1
    `,
      [auctionId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Round closed.",
      auctionId,
      ...resultPayload,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error closing live round:", err);
    return res.status(500).json({ error: "Failed to close live round." });
  } finally {
    client.release();
  }
});

// --- PHASE 2.5 – PICK NEXT PLAYER ----------------------------

/**
 * POST /api/auction/sessions/:auctionId/next-player
 *
 * For now: auto-picks first PENDING/RECLAIMED.
 * (Later we'll apply skill/category push rules here.)
 */
router.post("/sessions/:auctionId/next-player", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;

    await client.query("BEGIN");

    const auction = await getAuctionById(client, auctionId);
    if (!auction) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Auction session not found." });
    }

    if (auction.status !== "RUNNING") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Auction is not running (status: ${auction.status}).` });
    }

    if (auction.current_live_session_player_id) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "A player is already LIVE. Close the current round before starting the next." });
    }

    // Find next PENDING or RECLAIMED player
    const pRes = await client.query(
      `
      SELECT session_player_id
      FROM auction_session_players
      WHERE auction_id = $1
        AND status IN ('PENDING','RECLAIMED')
      ORDER BY created_at ASC
      LIMIT 1
    `,
      [auctionId]
    );

    if (pRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No more players available for this auction." });
    }

    const sessionPlayerId = pRes.rows[0].session_player_id;

    const now = new Date();
    const bidTimerSeconds = auction.bid_timer_seconds || 30;
    const endsAt = new Date(now.getTime() + bidTimerSeconds * 1000);

    await client.query(
      `
      UPDATE auction_sessions
      SET
        current_live_session_player_id = $2,
        current_round_started_at = $3,
        current_round_ends_at = $4,
        updated_at = NOW()
      WHERE auction_id = $1
    `,
      [auctionId, sessionPlayerId, now, endsAt]
    );

    await client.query(
      `
      UPDATE auction_session_players
      SET
        status = 'LIVE',
        live_started_at = $2,
        live_ends_at = $3,
        last_highest_bid_amount = NULL,
        last_highest_bid_user_id = NULL,
        updated_at = NOW()
      WHERE session_player_id = $1
    `,
      [sessionPlayerId, now, endsAt]
    );

    const liveRes = await client.query(
      `
      SELECT
        sp.session_player_id AS "sessionPlayerId",
        sp.status,
        sp.live_started_at,
        sp.live_ends_at,
        pp.pool_player_id AS "poolPlayerId",
        pp.external_player_code AS "playerCode",
        pp.player_name AS "playerName",
        pp.country,
        pp.skill_type AS "skillType",
        pp.category,
        pp.base_bid_amount AS "baseBidAmount"
      FROM auction_session_players sp
      JOIN auction_player_pool pp
        ON pp.pool_player_id = sp.pool_player_id
      WHERE sp.session_player_id = $1
    `,
      [sessionPlayerId]
    );
    const livePlayer = liveRes.rows[0];

    await client.query("COMMIT");

    const timeRemainingSeconds = Math.max(
      0,
      Math.floor((new Date(livePlayer.live_ends_at).getTime() - Date.now()) / 1000)
    );

    return res.json({
      message: "Next player set to LIVE.",
      auctionId,
      livePlayer: {
        ...livePlayer,
        timeRemainingSeconds,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error picking next player:", err);
    return res.status(500).json({ error: "Failed to set next live player." });
  } finally {
    client.release();
  }
});

module.exports = router;
