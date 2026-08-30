/**
 * Withdrawals.
 *
 * Money leaving the platform. The rules below are not preferences; each one
 * exists because its absence is a way to lose money.
 *
 * **The balance is debited when the request is made, not when it is paid.**
 * This is the whole design. If the balance stayed until payout, someone could
 * request the same $500 five times before an administrator looked at any of
 * them, and every request would pass its own balance check. Debiting on request
 * makes the second request fail on an empty balance — the request itself is the
 * hold.
 *
 * **A rejection refunds.** The corollary of the above: the money is already out
 * of the balance, so refusing to pay has to put it back, or the user has simply
 * lost it.
 *
 * **Only cleared gift earnings are payable.** Coins and reward balance are
 * spendable in-app and never convertible to cash — otherwise a promotional coin
 * grant becomes a way to print money.
 *
 * **Every transition is claimed with a conditional update.** Two administrators
 * clicking "pay" at the same moment must produce one payment.
 */

import { ulid } from 'ulid';
import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { getSetting } from '../../core/settings.ts';
import { logger } from '../../core/logger.ts';
import * as ledger from './ledger.ts';

export interface PayoutMethodOption {
  id: string;
  slug: string;
  label: string;
  kind: string;
  fieldLabel: string;
  network?: string;
  minAmount: number;
  feePercent: number;
  processingTime: string;
}

export async function listPayoutMethods(): Promise<PayoutMethodOption[]> {
  const rows = await query<{
    id: number;
    slug: string;
    label: string;
    kind: string;
    field_label: string;
    network: string | null;
    min_amount: string | number;
    fee_percent: string | number;
    processing_time: string | null;
  }>(
    `SELECT id, slug, label, kind, field_label, network, min_amount, fee_percent, processing_time
       FROM payout_methods
      WHERE is_enabled = 1
      ORDER BY label`,
  );

  return rows.map((row) => {
    const method: PayoutMethodOption = {
      id: String(row.id),
      slug: row.slug,
      label: row.label,
      kind: row.kind,
      fieldLabel: row.field_label,
      minAmount: Number(row.min_amount),
      feePercent: Number(row.fee_percent),
      processingTime: row.processing_time ?? '',
    };
    if (row.network) method.network = row.network;
    return method;
  });
}

export interface WithdrawalRequest {
  id: string;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  method: string;
  /** Masked: an account number is not something to echo back in full. */
  destination: string;
  status: 'pending' | 'under_review' | 'approved' | 'paid' | 'rejected';
  decisionNote?: string;
  payoutRef?: string;
  createdAt: string;
  decidedAt?: string;
  settledAt?: string;
}

interface WithdrawalRow {
  public_id: string;
  amount: string | number;
  fee: string | number;
  net_amount: string | number;
  currency: string;
  destination: string;
  status: WithdrawalRequest['status'];
  decision_note: string | null;
  payout_ref: string | null;
  created_at: Date;
  decided_at: Date | null;
  settled_at: Date | null;
  method_label: string | null;
}

/**
 * Shows enough of a destination to recognise it, not enough to use it.
 *
 * A withdrawal history is read in public places — a support chat, a screenshot —
 * and a full account number there is a gift to whoever is looking.
 */
