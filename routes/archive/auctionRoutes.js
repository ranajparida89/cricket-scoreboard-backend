// routes/auctionRoutes.js
// CrickEdge Auction Module – Phase 1 + Phase 2 + Phase 3 + Phase 4
//
// Phase 1:
//   - Player pool import & listing
//   - Create auction sessions
//   - List sessions & session players
//   - Register participants + wallet
//
// Phase 2:
//   - Start auction (set first LIVE player)
//   - Get live state for UI
//   - Place bids with full validation
//   - Close current round (SOLD/UNSOLD)
//   - Pick next player
//
// Phase 3:
//   - Pause / Resume / End auction
//   - Mark participant COMPLETED when squad size == max
//   - Voluntary exit for participants (>= minExitSquadSize)
//
// Phase 4:
//   - Auto-redeem expensive players if user is "stuck"
//   - Admin push rules (skill/category/count) for sequence
//   - Auto-end auction when no players or participants

const express = require("express");
const router = express.Router();
const pool = require("../db");

// Allowed enums
const VALID_SKILLS = ["Batsman", "Bowler", "Allrounder", "WicketKeeper/Batsman"];
const VALID_CATEGORIES = ["Legend", "Platinum", "Gold"];

// Business rule: minimum player base price (Gold) for math
const MIN_BASE_PLAYER_PRICE = 5.5;

