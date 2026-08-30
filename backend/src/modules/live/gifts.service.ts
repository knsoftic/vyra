/**
 * Gifting.
 *
 * A gift moves real value, so this is the most consequential code in the phase
 * and it is written accordingly.
 *
 * **One transaction, four writes.** The sender's coin debit, the creator's
 * credit, the gift record and the clearing row all commit together or none of
 * them do. A gift that took someone's coins without crediting the creator is not
 * a bug you can fix from a log file.
 *
 * **The platform share is configuration, not a constant.** `gift_platform_share`
 * is read per transaction and stored on the row, so a creator can be shown what
 * split applied to *their* gift rather than whatever the setting says today.
 *
 * **Money does not clear immediately.** A gift bought with a stolen card is
 * charged back days later. `gift_clearing` holds the creator's share for a
 * configurable period before it becomes withdrawable, which is the difference
 * between a reversal and a loss.
 *
 * **Nothing here creates engagement.** A gift is value moving between two
 * people. It does not like, follow, comment or boost — the standing rule that
 * paid actions never manufacture engagement applies here as much as to ads.
 */

import { ulid } from 'ulid';
import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { getSetting } from '../../core/settings.ts';
import { logger } from '../../core/logger.ts';
import * as ledger from '../wallet/ledger.ts';
import * as social from '../social/social.service.ts';
import type { Gift } from '../../../../shared/contracts/money.ts';

interface GiftRow {
  id: number;
  slug: string;
  name: string;
  icon: string;
  animation_key: string | null;
  coins: string | number;
  is_featured: number;
}

function toGift(row: GiftRow): Gift {
  const gift: Gift = {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    icon: row.icon,
    coins: Number(row.coins),
    isFeatured: row.is_featured === 1,
  };
  if (row.animation_key) gift.animationUrl = row.animation_key;
  return gift;
}

/** The catalogue, admin-editable like every other list in the product. */
export async function listGifts(): Promise<Gift[]> {
  const rows = await query<GiftRow>(
    `SELECT id, slug, name, icon, animation_key, coins, is_featured
       FROM gifts
      WHERE is_active = 1
      ORDER BY sort_order, coins`,
  );
  return rows.map(toGift);
}

export interface SendGiftInput {
  senderId: number;
  giftId: string;
  recipientPublicId: string;
  streamPublicId?: string;
  quantity: number;
  idempotencyKey: string;
}

export interface SendGiftResult {
  id: string;
  gift: Gift;
  quantity: number;
  coinsSpent: number;
  coinsToCreator: number;
  platformSharePercent: number;
  senderBalance: number;
  clearsAt: string;
  /** True when this was a replay of a send that had already been accepted. */
  duplicate: boolean;
  recipientId: number;
  streamId: number | null;
}

/**
 * Sends a gift.
 *
 * The order of checks matters and is deliberate: everything that can refuse the
 * request is done before any money moves, so a refusal never leaves a partial
 * movement behind.
 */