function maskDestination(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

function toWithdrawal(row: WithdrawalRow): WithdrawalRequest {
  const request: WithdrawalRequest = {
    id: row.public_id,
    amount: Number(row.amount),
    fee: Number(row.fee),
    netAmount: Number(row.net_amount),
    currency: row.currency,
    method: row.method_label ?? 'Unknown',
    destination: maskDestination(row.destination),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
  if (row.decision_note) request.decisionNote = row.decision_note;
  if (row.payout_ref) request.payoutRef = row.payout_ref;
  if (row.decided_at) request.decidedAt = new Date(row.decided_at).toISOString();
  if (row.settled_at) request.settledAt = new Date(row.settled_at).toISOString();
  return request;
}

const WITHDRAWAL_SELECT = `
  SELECT w.public_id, w.amount, w.fee, w.net_amount, w.currency, w.destination, w.status,
         w.decision_note, w.payout_ref, w.created_at, w.decided_at, w.settled_at,
         m.label AS method_label
    FROM withdrawal_requests w
    LEFT JOIN payout_methods m ON m.id = w.method_id
   WHERE w.deleted_at IS NULL
`;

/**
 * Requests a payout.
 *
 * The debit happens inside the same transaction that writes the request, so
 * there is no window in which the money is both available and claimed.
 */
export async function requestWithdrawal(
  userId: number,
  input: { methodId: string; amount: number; destination: string; idempotencyKey: string },
): Promise<WithdrawalRequest> {
  const [enabled, open, minWithdrawal, payoutCurrency] = await Promise.all([
    getSetting('monetization.enabled'),
    getSetting('monetization.withdrawals_open'),
    getSetting('monetization.min_withdrawal'),
    getSetting('monetization.payout_currency'),
  ]);

  if (enabled === false) {
    throw new AppError('forbidden', 'Monetization is currently turned off.');
  }
  if (open === false) {
    // An operator can close withdrawals — during an incident, or a payout
    // provider outage — without taking the whole product down.
    throw new AppError('forbidden', 'Withdrawals are temporarily closed.');
  }

  // A replay of a request that already succeeded returns the original.
  const replay = await findByIdempotencyKey(userId, input.idempotencyKey);
  if (replay) return replay;

  const method = await queryOne<{
    id: number;
    label: string;
    min_amount: string | number;
    fee_percent: string | number;
  }>(
    'SELECT id, label, min_amount, fee_percent FROM payout_methods WHERE id = :id AND is_enabled = 1',
    { id: Number(input.methodId) },
  );
  if (!method) throw new AppError('not_found', 'That payout method is not available.');

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('bad_request', 'Enter an amount to withdraw.');
  }

  // The stricter of the two minimums applies: a platform floor and a per-method
  // one, because a payout provider has its own limits.
  const floor = Math.max(Number(minWithdrawal) || 0, Number(method.min_amount) || 0);
  if (amount < floor) {
    throw new AppError(
      'below_minimum_amount',
      `The minimum withdrawal is ${floor} ${payoutCurrency}.`,
    );
  }

  const feePercent = Number(method.fee_percent) || 0;
  const fee = Number(((amount * feePercent) / 100).toFixed(2));
  const netAmount = Number((amount - fee).toFixed(2));
  if (netAmount <= 0) {
    throw new AppError('below_minimum_amount', 'The fee would consume the whole amount.');
  }

  const publicId = ulid();

  try {
    await transaction(async (tx) => {
      // The debit is the hold. `debit` throws `insufficient_balance` rather than
      // clamping, so a second request against the same money cannot succeed.
      const debited = await ledger.debit(tx, {
        userId,
        wallet: 'withdrawable',
        type: 'withdrawal_request',
        amount,
        description: `Withdrawal to ${method.label}`,
        reference: publicId,
        fiatAmount: netAmount,
        fiatCurrency: String(payoutCurrency),
        idempotencyKey: `withdrawal:${input.idempotencyKey}`,
        // Held, not spent: the money is out of the balance but not yet paid.
        status: 'pending',
      });

      await execute(
        `INSERT INTO withdrawal_requests
           (public_id, user_id, method_id, amount, fee, net_amount, currency,
            destination, status, ledger_id)
         VALUES (:publicId, :userId, :methodId, :amount, :fee, :netAmount, :currency,
                 :destination, 'pending', :ledgerId)`,
        {
          publicId,
          userId,
          methodId: method.id,
          amount,
          fee,
          netAmount,
          currency: String(payoutCurrency),
          destination: input.destination,
          ledgerId: debited.ledgerId,
        },
        tx,
      );

      await execute(
        'UPDATE wallets SET pending_withdrawal = pending_withdrawal + :amount WHERE user_id = :userId',
        { amount, userId },
        tx,
      );
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      const existing = await findByIdempotencyKey(userId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

  logger.info({ publicId, userId, amount, netAmount }, 'withdrawal requested');

  const row = await queryOne<WithdrawalRow>(`${WITHDRAWAL_SELECT} AND w.public_id = :publicId`, {
    publicId,
  });
  if (!row) throw new AppError('internal_error', 'The request could not be read back.');
  return toWithdrawal(row);
}

async function findByIdempotencyKey(
  userId: number,
  idempotencyKey: string,
): Promise<WithdrawalRequest | null> {
  const row = await queryOne<WithdrawalRow>(
    `${WITHDRAWAL_SELECT}
       AND w.user_id = :userId
       AND w.ledger_id = (SELECT id FROM wallet_ledger
                           WHERE idempotency_key = :key AND user_id = :userId)`,
    { userId, key: `withdrawal:${idempotencyKey}` },
  );
  return row ? toWithdrawal(row) : null;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

export async function listWithdrawals(userId: number, limit = 50): Promise<WithdrawalRequest[]> {
  const rows = await query<WithdrawalRow>(
    `${WITHDRAWAL_SELECT} AND w.user_id = :userId ORDER BY w.created_at DESC LIMIT :limit`,
    { userId, limit },
  );
  return rows.map(toWithdrawal);
}

/**
 * Cancels a request that has not been acted on, and refunds the hold.
 *
 * Only while `pending`: once an administrator has approved it the money may
 * already be moving, and a user cancelling then would be refunded for a payout
 * that still lands.
 */
export async function cancelWithdrawal(
  userId: number,
  publicId: string,
): Promise<WithdrawalRequest> {
  const row = await queryOne<{
    id: number;
    amount: string | number;
    status: string;
    method_label: string | null;
  }>(
    `SELECT w.id, w.amount, w.status, m.label AS method_label
       FROM withdrawal_requests w
       LEFT JOIN payout_methods m ON m.id = w.method_id
      WHERE w.public_id = :publicId AND w.user_id = :userId AND w.deleted_at IS NULL`,
    { publicId, userId },
  );
  if (!row) throw new AppError('not_found', 'Request not found.');
  if (row.status !== 'pending') {
    throw new AppError('invalid_state_transition', 'That request can no longer be cancelled.');
  }

  await refund(row.id, userId, Number(row.amount), publicId, 'Cancelled by the account holder', null);

  const updated = await queryOne<WithdrawalRow>(
    `${WITHDRAWAL_SELECT} AND w.public_id = :publicId`,
    { publicId },
  );
  if (!updated) throw new AppError('internal_error', 'The request could not be read back.');
  return toWithdrawal(updated);
}

/**
 * Puts held money back into the withdrawable balance.
 *
 * Shared by cancellation and rejection because they are the same movement: the
 * request is over and the money was never paid.
 */
async function refund(
  requestId: number,
  userId: number,
  amount: number,
  publicId: string,
  note: string,
  adminUserId: number | null,
): Promise<void> {
  await transaction(async (tx) => {
    const claimed = await execute(
      `UPDATE withdrawal_requests
          SET status = 'rejected', decision_note = :note,
              decided_by = :adminId, decided_at = CURRENT_TIMESTAMP(3)
        WHERE id = :id AND status IN ('pending', 'under_review', 'approved')`,
      { note, adminId: adminUserId, id: requestId },
      tx,
    );
    if (claimed.affectedRows === 0) {
      throw new AppError('invalid_state_transition', 'That request has already been settled.');
    }

    await ledger.credit(tx, {
      userId,
      wallet: 'withdrawable',
      type: 'withdrawal_rejected',
      amount,
      description: 'Withdrawal returned',
      reference: publicId,
      ...(adminUserId ? { adminId: adminUserId } : {}),
      reason: note,
      idempotencyKey: `withdrawal-refund:${publicId}`,
    });

    await execute(
      `UPDATE wallets
          SET pending_withdrawal = GREATEST(0, pending_withdrawal - :amount)
        WHERE user_id = :userId`,
      { amount, userId },
      tx,
    );
  });
}

export interface AdminWithdrawal extends WithdrawalRequest {
  username: string;
  /** Unmasked, for the administrator who has to make the payment. */
  destinationFull: string;
}

export async function pendingWithdrawals(limit = 100): Promise<AdminWithdrawal[]> {
  const rows = await query<WithdrawalRow & { username: string }>(
    `SELECT w.public_id, w.amount, w.fee, w.net_amount, w.currency, w.destination, w.status,
            w.decision_note, w.payout_ref, w.created_at, w.decided_at, w.settled_at,
            m.label AS method_label, u.username
       FROM withdrawal_requests w
       JOIN users u ON u.id = w.user_id
       LEFT JOIN payout_methods m ON m.id = w.method_id
      WHERE w.deleted_at IS NULL
        AND w.status IN ('pending', 'under_review', 'approved')
      ORDER BY w.created_at
      LIMIT :limit`,
    { limit },
  );

  return rows.map((row) => ({
    ...toWithdrawal(row),
    username: row.username,
    destinationFull: row.destination,
  }));
}

/**
 * An administrator's decision.
 *
 * `approve` moves it to approved — the money stays held, nothing new moves.
 * `pay` settles it: the held ledger row becomes successful and the payout
 * reference is recorded. `reject` refunds.
 *
 * Marking paid is separate from approving because they happen at different
 * times: approval is a review, payment is a bank transfer that may fail.
 */
export async function decideWithdrawal(
  adminUserId: number,
  publicId: string,
  action: 'approve' | 'pay' | 'reject',
  note: string,
  payoutRef?: string,
): Promise<WithdrawalRequest> {
  const row = await queryOne<{
    id: number;
    user_id: number;
    amount: string | number;
    net_amount: string | number;
    status: string;
    ledger_id: number | null;
  }>(
    `SELECT id, user_id, amount, net_amount, status, ledger_id
       FROM withdrawal_requests
      WHERE public_id = :publicId AND deleted_at IS NULL`,
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Request not found.');

  if (action === 'reject') {
    await refund(row.id, row.user_id, Number(row.amount), publicId, note, adminUserId);
  } else if (action === 'approve') {
    const claimed = await execute(
      `UPDATE withdrawal_requests
          SET status = 'approved', decision_note = :note,
              decided_by = :adminId, decided_at = CURRENT_TIMESTAMP(3)
        WHERE id = :id AND status IN ('pending', 'under_review')`,
      { note, adminId: adminUserId, id: row.id },
    );
    if (claimed.affectedRows === 0) {
      throw new AppError('invalid_state_transition', 'That request is not awaiting approval.');
    }
  } else {
    await transaction(async (tx) => {
      const claimed = await execute(
        `UPDATE withdrawal_requests
            SET status = 'paid', payout_ref = :payoutRef, decision_note = :note,
                settled_at = CURRENT_TIMESTAMP(3),
                decided_by = COALESCE(decided_by, :adminId),
                decided_at = COALESCE(decided_at, CURRENT_TIMESTAMP(3))
          WHERE id = :id AND status IN ('pending', 'under_review', 'approved')`,
        { payoutRef: payoutRef ?? null, note, adminId: adminUserId, id: row.id },
        tx,
      );
      if (claimed.affectedRows === 0) {
        throw new AppError('invalid_state_transition', 'That request has already been settled.');
      }

      // The money already left the balance when the request was made. Paying it
      // does not move value again — it settles the row that recorded the hold.
      if (row.ledger_id !== null) {
        await execute(
          `UPDATE wallet_ledger
              SET status = 'successful', entry_type = 'withdrawal_paid',
                  admin_id = :adminId, reason = :note, reference = :payoutRef
            WHERE id = :ledgerId AND status = 'pending'`,
          {
            adminId: adminUserId,
            note,
            payoutRef: payoutRef ?? publicId,
            ledgerId: row.ledger_id,
          },
          tx,
        );
      }

      await execute(
        `UPDATE wallets
            SET pending_withdrawal = GREATEST(0, pending_withdrawal - :amount)
          WHERE user_id = :userId`,
        { amount: Number(row.amount), userId: row.user_id },
        tx,
      );
    });
  }

  logger.info({ publicId, action, adminUserId }, 'withdrawal decided');

  const updated = await queryOne<WithdrawalRow>(
    `${WITHDRAWAL_SELECT} AND w.public_id = :publicId`,
    { publicId },
  );
  if (!updated) throw new AppError('internal_error', 'The request could not be read back.');
  return toWithdrawal(updated);
}