// Helpers
const toNumber = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

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
      current_round_ends_at,
      created_at,
      updated_at
    FROM auction_sessions
    WHERE auction_id = $1
    `,
    [auctionId]
  );
  return res.rows[0] || null;
}


/**
 * Phase 4 helper – auto-redeem expensive players if user cannot
 * mathematically reach max_squad_size with remaining balance.
 */
async function autoRedeemIfStuck(client, auction, userId) {
  // Check participant status (only for ACTIVE)
  const partRes = await client.query(
    `
    SELECT status
    FROM auction_participants
    WHERE auction_id = $1 AND user_id = $2
  `,
    [auction.auction_id, userId]
  );
  const participant = partRes.rows[0];
  if (!participant || participant.status !== "ACTIVE") {
    return { releasedCount: 0, finalBalance: null, finalSquadSize: null };
  }

  // Wallet (FOR UPDATE so we can safely modify)
  const walletRes = await client.query(
    `
    SELECT wallet_id, current_balance
    FROM auction_wallets
    WHERE auction_id = $1 AND user_id = $2
    FOR UPDATE
  `,
    [auction.auction_id, userId]
  );
  const wallet = walletRes.rows[0];
  if (!wallet) {
    return { releasedCount: 0, finalBalance: null, finalSquadSize: null };
  }

  const maxSquad = auction.max_squad_size;

  // Current squad
  const squadRes = await client.query(
    `
    SELECT
      squad_player_id,
      session_player_id,
      purchase_price
    FROM auction_squad_players
    WHERE auction_id = $1 AND user_id = $2
    ORDER BY purchase_price DESC, created_at DESC
  `,
    [auction.auction_id, userId]
  );
  let squad = squadRes.rows;
  let N = squad.length;
  let B = Number(wallet.current_balance);

  const remainingSlotsInitial = maxSquad - N;
  if (remainingSlotsInitial <= 0) {
    // Already full, don't auto-redeem
    return { releasedCount: 0, finalBalance: B, finalSquadSize: N };
  }

  // Check if currently stuck
  let remainingSlots = remainingSlotsInitial;
  let requiredMin = remainingSlots * MIN_BASE_PLAYER_PRICE;

  if (B >= requiredMin) {
    // Not stuck; no auto-redeem needed
    return { releasedCount: 0, finalBalance: B, finalSquadSize: N };
  }

  let releasedCount = 0;

  // While we are stuck and we still have players to release
  for (let i = 0; i < squad.length; i++) {
    if (B >= remainingSlots * MIN_BASE_PLAYER_PRICE) break;

    const p = squad[i];

    // Remove from squad table
    await client.query(
      `
      DELETE FROM auction_squad_players
      WHERE squad_player_id = $1
    `,
      [p.squad_player_id]
    );

    // Return player to auction as RECLAIMED
    await client.query(
      `
      UPDATE auction_session_players
      SET
        status = 'RECLAIMED',
        final_bid_amount = NULL,
        sold_to_user_id = NULL,
        last_highest_bid_amount = NULL,
        last_highest_bid_user_id = NULL,
        updated_at = NOW()
      WHERE session_player_id = $1
    `,
      [p.session_player_id]
    );

    // Refund wallet
    B += Number(p.purchase_price);
    await client.query(
      `
      UPDATE auction_wallets
      SET current_balance = $2, updated_at = NOW()
      WHERE wallet_id = $1
    `,
      [wallet.wallet_id, B]
    );

    releasedCount++;

    // Recompute remainingSlots & requiredMin
    N -= 1;
    remainingSlots = maxSquad - N;
    if (remainingSlots <= 0) break;
    requiredMin = remainingSlots * MIN_BASE_PLAYER_PRICE;
  }

  return { releasedCount, finalBalance: B, finalSquadSize: N };
}

/**
 * Phase 4 helper – auto-end auction if:
 *   - no PENDING/RECLAIMED players left, OR
 *   - no ACTIVE participants (role=PARTICIPANT) left
 */
async function maybeAutoEndAuction(client, auctionId) {
  const [playersRes, participantsRes] = await Promise.all([
    client.query(
      `
      SELECT COUNT(*)::int AS remaining
      FROM auction_session_players
      WHERE auction_id = $1 AND status IN ('PENDING','RECLAIMED')
    `,
      [auctionId]
    ),
    client.query(
      `
      SELECT COUNT(*)::int AS active_participants
      FROM auction_participants
      WHERE auction_id = $1
        AND status = 'ACTIVE'
        AND role_in_auction = 'PARTICIPANT'
    `,
      [auctionId]
    ),
  ]);

  const remaining = playersRes.rows[0]?.remaining || 0;
  const activeParticipants = participantsRes.rows[0]?.active_participants || 0;

  if (remaining === 0 || activeParticipants === 0) {
    const upd = await client.query(
      `
      UPDATE auction_sessions
      SET
        status = 'ENDED',
        current_live_session_player_id = NULL,
        current_round_started_at = NULL,
        current_round_ends_at = NULL,
        updated_at = NOW()
      WHERE auction_id = $1
        AND status <> 'ENDED'
    `,
      [auctionId]
    );
    return upd.rowCount > 0;
  }

  return false;
}

/**
 * Phase 4 helper – pick next session_player_id using push rules
 */
async function pickNextSessionPlayerIdWithRules(client, auctionId) {
  // 1) Try active rules first
  const rulesRes = await client.query(
    `
    SELECT rule_id, skill_type, category, remaining_count
    FROM auction_push_rules
    WHERE auction_id = $1
      AND is_active = TRUE
      AND remaining_count > 0
    ORDER BY priority ASC, created_at ASC
  `,
    [auctionId]
  );

  const rules = rulesRes.rows;

  for (const rule of rules) {
    const params = [auctionId];
    const where = ["sp.auction_id = $1", "sp.status IN ('PENDING','RECLAIMED')"];

    if (rule.skill_type) {
      params.push(rule.skill_type);
      where.push(`pp.skill_type = $${params.length}`);
    }
    if (rule.category) {
      params.push(rule.category);
      where.push(`pp.category = $${params.length}`);
    }

    const query = `
      SELECT sp.session_player_id
      FROM auction_session_players sp
      JOIN auction_player_pool pp
        ON pp.pool_player_id = sp.pool_player_id
      WHERE ${where.join(" AND ")}
      ORDER BY sp.created_at ASC
      LIMIT 1
    `;

    const candRes = await client.query(query, params);

    if (candRes.rowCount > 0) {
      const candidateId = candRes.rows[0].session_player_id;

      // Decrement rule count
      await client.query(
        `
        UPDATE auction_push_rules
        SET
          remaining_count = remaining_count - 1,
          is_active = CASE WHEN remaining_count - 1 <= 0 THEN FALSE ELSE TRUE END,
          updated_at = NOW()
        WHERE rule_id = $1
      `,
        [rule.rule_id]
      );

      return candidateId;
    } else {
      // No candidate matching this rule -> mark rule inactive
      await client.query(
        `
        UPDATE auction_push_rules
        SET
          remaining_count = 0,
          is_active = FALSE,
          updated_at = NOW()
        WHERE rule_id = $1
      `,
        [rule.rule_id]
      );
    }
  }

  // 2) Fallback – any PENDING/RECLAIMED
  const fallbackRes = await client.query(
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

  if (fallbackRes.rowCount === 0) {
    return null;
  }
  return fallbackRes.rows[0].session_player_id;
}

// =====================================================================
// PHASE 1 – POOL, SESSIONS, PARTICIPANTS
// =====================================================================

/**
 * POST /api/auction/player-pool/import
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
        errors.push({ index: idx, reason: `Invalid skillType: ${skillType}` });
        continue;
      }

      if (!VALID_CATEGORIES.includes(category)) {
        skipped++;
        errors.push({ index: idx, reason: `Invalid category: ${category}` });
        continue;
      }

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
        if (rowInserted) inserted++;
        else updated++;
      } else {
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

/**
 * GET /api/auction/player-pool
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

/**
 * POST /api/auction/sessions
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

/**
 * GET /api/auction/sessions/:auctionId/players
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

/**
 * POST /api/auction/sessions/:auctionId/participants
 */
router.post("/sessions/:auctionId/participants", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    let { userId, roleInAuction } = req.body || {};

    if (!auctionId) {
      return res.status(400).json({ error: "auctionId is required." });
    }

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

// =====================================================================
// PHASE 2 – CORE AUCTION FLOW
// =====================================================================

/**
 * POST /api/auction/sessions/:auctionId/start
 * FIXED VERSION – AUTO-RESET + CLEAN FIRST LIVE PLAYER
 */
router.post("/sessions/:auctionId/start", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    await client.query("BEGIN");

    // 1) Load auction
    const auction = await getAuctionById(client, auctionId);
    if (!auction) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Auction session not found." });
    }

    // 💥 FIX: If DB got stuck with RUNNING but no valid LIVE state, auto-reset everything
    if (auction.status === "RUNNING") {
      await client.query(
        `
        UPDATE auction_sessions
        SET
          status = 'NOT_STARTED',
          current_live_session_player_id = NULL,
          current_round_started_at = NULL,
          current_round_ends_at = NULL,
          updated_at = NOW()
        WHERE auction_id = $1
      `,
        [auctionId]
      );
    }

    // Now reload clean state
    const freshAuction = await getAuctionById(client, auctionId);

    if (freshAuction.status !== "NOT_STARTED") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Auction already ${freshAuction.status}.`,
      });
    }

    // 💥 FIX: Make sure NO player is accidentally in LIVE/UNFINISHED state
    await client.query(
      `
      UPDATE auction_session_players
      SET status = 'PENDING',
          live_started_at = NULL,
          live_ends_at = NULL,
          last_highest_bid_amount = NULL,
          last_highest_bid_user_id = NULL,
          updated_at = NOW()
      WHERE auction_id = $1
        AND status IN ('LIVE')
    `,
      [auctionId]
    );

    // 2) Pick first PENDING player
    const pRes = await client.query(
      `
      SELECT session_player_id
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
      return res.status(400).json({
        error: "No players available to start auction.",
      });
    }

    const sessionPlayerId = pRes.rows[0].session_player_id;

    // 3) Set LIVE + Round timer
    const now = new Date();
    const duration = freshAuction.bid_timer_seconds || 30;
    const endsAt = new Date(now.getTime() + duration * 1000);

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

    // Fetch live player details
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
      Math.floor((new Date(livePlayer.live_ends_at) - Date.now()) / 1000)
    );

    return res.json({
      message: "Auction started.",
      auction: {
        auctionId: freshAuction.auction_id,
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

/**
 * GET /api/auction/sessions/:auctionId/live
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
          SELECT role_in_auction, status, is_active
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

      // 🔹 PHASE 7: canBid flag – enforces status, is_active and maxSquad
      const maxSquadSize = auction.max_squad_size;
      const canBid =
        auction.status === "RUNNING" &&
        !!participant &&
        participant.status === "ACTIVE" &&
        participant.is_active === true &&
        squadSize < maxSquadSize;

      userContext = {
        userId,
        roleInAuction: participant?.role_in_auction || "PARTICIPANT",
        participantStatus: participant?.status || "ACTIVE",
        isActive: participant?.is_active ?? null,
        walletBalance: wallet ? Number(wallet.current_balance) : null,
        walletStatus: wallet?.status || null,
        currentSquadSize: squadSize,
        canBid,
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

/**
 * POST /api/auction/sessions/:auctionId/bids
 */
router.post("/sessions/:auctionId/bids", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    const { userId, sessionPlayerId, bidAmount } = req.body || {};

    if (!auctionId || !userId || !sessionPlayerId || bidAmount == null) {
      return res.status(400).json({
        error: "auctionId, userId, sessionPlayerId, bidAmount are required.",
      });
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
      return res
        .status(400)
        .json({ error: `Auction is not running (status: ${auction.status}).` });
    }

    if (!auction.current_live_session_player_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No live player at the moment." });
    }

    if (auction.current_live_session_player_id !== sessionPlayerId) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "This player is not the current live player." });
    }

    if (
      auction.current_round_ends_at &&
      new Date() > new Date(auction.current_round_ends_at)
    ) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Bidding time is over for this player." });
    }

    // Participant & wallet
    const partRes = await client.query(
      `
      SELECT role_in_auction, status, is_active
      FROM auction_participants
      WHERE auction_id = $1 AND user_id = $2
    `,
      [auctionId, userId]
    );
    const participant = partRes.rows[0];
    if (!participant) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "User is not registered as a participant for this auction.",
      });
    }
    if (participant.status !== "ACTIVE") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Participant is not active (status: ${participant.status}).`,
      });
    }
    // 🔹 PHASE 7: respect is_active flag as well
    if (participant.is_active === false) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "Participant is not active in this auction. Completed or exited users cannot bid.",
      });
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
      return res
        .status(400)
        .json({ error: "Wallet not found for this participant." });
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
      return res
        .status(400)
        .json({ error: "You already reached maximum squad size." });
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
      return res
        .status(400)
        .json({ error: "This player is not LIVE." });
    }

    const base = Number(sp.base_bid_amount);
    const lastHighest =
      sp.last_highest_bid_amount != null
        ? Number(sp.last_highest_bid_amount)
        : null;
    const minInc = Number(auction.min_bid_increment) || 0.5;

    const floorCurrent = lastHighest != null ? lastHighest : base;
    const minRequired = floorCurrent + minInc;

    if (bid < minRequired) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Bid too low. Minimum allowed is ${minRequired}.`,
        minAllowedBid: minRequired,
      });
    }

    if (bid > currentBalance) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Insufficient balance for this bid." });
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

/**
 * POST /api/auction/sessions/:auctionId/live/close
 *  - Handle SOLD/UNSOLD
 *  - On SOLD:
 *    - deduct wallet
 *    - add squad
 *    - mark SOLD
 *    - mark COMPLETED if squadSize == max
 *    - autoRedeemIfStuck
 *  - maybeAutoEndAuction
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
      return res
        .status(404)
        .json({ error: "Live session player not found." });
    }
    const sp = spRes.rows[0];

    if (sp.status !== "LIVE") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Live player is not marked as LIVE." });
    }

    const lastBid =
      sp.last_highest_bid_amount != null
        ? Number(sp.last_highest_bid_amount)
        : null;
    const lastBidUserId = sp.last_highest_bid_user_id;

    let resultPayload = {};
    let autoRedeemInfo = null;

    if (lastBid != null && lastBidUserId) {
      // SOLD case
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
        return res
          .status(400)
          .json({ error: "Winner's wallet not found." });
      }

      const newBalance = Number(wallet.current_balance) - lastBid;
      if (newBalance < 0) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Winner does not have enough balance." });
      }

                await client.query(
            `
            UPDATE auction_wallets
            SET current_balance = $2, updated_at = NOW()
            WHERE wallet_id = $1
            `,
            [wallet.wallet_id, newBalance]
            );

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

      await client.query(
        `
        INSERT INTO auction_squad_players
          (auction_id, user_id, session_player_id, purchase_price, skill_type, category, created_at, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      `,
        [
          auctionId,
          lastBidUserId,
          sp.session_player_id,
          lastBid,
          sp.skill_type,
          sp.category,
        ]
      );

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

      // new squad size after purchase
      const squadRes = await client.query(
        `
        SELECT COUNT(*)::int AS squad_size
        FROM auction_squad_players
        WHERE auction_id = $1 AND user_id = $2
      `,
        [auctionId, lastBidUserId]
      );
      const newSquadSize = squadRes.rows[0]?.squad_size || 0;

      // If now full -> COMPLETED and no autoRedeem
      if (newSquadSize >= auction.max_squad_size) {
        await client.query(
          `
          UPDATE auction_participants
          SET status = 'COMPLETED',
              is_active = FALSE,
              updated_at = NOW()
          WHERE auction_id = $1 AND user_id = $2
        `,
          [auctionId, lastBidUserId]
        );
      } else {
        // Run auto-redeem if user is stuck
        autoRedeemInfo = await autoRedeemIfStuck(
          client,
          auction,
          lastBidUserId
        );
      }

      resultPayload = {
        result: "SOLD",
        playerName: sp.player_name,
        amount: lastBid,
        winnerUserId: lastBidUserId,
        newSquadSize: newSquadSize,
        newWalletBalance: newBalance,
        autoRedeem: autoRedeemInfo,
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

    // Maybe auto-end
    const autoEnded = await maybeAutoEndAuction(client, auctionId);

    await client.query("COMMIT");

    return res.json({
      message: "Round closed.",
      auctionId,
      autoEnded,
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

/**
 * POST /api/auction/sessions/:auctionId/next-player
 * Uses push rules (Phase 4) if present, else fallback to any PENDING/RECLAIMED.
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
      return res
        .status(400)
        .json({ error: `Auction is not running (status: ${auction.status}).` });
    }

    if (auction.current_live_session_player_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "A player is already LIVE. Close the current round before starting the next.",
      });
    }

    const sessionPlayerId = await pickNextSessionPlayerIdWithRules(
      client,
      auctionId
    );
    if (!sessionPlayerId) {
      // no players left -> auto-end
      const autoEnded = await maybeAutoEndAuction(client, auctionId);
      await client.query("COMMIT");
      return res.status(400).json({
        error: "No more players available for this auction.",
        autoEnded,
      });
    }

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
    console.error("Error setting next player:", err);
    return res.status(500).json({ error: "Failed to set next live player." });
  } finally {
    client.release();
  }
});

// =====================================================================
// PHASE 3 – AUCTION CONTROL + PARTICIPANT LIFECYCLE
// =====================================================================

/**
 * POST /api/auction/sessions/:auctionId/pause
 */
router.post("/sessions/:auctionId/pause", async (req, res) => {
  try {
    const { auctionId } = req.params;

    const auction = await getAuctionById(pool, auctionId);
    if (!auction) {
      return res.status(404).json({ error: "Auction session not found." });
    }

    if (auction.status !== "RUNNING") {
      return res
        .status(400)
        .json({ error: `Cannot pause. Auction status is ${auction.status}.` });
    }

    await pool.query(
      `
      UPDATE auction_sessions
      SET status = 'PAUSED', updated_at = NOW()
      WHERE auction_id = $1
    `,
      [auctionId]
    );

    return res.json({
      message: "Auction paused.",
      auctionId,
      status: "PAUSED",
    });
  } catch (err) {
    console.error("Error pausing auction:", err);
    return res.status(500).json({ error: "Failed to pause auction." });
  }
});

/**
 * POST /api/auction/sessions/:auctionId/resume
 */
router.post("/sessions/:auctionId/resume", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;

    await client.query("BEGIN");

    const auction = await getAuctionById(client, auctionId);
    if (!auction) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Auction session not found." });
    }

    if (auction.status !== "PAUSED") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: `Cannot resume. Auction status is ${auction.status}.` });
    }

    let livePlayerInfo = null;
    let timeRemainingSeconds = null;

    if (auction.current_live_session_player_id) {
      const now = new Date();
      const bidTimerSeconds = auction.bid_timer_seconds || 30;
      const endsAt = new Date(now.getTime() + bidTimerSeconds * 1000);

      await client.query(
        `
        UPDATE auction_sessions
        SET
          status = 'RUNNING',
          current_round_started_at = $2,
          current_round_ends_at = $3,
          updated_at = NOW()
        WHERE auction_id = $1
      `,
        [auctionId, now, endsAt]
      );

      await client.query(
        `
        UPDATE auction_session_players
        SET
          live_started_at = $2,
          live_ends_at = $3,
          updated_at = NOW()
        WHERE session_player_id = $1
      `,
        [auction.current_live_session_player_id, now, endsAt]
      );

      const pRes = await client.query(
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
      livePlayerInfo = pRes.rows[0] || null;
      timeRemainingSeconds = Math.max(
        0,
        Math.floor((endsAt.getTime() - Date.now()) / 1000)
      );
    } else {
      await client.query(
        `
        UPDATE auction_sessions
        SET status = 'RUNNING', updated_at = NOW()
        WHERE auction_id = $1
      `,
        [auctionId]
      );
    }

    await client.query("COMMIT");

    return res.json({
      message: "Auction resumed.",
      auctionId,
      status: "RUNNING",
      livePlayer: livePlayerInfo
        ? { ...livePlayerInfo, timeRemainingSeconds }
        : null,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error resuming auction:", err);
    return res.status(500).json({ error: "Failed to resume auction." });
  } finally {
    client.release();
  }
});

/**
 * POST /api/auction/sessions/:auctionId/end
 */
router.post("/sessions/:auctionId/end", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;

    await client.query("BEGIN");

    const auction = await getAuctionById(client, auctionId);
    if (!auction) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Auction session not found." });
    }

    if (auction.current_live_session_player_id) {
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
        [auction.current_live_session_player_id]
      );
    }

    await client.query(
      `
      UPDATE auction_sessions
      SET
        status = 'ENDED',
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
      message: "Auction ended.",
      auctionId,
      status: "ENDED",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error ending auction:", err);
    return res.status(500).json({ error: "Failed to end auction." });
  } finally {
    client.release();
  }
});

