/**
 * Buying coins.
 *
 * There is no card processor here. Coins are bought by transferring money
 * through a local method — bank, Easypaisa, JazzCash, USDT — and submitting the
 * transaction reference; an administrator checks it against the receiving
 * account and approves. That is how this market actually pays, and it shapes
 * the design:
 *
 * **Coins are credited on approval, never on submission.** A request is a claim
 * that money was sent, not proof of it. Crediting first and reversing later
 * would mean spending coins that were never paid for.
 *
 * **The price is quoted at request time and stored on the row.** Rates move.
 * A request approved next week must settle at the rate the buyer was shown, not
 * whatever the setting says on the day an administrator gets to it.
 *
 * **Approval is idempotent.** An administrator double-clicking must not credit
 * twice, and the `ledger_id` on the row is what makes that checkable rather than
 * assumed.
 */

import { ulid } from 'ulid';
import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { getSetting } from '../../core/settings.ts';
import { logger } from '../../core/logger.ts';
import { storage } from '../../core/storage.ts';
import * as ledger from './ledger.ts';

export interface CoinPackage {
  id: string;
  coins: number;
  bonusCoins: number;
  totalCoins: number;
  price: number;
  currency: string;
  discountPercent: number;
  isPopular: boolean;
}

export interface PaymentMethodOption {
  id: string;
  slug: string;
  label: string;
  kind: string;
  /** Where the buyer sends the money. */
  accountName: string;
  accountNumber: string;
  /** Ordered steps the buyer follows. */
  instructions: string[];
  /** Empty means the method accepts any configured currency. */
  currencies: string[];
}

/**
 * The catalogue, priced in the caller's currency.
 *
 * `coins.rates` maps a currency to how many coins one unit buys, so the price
 * is derived rather than stored per currency — a new currency is a setting
 * change, not a migration.
 */
export async function listPackages(currency = 'USD'): Promise<CoinPackage[]> {
  const rows = await query<{
    id: number;
    coins: string | number;
    bonus_coins: string | number;
    base_price: string | number;
    base_currency: string;
    discount_percent: number;
    is_popular: number;
  }>(
    `SELECT id, coins, bonus_coins, base_price, base_currency, discount_percent, is_popular
       FROM coin_packages
      WHERE is_enabled = 1
      ORDER BY sort_order, coins`,
  );

  const rates = (await getSetting('coins.rates')) as Record<string, number>;
  const baseRate = rates.USD ?? 100;
  const targetRate = rates[currency];

  return rows.map((row) => {
    const coins = Number(row.coins);
    const bonus = Number(row.bonus_coins);
    const basePrice = Number(row.base_price);

    // With no rate for the requested currency the base price stands, labelled
    // in its own currency — better than converting at a rate nobody configured.
    const price =
      targetRate && baseRate
        ? Number(((coins / targetRate)).toFixed(2))
        : basePrice;

    return {
      id: String(row.id),
      coins,
      bonusCoins: bonus,
      totalCoins: coins + bonus,
      price,
      currency: targetRate ? currency : row.base_currency,
      discountPercent: row.discount_percent,
      isPopular: row.is_popular === 1,
    };
  });
}

export async function listPaymentMethods(): Promise<PaymentMethodOption[]> {
  const rows = await query<{
    id: number;
    slug: string;
    label: string;
    kind: string;
    account_name: string | null;
    account_number: string | null;
    currencies: string | null;
    instructions: string | null;
  }>(
    `SELECT id, slug, label, kind, account_name, account_number, currencies, instructions
       FROM payment_methods
      WHERE is_enabled = 1
      ORDER BY label`,
  );

  return rows.map((row) => {
    const method: PaymentMethodOption = {
      id: String(row.id),
      slug: row.slug,
      label: row.label,
      kind: row.kind,
      // What the buyer is told to send money to — the account name and number
      // together, because either alone is not enough to make a transfer.
      accountName: row.account_name ?? '',
      accountNumber: row.account_number ?? '',
      instructions: parseCurrencies(row.instructions),
      currencies: parseCurrencies(row.currencies),
    };
    return method;
  });
}

/**
 * Reads a JSON array of strings from a column.
 *
 * A malformed value yields an empty list rather than throwing — for currencies
 * that means "no restriction", and for instructions it means the buyer sees the
 * account details without steps, which is recoverable. Neither should make the
 * payment screen fail to load.
 */
