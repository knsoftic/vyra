/**
 * The ledger — the only code in this project permitted to change a balance.
 *
 * Rules made structural here rather than left to convention:
 *
 *  1. A movement locks the wallet row before reading it, so two concurrent
 *     writes cannot both read the same balance and overdraw (ADR-013).
 *  2. Balance and ledger row are written in one transaction. There is no code
 *     path that updates one without the other.
 *  3. Every entry names its wallet. `credit`/`debit` cannot be called without
 *     one, so no movement is ambiguous about which of the four it touched.
 *  4. Only `withdrawable` funds a payout, and only `live_gift` matures into it.
 *     `reward` converts one way into `coin`. Nothing else converts (ADR-018).
 *  5. Debits refuse to go negative. The transaction fails; it does not clamp.
 */

import type { PoolConnection } from 'mysql2/promise';
import { ulid } from 'ulid';
import { query, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { getSetting } from '../../core/settings.ts';
import { logger } from '../../core/logger.ts';
import {
  ALLOWED_CONVERSIONS,
  PAYABLE_WALLET,
  type TransactionType,
  type WalletBalances,
  type WalletKind,
} from '../../../../shared/contracts/money.ts';

/** Column on `wallets` backing each logical balance. */
const BALANCE_COLUMN: Record<WalletKind, string> = {
  coin: 'coin_balance',
  reward: 'reward_balance',
  live_gift: 'live_gift_balance',
  withdrawable: 'withdrawable_amount',
};

interface WalletRow extends Record<string, unknown> {
  user_id: number;
  coin_balance: string | number;
  reward_balance: string | number;
  live_gift_balance: string | number;
  withdrawable_amount: string | number;
  pending_reward: string | number;
  pending_withdrawal: string | number;
  total_earned: string | number;
  is_frozen: number;
  frozen_reason: string | null;
}

const num = (v: string | number): number => (typeof v === 'number' ? v : Number(v));

export interface MovementInput {
  userId: number;
  wallet: WalletKind;
  type: TransactionType;
  /** Always positive. Direction comes from calling `credit` or `debit`. */
  amount: number;
  description: string;
  reference?: string;
  fiatAmount?: number;
  fiatCurrency?: string;
  relatedUserId?: number;
  adminId?: number;
  reason?: string;
  idempotencyKey?: string;
  status?: 'successful' | 'pending';
}

export interface MovementResult {
  ledgerId: number;
  publicId: string;
  balanceBefore: number;
  balanceAfter: number;
}

/**
 * Locks and returns the wallet row, creating it on first use. Callers must
 * already be inside a transaction — the lock is meaningless otherwise.
 */
async function lockWallet(tx: PoolConnection, userId: number): Promise<WalletRow> {
  const existing = await query<WalletRow>(
    'SELECT * FROM wallets WHERE user_id = ? FOR UPDATE',
    [userId],
    tx,
  );
  if (existing[0]) return existing[0];

  await execute('INSERT IGNORE INTO wallets (user_id) VALUES (?)', [userId], tx);

  const created = await query<WalletRow>(
    'SELECT * FROM wallets WHERE user_id = ? FOR UPDATE',
    [userId],
    tx,
  );
  if (!created[0]) throw new AppError('internal_error', 'Wallet could not be created.');
  return created[0];
}

function assertNotFrozen(row: WalletRow, type: TransactionType): void {
  // A frozen wallet still accepts corrections and reversals — freezing stops the
  // user spending, it does not stop an admin putting things right.
  const alwaysAllowed: TransactionType[] = ['reversal', 'admin_credit', 'refund'];
  if (row.is_frozen === 1 && !alwaysAllowed.includes(type)) {
    throw new AppError('wallet_frozen', row.frozen_reason ?? 'This wallet is temporarily frozen.');
  }
}

async function record(
  tx: PoolConnection,
  input: MovementInput,
  signedAmount: number,
): Promise<MovementResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new AppError('bad_request', 'Amount must be a positive number.');
  }

  const row = await lockWallet(tx, input.userId);
  assertNotFrozen(row, input.type);

  const column = BALANCE_COLUMN[input.wallet];
  const before = num(row[column] as string | number);
  const after = Number((before + signedAmount).toFixed(2));

  if (after < 0) {
    throw new AppError(
      'insufficient_balance',
      `Not enough balance. Available ${before}, required ${Math.abs(signedAmount)}.`,
    );
  }

  const publicId = ulid();
  const result = await execute(
    `INSERT INTO wallet_ledger
       (public_id, user_id, wallet, entry_type, description, amount,
        balance_before, balance_after, status, reference, fiat_amount,
        fiat_currency, idempotency_key, related_user_id, admin_id, reason)
     VALUES
       (:publicId, :userId, :wallet, :type, :description, :amount,
        :before, :after, :status, :reference, :fiatAmount,
        :fiatCurrency, :idempotencyKey, :relatedUserId, :adminId, :reason)`,
    {
      publicId,
      userId: input.userId,
      wallet: input.wallet,
      type: input.type,
      description: input.description,
      amount: signedAmount,
      before,
      after,
      status: input.status ?? 'successful',
      reference: input.reference ?? null,
      fiatAmount: input.fiatAmount ?? null,
      fiatCurrency: input.fiatCurrency ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      relatedUserId: input.relatedUserId ?? null,
      adminId: input.adminId ?? null,
      reason: input.reason ?? null,
    },
    tx,
  );

  // total_earned tracks lifetime inbound value for the creator dashboard; it is
  // never spent from and never decreases.
  const earnedTypes: TransactionType[] = [
    'gift_received',
    'task_reward',
    'referral_reward',
    'milestone_reward',
  ];
  const bumpEarned = signedAmount > 0 && earnedTypes.includes(input.type);

  await execute(
    `UPDATE wallets
        SET \`${column}\` = :after${bumpEarned ? ', total_earned = total_earned + :earned' : ''}
      WHERE user_id = :userId`,
    bumpEarned
      ? { after, earned: Math.round(input.amount), userId: input.userId }
      : { after, userId: input.userId },
    tx,
  );

  return { ledgerId: result.insertId, publicId, balanceBefore: before, balanceAfter: after };
}