/**
 * POST /api/auction/sessions/:auctionId/participants/end
 */
router.post("/sessions/:auctionId/participants/end", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    const { userId } = req.body || {};

    if (!auctionId || !userId) {
      return res
        .status(400)
        .json({ error: "auctionId and userId are required." });
    }

    await client.query("BEGIN");

    const auction = await getAuctionById(client, auctionId);
    if (!auction) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Auction session not found." });
    }

    const partRes = await client.query(
      `
      SELECT participant_id, status
      FROM auction_participants
      WHERE auction_id = $1 AND user_id = $2
    `,
      [auctionId, userId]
    );
    const participant = partRes.rows[0];
    if (!participant) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "Participant not found in this auction." });
    }

    if (
      participant.status === "COMPLETED" ||
      participant.status === "EXITED"
    ) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Participant is already ${participant.status}.`,
      });
    }

    const squadRes = await client.query(
      `
      SELECT COUNT(*)::int AS squad_size
      FROM auction_squad_players
      WHERE auction_id = $1 AND user_id = $2
    `,
      [auctionId, userId]
    );
    const squadSize = squadRes.rows[0]?.squad_size || 0;

    if (squadSize < auction.min_exit_squad_size) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `You need at least ${auction.min_exit_squad_size} players to end your auction.`,
      });
    }

    await client.query(
      `
      UPDATE auction_participants
      SET status = 'EXITED',
          is_active = FALSE,
          updated_at = NOW()
      WHERE auction_id = $1 AND user_id = $2
    `,
      [auctionId, userId]
    );

    // Maybe auto-end if no ACTIVE participants left
    const autoEnded = await maybeAutoEndAuction(client, auctionId);

    await client.query("COMMIT");

    return res.json({
      message: "You have exited the auction.",
      auctionId,
      userId,
      status: "EXITED",
      squadSize,
      autoEnded,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error exiting participant from auction:", err);
    return res
      .status(500)
      .json({ error: "Failed to exit auction for this user." });
  } finally {
    client.release();
  }
});

// =====================================================================
// PHASE 4 – ADMIN PUSH RULES (skill/category/count)
// =====================================================================

/**
 * POST /api/auction/sessions/:auctionId/push-rules
 * Body:
 * {
 *   "skillType": "Allrounder",   // optional
 *   "category": "Legend",        // optional
 *   "count": 5,
 *   "priority": 1                // optional; if omitted, appends after existing
 * }
 */
router.post("/sessions/:auctionId/push-rules", async (req, res) => {
  const client = await pool.connect();
  try {
    const { auctionId } = req.params;
    let { skillType, category, count, priority } = req.body || {};

    if (!auctionId) {
      return res.status(400).json({ error: "auctionId is required." });
    }

    const auction = await getAuctionById(client, auctionId);
    if (!auction) {
      return res.status(404).json({ error: "Auction session not found." });
    }

    const nCount = parseInt(count, 10);
    if (!Number.isFinite(nCount) || nCount <= 0) {
      return res
        .status(400)
        .json({ error: "count must be a positive integer." });
    }

    if (skillType && !VALID_SKILLS.includes(skillType)) {
      return res
        .status(400)
        .json({ error: `Invalid skillType: ${skillType}` });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return res
        .status(400)
        .json({ error: `Invalid category: ${category}` });
    }

    await client.query("BEGIN");

    if (priority == null) {
      const pRes = await client.query(
        `
        SELECT COALESCE(MAX(priority), 0) + 1 AS next_priority
        FROM auction_push_rules
        WHERE auction_id = $1
      `,
        [auctionId]
      );
      priority = pRes.rows[0].next_priority || 1;
    }

    const ins = await client.query(
      `
      INSERT INTO auction_push_rules
        (auction_id, skill_type, category, remaining_count, priority, is_active, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
      RETURNING rule_id, auction_id, skill_type, category, remaining_count, priority, is_active, created_at
    `,
      [auctionId, skillType || null, category || null, nCount, priority]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Push rule created.",
      rule: ins.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creating push rule:", err);
    return res.status(500).json({ error: "Failed to create push rule." });
  } finally {
    client.release();
  }
});

/**
 * GET /api/auction/sessions/:auctionId/push-rules
 */
router.get("/sessions/:auctionId/push-rules", async (req, res) => {
  try {
    const { auctionId } = req.params;
    if (!auctionId) {
      return res.status(400).json({ error: "auctionId is required." });
    }

    const rulesRes = await pool.query(
      `
      SELECT
        rule_id AS "ruleId",
        auction_id AS "auctionId",
        skill_type AS "skillType",
        category,
        remaining_count AS "remainingCount",
        priority,
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM auction_push_rules
      WHERE auction_id = $1
      ORDER BY priority ASC, created_at ASC
    `,
      [auctionId]
    );

    return res.json(rulesRes.rows);
  } catch (err) {
    console.error("Error listing push rules:", err);
    return res.status(500).json({ error: "Failed to fetch push rules." });
  }
});

/**
 * PATCH /api/auction/push-rules/:ruleId
 * Body (any subset):
 * {
 *   "isActive": false,
 *   "remainingCount": 0,
 *   "priority": 3
 * }
 */
router.patch("/push-rules/:ruleId", async (req, res) => {
  const client = await pool.connect();
  try {
    const { ruleId } = req.params;
    const { isActive, remainingCount, priority } = req.body || {};

    if (!ruleId) {
      return res.status(400).json({ error: "ruleId is required." });
    }

    const sets = [];
    const params = [];
    let idx = 1;

    if (typeof isActive === "boolean") {
      sets.push(`is_active = $${idx++}`);
      params.push(isActive);
    }

    if (remainingCount != null) {
      const nCount = parseInt(remainingCount, 10);
      if (!Number.isFinite(nCount) || nCount < 0) {
        return res
          .status(400)
          .json({ error: "remainingCount must be >= 0." });
      }
      sets.push(`remaining_count = $${idx++}`);
      params.push(nCount);
    }

    if (priority != null) {
      const pVal = parseInt(priority, 10);
      if (!Number.isFinite(pVal) || pVal <= 0) {
        return res.status(400).json({ error: "priority must be > 0." });
      }
      sets.push(`priority = $${idx++}`);
      params.push(pVal);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "No updatable fields provided." });
    }

    sets.push(`updated_at = NOW()`);

    params.push(ruleId);

    await client.query("BEGIN");

    const upd = await client.query(
      `
      UPDATE auction_push_rules
      SET ${sets.join(", ")}
      WHERE rule_id = $${idx}
      RETURNING rule_id AS "ruleId", auction_id AS "auctionId", skill_type AS "skillType",
                category, remaining_count AS "remainingCount", priority, is_active AS "isActive",
                created_at AS "createdAt", updated_at AS "updatedAt"
    `,
      params
    );

    await client.query("COMMIT");

    if (upd.rowCount === 0) {
      return res.status(404).json({ error: "Push rule not found." });
    }

    return res.json({
      message: "Push rule updated.",
      rule: upd.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating push rule:", err);
    return res.status(500).json({ error: "Failed to update push rule." });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/auction/push-rules/:ruleId
 */
router.delete("/push-rules/:ruleId", async (req, res) => {
  try {
    const { ruleId } = req.params;
    if (!ruleId) {
      return res.status(400).json({ error: "ruleId is required." });
    }

    const del = await pool.query(
      `
      DELETE FROM auction_push_rules
      WHERE rule_id = $1
    `,
      [ruleId]
    );

    if (del.rowCount === 0) {
      return res.status(404).json({ error: "Push rule not found." });
    }

    return res.json({ message: "Push rule deleted.", ruleId });
  } catch (err) {
    console.error("Error deleting push rule:", err);
    return res.status(500).json({ error: "Failed to delete push rule." });
  }
});

/**
 * GET /api/auction/sessions/:auctionId/my-players
 * Query: userId
 *
 * Returns:
 *  - auction info (name, max squad)
 *  - wallet (initial, current, spent)
 *  - squadSize
 *  - players[] (list of purchased players for this user)
 */
router.get("/sessions/:auctionId/my-players", async (req, res) => {
  try {
    const { auctionId } = req.params;
    const { userId } = req.query;

    if (!auctionId) {
      return res.status(400).json({ error: "auctionId is required." });
    }
    if (!userId) {
      return res
        .status(400)
        .json({ error: "userId is required in query." });
    }

    const auction = await getAuctionById(pool, auctionId);
    if (!auction) {
      return res.status(404).json({ error: "Auction session not found." });
    }

    // Wallet
    const walletRes = await pool.query(
      `
      SELECT initial_amount, current_balance, status
      FROM auction_wallets
      WHERE auction_id = $1 AND user_id = $2
    `,
      [auctionId, userId]
    );
    const wallet = walletRes.rows[0];

    if (!wallet) {
      return res.status(404).json({
        error:
          "Wallet not found for this user in this auction. Have you joined?",
      });
    }

    // Squad players
    const playersRes = await pool.query(
      `
      SELECT
        asp.squad_player_id       AS "squadPlayerId",
        asp.purchase_price        AS "purchasePrice",
        asp.skill_type            AS "skillType",
        asp.category              AS "category",
        asp.created_at            AS "createdAt",
        pp.player_name            AS "playerName",
        pp.country,
        pp.skill_type             AS "playerSkillType",
        pp.category               AS "playerCategory",
        pp.base_bid_amount        AS "baseBidAmount"
      FROM auction_squad_players asp
      JOIN auction_session_players sp
        ON sp.session_player_id = asp.session_player_id
      JOIN auction_player_pool pp
        ON pp.pool_player_id = sp.pool_player_id
      WHERE asp.auction_id = $1
        AND asp.user_id = $2
      ORDER BY asp.created_at ASC
    `,
      [auctionId, userId]
    );

    const squadSize = playersRes.rowCount;
    const initialAmount = Number(wallet.initial_amount);
    const currentBalance = Number(wallet.current_balance);
    const spent = Number((initialAmount - currentBalance).toFixed(2));

    return res.json({
      auction: {
        auctionId: auction.auction_id,
        name: auction.name,
        maxSquadSize: auction.max_squad_size,
        minExitSquadSize: auction.min_exit_squad_size,
      },
      wallet: {
        initialAmount,
        currentBalance,
        spent,
        status: wallet.status,
      },
      squadSize,
      players: playersRes.rows,
    });
  } catch (err) {
    console.error("Error fetching my players:", err);
    return res.status(500).json({ error: "Failed to fetch my players." });
  }
});

/**
 * GET /api/auction/sessions/:auctionId/participants
 *
 * Returns per-user:
 *  - userId, roleInAuction, status, isActive
 *  - walletInitial, walletBalance, walletSpent
 *  - squadSize
 */
router.get("/sessions/:auctionId/participants", async (req, res) => {
  try {
    const { auctionId } = req.params;

    if (!auctionId) {
      return res.status(400).json({ error: "auctionId is required." });
    }

    const auction = await getAuctionById(pool, auctionId);
    if (!auction) {
      return res.status(404).json({ error: "Auction session not found." });
    }

    const result = await pool.query(
      `
      SELECT
        p.user_id                         AS "userId",
        p.role_in_auction                 AS "roleInAuction",
        p.status                          AS "status",
        p.is_active                       AS "isActive",
        COALESCE(w.initial_amount, 0)     AS "walletInitial",
        COALESCE(w.current_balance, 0)    AS "walletBalance",
        COALESCE(w.initial_amount, 0) - COALESCE(w.current_balance, 0)
                                          AS "walletSpent",
        COALESCE(s.squad_size, 0)         AS "squadSize"
      FROM auction_participants p
      LEFT JOIN auction_wallets w
        ON w.auction_id = p.auction_id
       AND w.user_id = p.user_id
      LEFT JOIN (
        SELECT
          auction_id,
          user_id,
          COUNT(*)::int AS squad_size
        FROM auction_squad_players
        GROUP BY auction_id, user_id
      ) s
        ON s.auction_id = p.auction_id
       AND s.user_id = p.user_id
      WHERE p.auction_id = $1
      ORDER BY
        CASE WHEN p.role_in_auction = 'ADMIN' THEN 0 ELSE 1 END,
        p.status,
        p.user_id
    `,
      [auctionId]
    );

    return res.json({
      auction: {
        auctionId: auction.auction_id,
        name: auction.name,
        status: auction.status,
        maxSquadSize: auction.max_squad_size,
        minExitSquadSize: auction.min_exit_squad_size,
      },
      participants: result.rows,
    });
  } catch (err) {
    console.error("Error fetching auction participants:", err);
    return res.status(500).json({ error: "Failed to fetch participants." });
  }
});

/**
 * GET /api/auction/sessions/:auctionId/summary
 *
 * High-level report for a finished (or in-progress) auction:
 *  - auction info
 *  - player status counts (SOLD / UNSOLD / PENDING / RECLAIMED)
 *  - participant counts (ACTIVE / COMPLETED / EXITED)
 *  - top spenders (by walletSpent)
 *  - list of SOLD players (name, category, skill, buyer, amount)
 */
router.get("/sessions/:auctionId/summary", async (req, res) => {
  try {
    const { auctionId } = req.params;

    if (!auctionId) {
      return res.status(400).json({ error: "auctionId is required." });
    }

    const auction = await getAuctionById(pool, auctionId);
    if (!auction) {
      return res.status(404).json({ error: "Auction session not found." });
    }

    // --- players status counts ---
    const playersCountRes = await pool.query(
      `
      SELECT status, COUNT(*)::int AS cnt
      FROM auction_session_players
      WHERE auction_id = $1
      GROUP BY status
    `,
      [auctionId]
    );

    const playerCounts = {
      totalPlayers: 0,
      sold: 0,
      unsold: 0,
      pending: 0,
      reclaimed: 0,
    };

    playersCountRes.rows.forEach((r) => {
      const status = r.status;
      const cnt = r.cnt;
      playerCounts.totalPlayers += cnt;
      if (status === "SOLD") playerCounts.sold = cnt;
      else if (status === "UNSOLD") playerCounts.unsold = cnt;
      else if (status === "PENDING") playerCounts.pending = cnt;
      else if (status === "RECLAIMED") playerCounts.reclaimed = cnt;
    });

    // --- participants counts + top spenders ---
    const participantsRes = await pool.query(
      `
      SELECT
        p.user_id                         AS "userId",
        p.role_in_auction                 AS "roleInAuction",
        p.status                          AS "status",
        p.is_active                       AS "isActive",
        COALESCE(w.initial_amount, 0)     AS "walletInitial",
        COALESCE(w.current_balance, 0)    AS "walletBalance",
        COALESCE(w.initial_amount, 0) - COALESCE(w.current_balance, 0)
                                          AS "walletSpent",
        COALESCE(s.squad_size, 0)         AS "squadSize"
      FROM auction_participants p
      LEFT JOIN auction_wallets w
        ON w.auction_id = p.auction_id
       AND w.user_id = p.user_id
      LEFT JOIN (
        SELECT
          auction_id,
          user_id,
          COUNT(*)::int AS squad_size
        FROM auction_squad_players
        GROUP BY auction_id, user_id
      ) s
        ON s.auction_id = p.auction_id
       AND s.user_id = p.user_id
      WHERE p.auction_id = $1
      ORDER BY
        CASE WHEN p.role_in_auction = 'ADMIN' THEN 0 ELSE 1 END,
        p.user_id
    `,
      [auctionId]
    );

    const participants = participantsRes.rows;

    const participantCounts = {
      totalParticipants: participants.length,
      active: 0,
      completed: 0,
      exited: 0,
    };

    participants.forEach((p) => {
      if (p.status === "ACTIVE") participantCounts.active++;
      else if (p.status === "COMPLETED") participantCounts.completed++;
      else if (p.status === "EXITED") participantCounts.exited++;
    });

    // Top 5 spenders (participants only, ignore ADMIN rows)
    const topSpenders = [...participants]
      .filter((p) => p.roleInAuction === "PARTICIPANT")
      .sort((a, b) => Number(b.walletSpent) - Number(a.walletSpent))
      .slice(0, 5);

    // --- SOLD players list ---
    const soldPlayersRes = await pool.query(
      `
      SELECT
        sp.session_player_id               AS "sessionPlayerId",
        sp.final_bid_amount                AS "finalBidAmount",
        sp.sold_to_user_id                 AS "soldToUserId",
        pp.player_name                     AS "playerName",
        pp.country,
        pp.skill_type                      AS "skillType",
        pp.category,
        pp.base_bid_amount                 AS "baseBidAmount"
      FROM auction_session_players sp
      JOIN auction_player_pool pp
        ON pp.pool_player_id = sp.pool_player_id
      WHERE sp.auction_id = $1
        AND sp.status = 'SOLD'
      ORDER BY sp.updated_at ASC
    `,
      [auctionId]
    );

    const soldPlayers = soldPlayersRes.rows.map((r) => ({
      sessionPlayerId: r.sessionPlayerId,
      playerName: r.playerName,
      country: r.country,
      skillType: r.skillType,
      category: r.category,
      baseBidAmount: Number(r.baseBidAmount),
      finalBidAmount: r.finalBidAmount != null ? Number(r.finalBidAmount) : null,
      soldToUserId: r.soldToUserId,
    }));

    // "Ended at" – we don't have a dedicated column, so use updated_at when ENDED
    const endedAt =
      auction.status === "ENDED" ? auction.updated_at || null : null;

    return res.json({
      auction: {
        auctionId: auction.auction_id,
        name: auction.name,
        status: auction.status,
        createdAt: auction.created_at || null,
        endedAt,
        maxSquadSize: auction.max_squad_size,
        minExitSquadSize: auction.min_exit_squad_size,
        initialWalletAmount: Number(auction.initial_wallet_amount),
      },
      playerCounts,
      participantCounts,
      topSpenders,
      soldPlayers,
    });
  } catch (err) {
    console.error("Error fetching auction summary:", err);
    return res.status(500).json({ error: "Failed to fetch auction summary." });
  }
});

module.exports = router;