function parseCurrencies(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

export interface PurchaseRequest {
  id: string;
  coins: number;
  fiatAmount: number;
  fiatCurrency: string;
  quotedRate: number;
  method: string;
  transactionRef: string;
  proofUrl?: string;
  status: 'pending' | 'under_review' | 'approved' | 'rejected';
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
}

interface PurchaseRow {
  public_id: string;
  coins: string | number;
  fiat_amount: string | number;
  fiat_currency: string;
  quoted_rate: string | number;
  transaction_ref: string | null;
  proof_key: string | null;
  status: PurchaseRequest['status'];
  decision_note: string | null;
  created_at: Date;
  decided_at: Date | null;
  method_label: string | null;
}

function toRequest(row: PurchaseRow): PurchaseRequest {
  const request: PurchaseRequest = {
    id: row.public_id,
    coins: Number(row.coins),
    fiatAmount: Number(row.fiat_amount),
    fiatCurrency: row.fiat_currency,
    quotedRate: Number(row.quoted_rate),
    method: row.method_label ?? 'Unknown',
    transactionRef: row.transaction_ref ?? '',
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
  if (row.proof_key) request.proofUrl = storage.url(row.proof_key);
  if (row.decision_note) request.decisionNote = row.decision_note;
  if (row.decided_at) request.decidedAt = new Date(row.decided_at).toISOString();
  return request;
}

const REQUEST_SELECT = `
  SELECT r.public_id, r.coins, r.fiat_amount, r.fiat_currency, r.quoted_rate,
         r.transaction_ref, r.proof_key, r.status, r.decision_note,
         r.created_at, r.decided_at, m.label AS method_label
    FROM coin_purchase_requests r
    LEFT JOIN payment_methods m ON m.id = r.method_id
   WHERE r.deleted_at IS NULL
`;


async function findByKey(userId: number, idempotencyKey: string): Promise<PurchaseRequest | null> {
  const row = await queryOne<PurchaseRow>(
    `${REQUEST_SELECT} AND r.user_id = :userId AND r.idempotency_key = :key`,
    { userId, key: idempotencyKey },
  );
  return row ? toRequest(row) : null;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

/**
 * Submits a claim that money was sent.
 *
 * Nothing is credited. The buyer's coins arrive when an administrator confirms
 * the transfer landed — see `decidePurchase`.
 */
export async function requestPurchase(
  userId: number,
  input: {
    packageId?: string;
    coins?: number;
    methodId: string;
    transactionRef: string;
    proofKey?: string;
    currency?: string;
    idempotencyKey: string;
  },
): Promise<PurchaseRequest> {
  if ((await getSetting('monetization.enabled')) === false) {
    throw new AppError('forbidden', 'Coin purchases are currently turned off.');
  }

  // A retry that reached us after the first attempt committed. Read from the
  // database, so it holds when the cache is unavailable — which is exactly when
  // a client retries (ADR-032).
  const replay = await findByKey(userId, input.idempotencyKey);
  if (replay) return replay;

  const method = await queryOne<{ id: number; label: string; currencies: string | null }>(
    'SELECT id, label, currencies FROM payment_methods WHERE id = :id AND is_enabled = 1',
    { id: Number(input.methodId) },
  );
  if (!method) throw new AppError('not_found', 'That payment method is not available.');

  // A package fixes the coin count; a free amount is allowed but still has to
  // resolve to a whole number of coins.
  let coins: number;
  if (input.packageId) {
    const pkg = await queryOne<{ coins: string | number; bonus_coins: string | number }>(
      'SELECT coins, bonus_coins FROM coin_packages WHERE id = :id AND is_enabled = 1',
      { id: Number(input.packageId) },
    );
    if (!pkg) throw new AppError('not_found', 'That package is not available.');
    coins = Number(pkg.coins) + Number(pkg.bonus_coins);
  } else {
    coins = Math.floor(Number(input.coins) || 0);
  }

  if (coins <= 0) throw new AppError('bad_request', 'Choose a package or a coin amount.');

  const currency = (input.currency ?? 'USD').toUpperCase();
  const rates = (await getSetting('coins.rates')) as Record<string, number>;
  const rate = rates[currency];
  if (!rate) {
    throw new AppError('bad_request', `Coins cannot be bought in ${currency} yet.`);
  }

  const accepted = parseCurrencies(method.currencies);
  if (accepted.length > 0 && !accepted.includes(currency)) {
    throw new AppError('bad_request', `${method.label} does not accept ${currency}.`);
  }

  const fiatAmount = Number((coins / rate).toFixed(2));
  if (fiatAmount <= 0) {
    throw new AppError('below_minimum_amount', 'That amount is too small to pay for.');
  }

  const publicId = ulid();
  try {
    await execute(
      `INSERT INTO coin_purchase_requests
         (public_id, user_id, method_id, coins, fiat_amount, fiat_currency, quoted_rate,
          transaction_ref, proof_key, status, idempotency_key)
       VALUES (:publicId, :userId, :methodId, :coins, :fiatAmount, :currency, :rate,
               :ref, :proofKey, 'pending', :idempotencyKey)`,
      {
        publicId,
        userId,
        methodId: method.id,
        coins,
        fiatAmount,
        currency,
        // Stored so approval settles at the rate the buyer was shown, whenever
        // that approval happens.
        rate,
        ref: input.transactionRef,
        proofKey: input.proofKey ?? null,
        idempotencyKey: input.idempotencyKey,
      },
    );
  } catch (err) {
    // Two retries arriving together: the second loses the unique key, which is
    // the constraint doing its job.
    if (isDuplicateKey(err)) {
      const existing = await findByKey(userId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

  const row = await queryOne<PurchaseRow>(`${REQUEST_SELECT} AND r.public_id = :publicId`, {
    publicId,
  });
  if (!row) throw new AppError('internal_error', 'The request could not be read back.');
  return toRequest(row);
}

export async function listPurchases(userId: number, limit = 50): Promise<PurchaseRequest[]> {
  const rows = await query<PurchaseRow>(
    `${REQUEST_SELECT} AND r.user_id = :userId ORDER BY r.created_at DESC LIMIT :limit`,
    { userId, limit },
  );
  return rows.map(toRequest);
}

/**
 * An administrator's decision on a purchase.
 *
 * Approving credits the coins. Rejecting credits nothing — no money moved into
 * the platform, so none moves out. Both record who decided and why.
 *
 * The row is claimed with a conditional update before any credit, so two
 * administrators acting at once produce one credit, not two.
 */
export async function decidePurchase(
  adminUserId: number,
  publicId: string,
  approve: boolean,
  note: string,
): Promise<PurchaseRequest> {
  const row = await queryOne<{
    id: number;
    user_id: number;
    coins: string | number;
    fiat_amount: string | number;
    fiat_currency: string;
    status: string;
    ledger_id: number | null;
  }>(
    `SELECT id, user_id, coins, fiat_amount, fiat_currency, status, ledger_id
       FROM coin_purchase_requests
      WHERE public_id = :publicId AND deleted_at IS NULL`,
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Request not found.');

  if (row.status === 'approved' || row.status === 'rejected') {
    throw new AppError('invalid_state_transition', 'That request has already been decided.');
  }

  await transaction(async (tx) => {
    // Claim it first. A second administrator's update matches nothing and the
    // credit below never runs for them.
    const claimed = await execute(
      `UPDATE coin_purchase_requests
          SET status = :status, decided_by = :adminId, decided_at = CURRENT_TIMESTAMP(3),
              decision_note = :note
        WHERE id = :id AND status IN ('pending', 'under_review')`,
      {
        status: approve ? 'approved' : 'rejected',
        adminId: adminUserId,
        note,
        id: row.id,
      },
      tx,
    );
    if (claimed.affectedRows === 0) {
      throw new AppError('invalid_state_transition', 'That request has already been decided.');
    }

    if (!approve) return;

    const credited = await ledger.credit(tx, {
      userId: row.user_id,
      wallet: 'coin',
      type: 'purchase',
      amount: Number(row.coins),
      description: `Coin purchase ${publicId}`,
      reference: publicId,
      fiatAmount: Number(row.fiat_amount),
      fiatCurrency: row.fiat_currency,
      adminId: adminUserId,
      reason: note,
      // The ledger's unique key is the backstop: even a bug that ran this twice
      // could only write one row.
      idempotencyKey: `purchase:${publicId}`,
    });

    await execute(
      'UPDATE coin_purchase_requests SET ledger_id = :ledgerId WHERE id = :id',
      { ledgerId: credited.ledgerId, id: row.id },
      tx,
    );
  });

  logger.info(
    { publicId, approve, adminUserId, coins: Number(row.coins) },
    'coin purchase decided',
  );

  const updated = await queryOne<PurchaseRow>(`${REQUEST_SELECT} AND r.public_id = :publicId`, {
    publicId,
  });
  if (!updated) throw new AppError('internal_error', 'The request could not be read back.');
  return toRequest(updated);
}

/** The queue an administrator works through. */
export async function pendingPurchases(limit = 100): Promise<
  (PurchaseRequest & { username: string })[]
> {
  const rows = await query<PurchaseRow & { username: string }>(
    `${REQUEST_SELECT.replace(
      'FROM coin_purchase_requests r',
      'FROM coin_purchase_requests r JOIN users u ON u.id = r.user_id',
    ).replace('r.created_at, r.decided_at,', 'r.created_at, r.decided_at, u.username,')}
       AND r.status IN ('pending', 'under_review')
     ORDER BY r.created_at
     LIMIT :limit`,
    { limit },
  );
  return rows.map((row) => ({ ...toRequest(row), username: row.username }));
}