export async function sendGift(input: SendGiftInput): Promise<SendGiftResult> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999) {
    throw new AppError('bad_request', 'Quantity must be between 1 and 999.');
  }

  // A retry that reached us after the first attempt committed. Recognised from
  // the database rather than a cache, so it holds when Redis is unavailable —
  // which is exactly when a client retries (ADR-032).
  const replay = await findExisting(input.senderId, input.idempotencyKey);
  if (replay) return replay;

  const gift = await queryOne<GiftRow>(
    'SELECT id, slug, name, icon, animation_key, coins, is_featured FROM gifts WHERE id = :id AND is_active = 1',
    { id: Number(input.giftId) },
  );
  if (!gift) throw new AppError('not_found', 'That gift is not available.');

  const recipient = await queryOne<{ id: number }>(
    `SELECT id FROM users
      WHERE public_id = :publicId AND deleted_at IS NULL AND status = 'active'`,
    { publicId: input.recipientPublicId },
  );
  if (!recipient) throw new AppError('not_found', 'Account not found.');

  if (recipient.id === input.senderId) {
    // Gifting yourself would convert coins into withdrawable balance, which is
    // a cash-out route around the payout rules rather than a gift.
    throw new AppError('bad_request', 'You cannot send a gift to yourself.');
  }

  if (await social.isBlockedEitherWay(input.senderId, recipient.id)) {
    throw new AppError('not_found', 'Account not found.');
  }

  let streamId: number | null = null;
  if (input.streamPublicId) {
    const stream = await queryOne<{ id: number; host_id: number; allow_gifts: number; status: string }>(
      'SELECT id, host_id, allow_gifts, status FROM live_streams WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: input.streamPublicId },
    );
    if (!stream) throw new AppError('not_found', 'That stream is not available.');
    if (stream.status !== 'live') {
      throw new AppError('bad_request', 'That stream has ended.');
    }
    if (Number(stream.allow_gifts) === 0) {
      throw new AppError('forbidden', 'This stream is not accepting gifts.');
    }
    if (stream.host_id !== recipient.id) {
      // The recipient must be the host: otherwise a gift could be attributed to
      // a stream it had nothing to do with, inflating that stream's totals.
      throw new AppError('bad_request', 'A gift in a stream goes to its host.');
    }
    streamId = stream.id;
  }

  const [shareRaw, clearingDaysRaw, enabled] = await Promise.all([
    getSetting('monetization.gift_platform_share'),
    getSetting('monetization.gift_clearing_days'),
    getSetting('monetization.enabled'),
  ]);

  if (enabled === false) {
    throw new AppError('forbidden', 'Monetization is currently turned off.');
  }

  // A misconfigured share must not silently give the creator nothing, or more
  // than was paid. Out-of-range values are clamped and reported.
  const rawShare = Number(shareRaw);
  const platformShare = Number.isFinite(rawShare) ? Math.min(Math.max(rawShare, 0), 0.9) : 0.5;
  if (platformShare !== rawShare) {
    logger.warn(
      { configured: shareRaw, used: platformShare },
      'gift_platform_share out of range — clamped',
    );
  }

  const clearingDays = Math.max(0, Math.min(Number(clearingDaysRaw) || 0, 90));

  const coinsSpent = Number(gift.coins) * input.quantity;
  // The platform's cut is computed and rounded first, and the creator gets the
  // rest. Taking `spent × (1 - share)` instead loses a coin to binary floating
  // point — 10 × (1 − 0.9) is 0.9999999999999998, which floors to zero — and
  // the creator is the one who pays for that.
  const platformCut = Math.ceil(coinsSpent * platformShare);
  const coinsToCreator = Math.max(0, coinsSpent - platformCut);

  const publicId = ulid();
  const clearsAt = new Date(Date.now() + clearingDays * 24 * 60 * 60 * 1000);

  let senderBalance = 0;

  try {
    await transaction(async (tx) => {
      // Sender first: if they cannot pay, nothing else should have happened.
      const debit = await ledger.debit(tx, {
        userId: input.senderId,
        wallet: 'coin',
        type: 'gift_sent',
        amount: coinsSpent,
        description: `${input.quantity}× ${gift.name}`,
        relatedUserId: recipient.id,
        // The two ledger rows cannot share one key: the column is globally
        // unique. The suffix keeps both protected and both traceable.
        idempotencyKey: `${input.idempotencyKey}:send`,
        ...(streamId ? { reference: input.streamPublicId } : {}),
      });
      senderBalance = debit.balanceAfter;

      /**
       * A creator share that rounds to nothing writes no credit row.
       *
       * The ledger refuses a zero movement, and rightly: a row recording that
       * nothing happened is noise in an audit trail. But a cheap gift under a
       * high platform share does round to zero — a 10-coin gift at a 90% share
       * leaves 1, and floating-point arithmetic can make that 0 — and the whole
       * gift used to fail with "Amount must be a positive number", which tells
       * the sender nothing about what went wrong.
       *
       * The gift still happens: the sender paid, the transaction is recorded
       * with `coins_to_creator = 0`, and the creator can see exactly that.
       */
      const credit =
        coinsToCreator > 0
          ? await ledger.credit(tx, {
              userId: recipient.id,
              wallet: 'live_gift',
              type: 'gift_received',
              amount: coinsToCreator,
              description: `${input.quantity}× ${gift.name}`,
              relatedUserId: input.senderId,
              idempotencyKey: `${input.idempotencyKey}:recv`,
              ...(streamId ? { reference: input.streamPublicId } : {}),
            })
          : null;

      const giftTx = await execute(
        `INSERT INTO gift_transactions
           (public_id, gift_id, sender_id, recipient_id, stream_id, quantity,
            coins_spent, coins_to_creator, sender_ledger_id, recipient_ledger_id,
            idempotency_key)
         VALUES (:publicId, :giftId, :senderId, :recipientId, :streamId, :quantity,
                 :coinsSpent, :coinsToCreator, :senderLedgerId, :recipientLedgerId,
                 :idempotencyKey)`,
        {
          publicId,
          giftId: gift.id,
          senderId: input.senderId,
          recipientId: recipient.id,
          streamId,
          quantity: input.quantity,
          coinsSpent,
          coinsToCreator,
          senderLedgerId: debit.ledgerId,
          recipientLedgerId: credit?.ledgerId ?? null,
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

      // The creator's share is credited immediately but held: `clears_at` is
      // when it becomes withdrawable. A chargeback before then is a reversal
      // rather than a loss. Nothing to hold means no clearing row.
      if (coinsToCreator > 0) {
        await execute(
          `INSERT INTO gift_clearing (user_id, gift_tx_id, amount, currency, clears_at)
           VALUES (:userId, :giftTxId, :amount, :currency, :clearsAt)`,
          {
            userId: recipient.id,
            giftTxId: giftTx.insertId,
            amount: coinsToCreator,
            currency: 'USD',
            clearsAt,
          },
          tx,
        );
      }

      if (streamId) {
        await execute(
          'UPDATE live_streams SET gift_coins = gift_coins + :coins WHERE id = :id',
          { coins: coinsSpent, id: streamId },
          tx,
        );
      }
    });
  } catch (err) {
    // Two retries arriving together: the second loses the unique key. That is
    // the constraint working, so the original is returned rather than an error
    // the client cannot act on.
    if (isDuplicateKey(err)) {
      const existing = await findExisting(input.senderId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

  return {
    id: publicId,
    gift: toGift(gift),
    quantity: input.quantity,
    coinsSpent,
    coinsToCreator,
    platformSharePercent: Math.round(platformShare * 100),
    senderBalance,
    clearsAt: clearsAt.toISOString(),
    duplicate: false,
    recipientId: recipient.id,
    streamId,
  };
}

/** A send this key has already produced, replayed from the database. */
async function findExisting(
  senderId: number,
  idempotencyKey: string,
): Promise<SendGiftResult | null> {
  const row = await queryOne<{
    public_id: string;
    quantity: number;
    coins_spent: string | number;
    coins_to_creator: string | number;
    recipient_id: number;
    stream_id: number | null;
    gift_id: number;
    slug: string;
    name: string;
    icon: string;
    animation_key: string | null;
    coins: string | number;
    is_featured: number;
    clears_at: Date | null;
  }>(
    `SELECT t.public_id, t.quantity, t.coins_spent, t.coins_to_creator, t.recipient_id,
            t.stream_id, g.id AS gift_id, g.slug, g.name, g.icon, g.animation_key,
            g.coins, g.is_featured, c.clears_at
       FROM gift_transactions t
       JOIN gifts g ON g.id = t.gift_id
       LEFT JOIN gift_clearing c ON c.gift_tx_id = t.id
      WHERE t.sender_id = :senderId AND t.idempotency_key = :key`,
    { senderId, key: idempotencyKey },
  );
  if (!row) return null;

  const balance = await queryOne<{ coin_balance: string | number }>(
    'SELECT coin_balance FROM wallets WHERE user_id = :id',
    { id: senderId },
  );

  const spent = Number(row.coins_spent);
  const toCreator = Number(row.coins_to_creator);

  return {
    id: row.public_id,
    gift: toGift({
      id: row.gift_id,
      slug: row.slug,
      name: row.name,
      icon: row.icon,
      animation_key: row.animation_key,
      coins: row.coins,
      is_featured: row.is_featured,
    }),
    quantity: row.quantity,
    coinsSpent: spent,
    coinsToCreator: toCreator,
    // Derived from what actually happened, not from today's setting.
    platformSharePercent: spent > 0 ? Math.round(((spent - toCreator) / spent) * 100) : 0,
    senderBalance: Number(balance?.coin_balance ?? 0),
    clearsAt: new Date(row.clears_at ?? Date.now()).toISOString(),
    duplicate: true,
    recipientId: row.recipient_id,
    streamId: row.stream_id,
  };
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

export interface GiftHistoryEntry {
  id: string;
  gift: Gift;
  quantity: number;
  coinsSpent: number;
  coinsToCreator: number;
  direction: 'sent' | 'received';
  counterparty: { id: string; username: string; displayName: string; avatar: string | null };
  createdAt: string;
}


/**
 * Everything the gift-earnings screen shows, in one request.
 *
 * Top gifters and the daily series are aggregated here rather than in the app:
 * the app only ever sees the most recent fifty gifts, so summing those on the
 * device would produce a "top gifter" ranking of the last fifty rows and call
 * it all time.
 *
 * `clearing` is money that has been earned and cannot be withdrawn yet — it is
 * shown separately rather than folded into the available balance, because a
 * number someone cannot actually withdraw should never be presented as one they
 * can.
 */
export interface GiftEarnings {
  days: number;
  /** Already cleared and payable. */
  availableAmount: number;
  /** Earned, still inside the clearing window. */
  clearingAmount: number;
  currency: string;
  coinToPayoutRate: number;

  giftCoinsReceived: number;
  giftsReceived: number;
  giftCoinsSent: number;

  dailyCoins: { day: string; value: number }[];
  topGifters: {
    id: string;
    username: string;
    displayName: string;
    avatar: string | null;
    coins: number;
    gifts: number;
  }[];
}

export async function giftEarnings(userId: number, days = 28): Promise<GiftEarnings> {
  const window = Math.min(Math.max(days, 1), 90);

  const [wallet, clearing, received, sent, daily, gifters, rate, currency] = await Promise.all([
    queryOne<{ withdrawable: string | number }>(
      'SELECT withdrawable_amount AS withdrawable FROM wallets WHERE user_id = :userId',
      { userId },
    ),
    queryOne<{ amount: string | number }>(
      `SELECT COALESCE(SUM(amount),0) AS amount FROM gift_clearing
        WHERE user_id = :userId AND cleared_at IS NULL AND reversed_at IS NULL`,
      { userId },
    ),
    queryOne<{ coins: number; n: number }>(
      `SELECT COALESCE(SUM(coins_to_creator),0) AS coins, COUNT(*) AS n
         FROM gift_transactions WHERE recipient_id = :userId`,
      { userId },
    ),
    queryOne<{ coins: number }>(
      `SELECT COALESCE(SUM(coins_spent),0) AS coins
         FROM gift_transactions WHERE sender_id = :userId`,
      { userId },
    ),
    query<{ day: unknown; value: unknown }>(
      `SELECT DATE(created_at) AS day, COALESCE(SUM(coins_to_creator),0) AS value
         FROM gift_transactions
        WHERE recipient_id = :userId
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL :window DAY)
        GROUP BY DATE(created_at)`,
      { userId, window },
    ),
    query<{
      public_id: string; username: string; display_name: string | null;
      avatar_url: string | null; coins: number; gifts: number;
    }>(
      `SELECT u.public_id, u.username, p.display_name, p.avatar_url,
              COALESCE(SUM(t.coins_spent),0) AS coins, COUNT(*) AS gifts
         FROM gift_transactions t
         JOIN users u ON u.id = t.sender_id AND u.deleted_at IS NULL
         LEFT JOIN user_profiles p ON p.user_id = t.sender_id
        WHERE t.recipient_id = :userId
        GROUP BY u.id, u.public_id, u.username, p.display_name, p.avatar_url
        ORDER BY coins DESC
        LIMIT 10`,
      { userId },
    ),
    getSetting('monetization.coin_to_payout_rate'),
    getSetting('monetization.payout_currency'),
  ]);

  const byDay = new Map(
    daily.map((r) => {
      const d = r.day instanceof Date ? r.day : new Date(String(r.day));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return [key, Number(r.value)];
    }),
  );
  const dailyCoins: { day: string; value: number }[] = [];
  for (let i = window - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dailyCoins.push({ day: key, value: byDay.get(key) ?? 0 });
  }

  return {
    days: window,
    availableAmount: Number(wallet?.withdrawable ?? 0),
    clearingAmount: Number(clearing?.amount ?? 0),
    currency: String(currency),
    coinToPayoutRate: Number(rate),
    giftCoinsReceived: Number(received?.coins ?? 0),
    giftsReceived: Number(received?.n ?? 0),
    giftCoinsSent: Number(sent?.coins ?? 0),
    dailyCoins,
    topGifters: gifters.map((g) => ({
      id: g.public_id,
      username: g.username,
      displayName: g.display_name ?? g.username,
      avatar: g.avatar_url,
      coins: Number(g.coins),
      gifts: Number(g.gifts),
    })),
  };
}

/** What the caller has sent and received. */
export async function giftHistory(userId: number, limit = 50): Promise<GiftHistoryEntry[]> {
  const rows = await query<{
    public_id: string;
    quantity: number;
    coins_spent: string | number;
    coins_to_creator: string | number;
    created_at: Date;
    sender_id: number;
    gift_id: number;
    slug: string;
    name: string;
    icon: string;
    animation_key: string | null;
    coins: string | number;
    is_featured: number;
    other_public_id: string;
    other_username: string;
    other_display_name: string;
    other_avatar: string | null;
  }>(
    `SELECT t.public_id, t.quantity, t.coins_spent, t.coins_to_creator, t.created_at, t.sender_id,
            g.id AS gift_id, g.slug, g.name, g.icon, g.animation_key, g.coins, g.is_featured,
            o.public_id AS other_public_id, o.username AS other_username,
            p.display_name AS other_display_name, p.avatar_url AS other_avatar
       FROM gift_transactions t
       JOIN gifts g ON g.id = t.gift_id
       JOIN users o ON o.id = CASE WHEN t.sender_id = :userId THEN t.recipient_id ELSE t.sender_id END
       JOIN user_profiles p ON p.user_id = o.id
      WHERE t.sender_id = :userId OR t.recipient_id = :userId
      ORDER BY t.created_at DESC
      LIMIT :limit`,
    { userId, limit },
  );

  return rows.map((row) => ({
    id: row.public_id,
    gift: toGift({
      id: row.gift_id,
      slug: row.slug,
      name: row.name,
      icon: row.icon,
      animation_key: row.animation_key,
      coins: row.coins,
      is_featured: row.is_featured,
    }),
    quantity: row.quantity,
    coinsSpent: Number(row.coins_spent),
    coinsToCreator: Number(row.coins_to_creator),
    direction: row.sender_id === userId ? ('sent' as const) : ('received' as const),
    counterparty: {
      id: row.other_public_id,
      username: row.other_username,
      displayName: row.other_display_name,
      avatar: row.other_avatar,
    },
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

/**
 * Releases gift value whose holding period has elapsed.
 *
 * Moves the creator's share from the held `live_gift` balance into the
 * withdrawable one, at the configured coin-to-payout rate. Idempotent by
 * construction: a row is only ever cleared once, and `cleared_at` is the record
 * of that.
 */
export async function releaseCleared(now = new Date()): Promise<{ released: number; rows: number }> {
  const due = await query<{ id: number; user_id: number; amount: string | number }>(
    `SELECT id, user_id, amount FROM gift_clearing
      WHERE cleared_at IS NULL AND reversed_at IS NULL AND clears_at <= :now
      LIMIT 500`,
    { now },
  );
  if (due.length === 0) return { released: 0, rows: 0 };

  const rate = Number(await getSetting('monetization.coin_to_payout_rate')) || 0;
  let released = 0;
  let rows = 0;

  for (const row of due) {
    const coins = Number(row.amount);
    const payout = Number((coins * rate).toFixed(2));

    try {
      await transaction(async (tx) => {
        // Claim the row first. If another worker got there first this updates
        // nothing and the movement is skipped, so value cannot be released twice.
        const claimed = await execute(
          'UPDATE gift_clearing SET cleared_at = :now WHERE id = :id AND cleared_at IS NULL',
          { now, id: row.id },
          tx,
        );
        if (claimed.affectedRows === 0) return;

        await ledger.debit(tx, {
          userId: row.user_id,
          wallet: 'live_gift',
          type: 'clearing',
          amount: coins,
          description: 'Gift value cleared',
          reference: `clearing:${row.id}`,
        });

        if (payout > 0) {
          await ledger.credit(tx, {
            userId: row.user_id,
            wallet: 'withdrawable',
            type: 'clearing',
            amount: payout,
            description: 'Gift value available to withdraw',
            reference: `clearing:${row.id}`,
          });
        }

        released += payout;
        rows += 1;
      });
    } catch (err) {
      // One bad row must not stop the rest of the batch.
      logger.error({ err, clearingId: row.id }, 'gift clearing failed');
    }
  }

  return { released: Number(released.toFixed(2)), rows };
}