/** Adds value to a balance. */
export const credit = (tx: PoolConnection, input: MovementInput): Promise<MovementResult> =>
  record(tx, input, Math.abs(input.amount));

/** Removes value from a balance. Throws `insufficient_balance` rather than clamping. */
export const debit = (tx: PoolConnection, input: MovementInput): Promise<MovementResult> =>
  record(tx, input, -Math.abs(input.amount));

/**
 * Moves value between two of the caller's own balances. Rejects any pair not in
 * ALLOWED_CONVERSIONS, which is what stops task rewards becoming cash.
 */
export async function convert(
  tx: PoolConnection,
  opts: {
    userId: number;
    from: WalletKind;
    to: WalletKind;
    amount: number;
    /** Units of `to` produced by one unit of `from`. */
    rate: number;
    type: TransactionType;
    description: string;
    idempotencyKey?: string;
  },
): Promise<{ debited: MovementResult; credited: MovementResult; produced: number }> {
  const permitted = ALLOWED_CONVERSIONS.some((c) => c.from === opts.from && c.to === opts.to);
  if (!permitted) {
    throw new AppError(
      'invalid_state_transition',
      `${opts.from} cannot be converted into ${opts.to}.`,
    );
  }

  const produced = Number((opts.amount * opts.rate).toFixed(2));
  if (produced <= 0) {
    throw new AppError('below_minimum_amount', 'That amount converts to nothing.');
  }

  const debited = await debit(tx, {
    userId: opts.userId,
    wallet: opts.from,
    type: opts.type,
    amount: opts.amount,
    description: opts.description,
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
  });

  const credited = await credit(tx, {
    userId: opts.userId,
    wallet: opts.to,
    type: opts.type,
    amount: produced,
    description: opts.description,
    reference: debited.publicId,
  });

  return { debited, credited, produced };
}

/** Guard for the payout path: refuses any wallet other than `withdrawable`. */
export function assertPayable(wallet: WalletKind): void {
  if (wallet !== PAYABLE_WALLET) {
    throw new AppError(
      'wallet_not_payable',
      'Only cleared live gift earnings can be withdrawn. Coins and reward balance are spendable in-app only.',
    );
  }
}

export async function getBalances(userId: number, payoutCurrency = 'USD'): Promise<WalletBalances> {
  const coinToPayoutRate = Number(await getSetting('monetization.coin_to_payout_rate')) || 0;
  const rows = await query<WalletRow>('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  const row = rows[0];
  if (!row) {
    return {
      coin: 0,
      reward: 0,
      liveGift: 0,
      withdrawable: 0,
      payoutCurrency,
      coinToPayoutRate,
      pendingReward: 0,
      pendingWithdrawal: 0,
      totalEarned: 0,
      isFrozen: false,
    };
  }
  return {
    coin: num(row.coin_balance),
    reward: num(row.reward_balance),
    liveGift: num(row.live_gift_balance),
    withdrawable: num(row.withdrawable_amount),
    payoutCurrency,
    coinToPayoutRate,
    pendingReward: num(row.pending_reward),
    pendingWithdrawal: num(row.pending_withdrawal),
    totalEarned: num(row.total_earned),
    isFrozen: row.is_frozen === 1,
    ...(row.frozen_reason ? { frozenReason: row.frozen_reason } : {}),
  };
}

/**
 * Recomputes each balance from the ledger and compares it with the stored value.
 * Run on a schedule. A mismatch means a bug, so it is reported rather than
 * silently repaired — overwriting the balance would destroy the evidence.
 */
export async function reconcile(userId: number): Promise<{
  ok: boolean;
  drift: Partial<Record<WalletKind, { stored: number; derived: number }>>;
}> {
  return transaction(async (tx) => {
    const row = await lockWallet(tx, userId);
    const sums = await query<{ wallet: WalletKind; total: string }>(
      `SELECT wallet, COALESCE(SUM(amount), 0) AS total
         FROM wallet_ledger
        WHERE user_id = ? AND status IN ('successful', 'approved')
        GROUP BY wallet`,
      [userId],
      tx,
    );

    const derived: Partial<Record<WalletKind, number>> = {};
    for (const s of sums) derived[s.wallet] = Number(Number(s.total).toFixed(2));

    const drift: Partial<Record<WalletKind, { stored: number; derived: number }>> = {};
    for (const wallet of Object.keys(BALANCE_COLUMN) as WalletKind[]) {
      const stored = num(row[BALANCE_COLUMN[wallet]] as string | number);
      const calc = derived[wallet] ?? 0;
      if (Math.abs(stored - calc) > 0.009) drift[wallet] = { stored, derived: calc };
    }

    const ok = Object.keys(drift).length === 0;
    if (!ok) logger.error({ userId, drift }, 'wallet reconciliation drift detected');

    await execute('UPDATE wallets SET last_reconciled_at = NOW(3) WHERE user_id = ?', [userId], tx);
    return { ok, drift };
  });
}
