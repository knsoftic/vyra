/**
 * Monetization end-to-end.
 *
 * The Phase 10 exit criteria, written as the ways money could be lost:
 *
 *   1. coins are credited on approval, never on a claim that money was sent
 *   2. a withdrawal debits on request, so the same balance cannot be claimed twice
 *   3. a rejected or cancelled withdrawal refunds
 *   4. only cleared gift earnings are payable
 *   5. a task reward is claimed once
 *   6. task progress is measured, never submitted
 *   7. reward balance converts to coins but never to cash
 *   8. every amount is configuration, and the configured value is what applies
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.RATE_LIMIT_ENABLED = 'false';
process.env.NODE_ENV = 'development';

const { createApp } = await import('../src/app.ts');
const { pool, execute, query, queryOne } = await import('../src/core/db.ts');
const { closeRedis } = await import('../src/core/redis.ts');
const { __setMemoForTesting } = await import('../src/core/settings.ts');
const rewards = await import('../src/modules/wallet/rewards.service.ts');

let server: Server;
let base = '';
const createdEmails: string[] = [];

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Envelope<T> }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Envelope<T> };
}

interface Actor {
  token: string;
  publicId: string;
  id: number;
}

async function registerUser(): Promise<Actor> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `p10_${suffix}@vyra.test`;
  createdEmails.push(email);

  const res = await api<{ user: { id: string }; tokens: { accessToken: string } }>(
    'POST',
    '/api/v1/auth/register',
    {
      email,
      password: 'Str0ng-Passphrase!',
      username: `p10_${suffix}`,
      birthdate: '1995-04-12',
      device: { deviceId: `dev-p10-${suffix}`, platform: 'web' },
    },
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));

  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return { token: res.body.data!.tokens.accessToken, publicId: res.body.data!.user.id, id: row!.id };
}

async function makeAdmin(user: Actor): Promise<void> {
  const { ulid } = await import('ulid');
  await execute(
    "INSERT IGNORE INTO roles (slug, name, is_system) VALUES ('super_admin', 'Super admin', 1)",
  );
  const role = await queryOne<{ id: number }>("SELECT id FROM roles WHERE slug = 'super_admin'");
  await execute(
    `INSERT INTO admin_users (public_id, user_id, email, password_hash, name, role_id)
     VALUES (?, ?, ?, 'x', 'Test admin', ?)`,
    [ulid(), user.id, `admin_${user.id}@vyra.test`, role?.id ?? null],
  );
}

/** Puts cleared, withdrawable money in an account without going through gifts. */
async function giveWithdrawable(userId: number, amount: number): Promise<void> {
  await execute('INSERT IGNORE INTO wallets (user_id) VALUES (?)', [userId]);
  await execute(
    'UPDATE wallets SET withdrawable_amount = withdrawable_amount + ? WHERE user_id = ?',
    [amount, userId],
  );
}

async function giveReward(userId: number, amount: number): Promise<void> {
  await execute('INSERT IGNORE INTO wallets (user_id) VALUES (?)', [userId]);
  await execute('UPDATE wallets SET reward_balance = reward_balance + ? WHERE user_id = ?', [
    amount,
    userId,
  ]);
}

async function balances(userId: number) {
  const row = await queryOne<{
    coin_balance: string | number;
    reward_balance: string | number;
    withdrawable_amount: string | number;
    pending_withdrawal: string | number;
  }>(
    `SELECT coin_balance, reward_balance, withdrawable_amount, pending_withdrawal
       FROM wallets WHERE user_id = ?`,
    [userId],
  );
  return {
    coin: Number(row?.coin_balance ?? 0),
    reward: Number(row?.reward_balance ?? 0),
    withdrawable: Number(row?.withdrawable_amount ?? 0),
    pending: Number(row?.pending_withdrawal ?? 0),
  };
}

async function firstPaymentMethod(): Promise<string> {
  const row = await queryOne<{ id: number }>(
    "SELECT id FROM payment_methods WHERE slug = 'bank' AND is_enabled = 1",
  );
  assert.ok(row, 'run npm run seed:monetization first');
  return String(row!.id);
}

async function firstPayoutMethod(): Promise<{ id: string; feePercent: number; minAmount: number }> {
  const row = await queryOne<{ id: number; fee_percent: string | number; min_amount: string | number }>(
    "SELECT id, fee_percent, min_amount FROM payout_methods WHERE slug = 'usdt-trc20' AND is_enabled = 1",
  );
  assert.ok(row, 'run npm run seed:monetization first');
  return {
    id: String(row!.id),
    feePercent: Number(row!.fee_percent),
    minAmount: Number(row!.min_amount),
  };
}

const key = () => ({ 'idempotency-key': randomUUID() });

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  try {
    __setMemoForTesting(null);
    await execute("DELETE FROM monetization_criteria WHERE criterion_key LIKE 'test\\_%'");
    await execute('UPDATE monetization_criteria SET is_enabled = 1');
    for (const email of createdEmails) {
      const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
      if (!user) continue;
      const id = user.id;

      await execute('DELETE FROM user_monetization WHERE user_id = ?', [id]);
      await execute('DELETE FROM moderation_actions WHERE target_type = ? AND target_id = ?', ['user', id]);
      await execute('DELETE FROM user_task_progress WHERE user_id = ?', [id]);
      await execute('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?', [id, id]);
      await execute('DELETE FROM referral_codes WHERE user_id = ?', [id]);
      await execute('DELETE FROM withdrawal_requests WHERE user_id = ?', [id]);
      await execute('DELETE FROM coin_purchase_requests WHERE user_id = ?', [id]);
      await execute('DELETE FROM wallet_ledger WHERE user_id = ? OR related_user_id = ?', [id, id]);
      await execute('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', [id, id]);
      await execute('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?', [id, id]);
      await execute('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', [id, id]);
      await execute('DELETE FROM security_events WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_devices WHERE user_id = ?', [id]);
      await execute('DELETE FROM login_attempts WHERE user_id = ?', [id]);
      await execute('DELETE FROM wallets WHERE user_id = ?', [id]);
      await execute('DELETE FROM business_profiles WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_profiles WHERE user_id = ?', [id]);
      await execute('DELETE FROM admin_users WHERE user_id = ?', [id]);
      await execute('DELETE FROM users WHERE id = ?', [id]);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await closeRedis();
  }
});

// ── Buying coins ──

test('a purchase request credits nothing until it is approved', async () => {
  const buyer = await registerUser();
  const before = await balances(buyer.id);

  const submitted = await api<{ id: string; status: string; coins: number }>(
    'POST',
    '/api/v1/coins/purchases',
    { coins: 1000, methodId: await firstPaymentMethod(), transactionRef: 'REF-123456' },
    buyer.token,
    key(),
  );
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body.error));
  assert.equal(submitted.body.data!.status, 'pending');

  const after = await balances(buyer.id);
  assert.equal(after.coin, before.coin, 'a claim that money was sent is not proof it was');
});

test('approving a purchase credits the coins once', async () => {
  const buyer = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const submitted = await api<{ id: string }>(
    'POST',
    '/api/v1/coins/purchases',
    { coins: 1000, methodId: await firstPaymentMethod(), transactionRef: 'REF-APPROVE' },
    buyer.token,
    key(),
  );
  const id = submitted.body.data!.id;

  const approved = await api<{ status: string }>(
    'POST',
    `/api/v1/admin/purchases/${id}`,
    { approve: true, note: 'Transfer confirmed in the bank statement' },
    admin.token,
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body.error));
  assert.equal(approved.body.data!.status, 'approved');

  assert.equal((await balances(buyer.id)).coin, 1000);

  // A second approval is refused rather than crediting again.
  const again = await api(
    'POST',
    `/api/v1/admin/purchases/${id}`,
    { approve: true, note: 'Clicked twice' },
    admin.token,
  );
  assert.equal(again.status, 422, JSON.stringify(again.body.error));
  assert.equal((await balances(buyer.id)).coin, 1000, 'still credited exactly once');
});

test('rejecting a purchase credits nothing', async () => {
  const buyer = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const submitted = await api<{ id: string }>(
    'POST',
    '/api/v1/coins/purchases',
    { coins: 500, methodId: await firstPaymentMethod(), transactionRef: 'REF-REJECT' },
    buyer.token,
    key(),
  );

  await api(
    'POST',
    `/api/v1/admin/purchases/${submitted.body.data!.id}`,
    { approve: false, note: 'No matching transfer found' },
    admin.token,
  );

  assert.equal((await balances(buyer.id)).coin, 0);
});

test('the rate is quoted at request time and stored on the row', async () => {
  const buyer = await registerUser();

  __setMemoForTesting({ 'coins.rates': { USD: 100 } });
  const submitted = await api<{ quotedRate: number; fiatAmount: number }>(
    'POST',
    '/api/v1/coins/purchases',
    { coins: 1000, methodId: await firstPaymentMethod(), transactionRef: 'REF-RATE', currency: 'USD' },
    buyer.token,
    key(),
  );
  __setMemoForTesting(null);

  assert.equal(submitted.body.data!.quotedRate, 100);
  assert.equal(submitted.body.data!.fiatAmount, 10, '1000 coins at 100 per USD');
});

test('a purchase without an idempotency key is refused', async () => {
  const buyer = await registerUser();
  const res = await api(
    'POST',
    '/api/v1/coins/purchases',
    { coins: 100, methodId: await firstPaymentMethod(), transactionRef: 'REF-NOKEY' },
    buyer.token,
  );
  assert.equal(res.status, 400);
});

// ── Withdrawing ──

test('a withdrawal debits on request, so the same money cannot be claimed twice', async () => {
  const creator = await registerUser();
  await giveWithdrawable(creator.id, 100);
  const method = await firstPayoutMethod();

  const first = await api<{ amount: number; fee: number; netAmount: number }>(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 80, destination: 'TRC20-ADDRESS-0001' },
    creator.token,
    key(),
  );
  assert.equal(first.status, 201, JSON.stringify(first.body.error));

  const held = await balances(creator.id);
  assert.equal(held.withdrawable, 20, 'the request is the hold');
  assert.equal(held.pending, 80);

  // The second request is against money that is already claimed.
  const second = await api(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 80, destination: 'TRC20-ADDRESS-0001' },
    creator.token,
    key(),
  );
  assert.equal(second.status, 422);
  assert.equal(second.body.error?.code, 'insufficient_balance');
});

test('the fee is taken from the amount and both are recorded', async () => {
  const creator = await registerUser();
  await giveWithdrawable(creator.id, 500);
  const method = await firstPayoutMethod();

  const res = await api<{ amount: number; fee: number; netAmount: number }>(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 200, destination: 'TRC20-ADDRESS-0002' },
    creator.token,
    key(),
  );

  const expectedFee = Number(((200 * method.feePercent) / 100).toFixed(2));
  assert.equal(res.body.data!.fee, expectedFee);
  assert.equal(res.body.data!.netAmount, Number((200 - expectedFee).toFixed(2)));
  // The full amount leaves the balance; the fee is the platform's, not a
  // discount on what was held.
  assert.equal((await balances(creator.id)).withdrawable, 300);
});

test('a rejected withdrawal returns the money', async () => {
  const creator = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  await giveWithdrawable(creator.id, 100);
  const method = await firstPayoutMethod();

  const requested = await api<{ id: string }>(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 60, destination: 'TRC20-ADDRESS-0003' },
    creator.token,
    key(),
  );
  assert.equal((await balances(creator.id)).withdrawable, 40);

  const rejected = await api<{ status: string }>(
    'POST',
    `/api/v1/admin/withdrawals/${requested.body.data!.id}`,
    { action: 'reject', note: 'Destination address did not match the account holder' },
    admin.token,
  );
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body.error));
  assert.equal(rejected.body.data!.status, 'rejected');

  const after = await balances(creator.id);
  assert.equal(after.withdrawable, 100, 'refused means refunded, not forfeited');
  assert.equal(after.pending, 0);
});

test('a cancelled withdrawal returns the money', async () => {
  const creator = await registerUser();
  await giveWithdrawable(creator.id, 100);
  const method = await firstPayoutMethod();

  const requested = await api<{ id: string }>(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 75, destination: 'TRC20-ADDRESS-0004' },
    creator.token,
    key(),
  );

  const cancelled = await api<{ status: string }>(
    'POST',
    `/api/v1/withdrawals/${requested.body.data!.id}/cancel`,
    {},
    creator.token,
  );
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body.error));
  assert.equal((await balances(creator.id)).withdrawable, 100);
});

test('paying a withdrawal does not move money a second time', async () => {
  const creator = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  await giveWithdrawable(creator.id, 100);
  const method = await firstPayoutMethod();

  const requested = await api<{ id: string }>(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 60, destination: 'TRC20-ADDRESS-0005' },
    creator.token,
    key(),
  );
  const id = requested.body.data!.id;

  await api(
    'POST',
    `/api/v1/admin/withdrawals/${id}`,
    { action: 'approve', note: 'Verified' },
    admin.token,
  );
  const paid = await api<{ status: string; payoutRef?: string }>(
    'POST',
    `/api/v1/admin/withdrawals/${id}`,
    { action: 'pay', note: 'Sent', payoutRef: 'TX-9911' },
    admin.token,
  );
  assert.equal(paid.body.data!.status, 'paid');
  assert.equal(paid.body.data!.payoutRef, 'TX-9911');

  const after = await balances(creator.id);
  assert.equal(after.withdrawable, 40, 'the balance moved once, when the request was made');
  assert.equal(after.pending, 0);

  // Paying twice is refused.
  const again = await api(
    'POST',
    `/api/v1/admin/withdrawals/${id}`,
    { action: 'pay', note: 'Sent again', payoutRef: 'TX-9912' },
    admin.token,
  );
  assert.equal(again.status, 422);
});

test('a cancelled withdrawal cannot be cancelled twice', async () => {
  const creator = await registerUser();
  await giveWithdrawable(creator.id, 100);
  const method = await firstPayoutMethod();

  const requested = await api<{ id: string }>(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 60, destination: 'TRC20-ADDRESS-0006' },
    creator.token,
    key(),
  );
  const id = requested.body.data!.id;

  await api('POST', `/api/v1/withdrawals/${id}/cancel`, {}, creator.token);
  const again = await api('POST', `/api/v1/withdrawals/${id}/cancel`, {}, creator.token);

  assert.equal(again.status, 422);
  assert.equal((await balances(creator.id)).withdrawable, 100, 'refunded once, not twice');
});

test('a withdrawal below the minimum is refused', async () => {
  const creator = await registerUser();
  await giveWithdrawable(creator.id, 1000);
  const method = await firstPayoutMethod();

  __setMemoForTesting({ 'monetization.min_withdrawal': 50 });
  const res = await api(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 5, destination: 'TRC20-ADDRESS-0007' },
    creator.token,
    key(),
  );
  __setMemoForTesting(null);

  assert.equal(res.status, 422);
  assert.equal((await balances(creator.id)).withdrawable, 1000, 'nothing was held');
});

test('withdrawals can be closed without taking the product down', async () => {
  const creator = await registerUser();
  await giveWithdrawable(creator.id, 500);
  const method = await firstPayoutMethod();

  __setMemoForTesting({ 'monetization.withdrawals_open': false });
  const res = await api(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 100, destination: 'TRC20-ADDRESS-0008' },
    creator.token,
    key(),
  );
  __setMemoForTesting(null);

  assert.equal(res.status, 403);
});

test('a withdrawal destination is masked when it is read back', async () => {
  const creator = await registerUser();
  await giveWithdrawable(creator.id, 200);
  const method = await firstPayoutMethod();

  await api(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 100, destination: 'TRC20-SECRET-ADDRESS-4321' },
    creator.token,
    key(),
  );

  const listed = await api<{ destination: string }[]>(
    'GET',
    '/api/v1/me/withdrawals',
    undefined,
    creator.token,
  );
  const shown = listed.body.data![0]!.destination;
  assert.ok(!shown.includes('SECRET'), 'a full account number is not echoed back');
  assert.ok(shown.endsWith('4321'), 'but enough remains to recognise it');
});

// ── Tasks ──

test('task progress is measured, not submitted', async () => {
  const user = await registerUser();

  const tasks = await api<{ id: string; key: string; progress: number; state: string }[]>(
    'GET',
    '/api/v1/me/tasks',
    undefined,
    user.token,
  );
  assert.equal(tasks.status, 200, JSON.stringify(tasks.body.error));
  assert.ok(tasks.body.data!.length > 0, 'run npm run seed:monetization first');

  // A brand new account has done nothing, and the server says so — there is no
  // field the client could have used to claim otherwise.
  for (const task of tasks.body.data!) {
    assert.equal(task.progress, 0);
    assert.equal(task.state, 'active');
  }
});

test('an unfinished task cannot be claimed', async () => {
  const user = await registerUser();
  const tasks = await api<{ id: string }[]>('GET', '/api/v1/me/tasks', undefined, user.token);

  const res = await api(
    'POST',
    `/api/v1/me/tasks/${tasks.body.data![0]!.id}/claim`,
    {},
    user.token,
  );
  assert.equal(res.status, 400);
});

test('a completed task pays once', async () => {
  const user = await registerUser();

  // Follow two people, which is a task the seed defines.
  const a = await registerUser();
  const b = await registerUser();
  await api('POST', `/api/v1/users/${a.publicId}/follow`, {}, user.token);
  await api('POST', `/api/v1/users/${b.publicId}/follow`, {}, user.token);

  const tasks = await api<{ id: string; key: string; state: string; rewardCoins: number }[]>(
    'GET',
    '/api/v1/me/tasks',
    undefined,
    user.token,
  );
  const followTask = tasks.body.data!.find((t) => t.key === 'follow_2');
  assert.ok(followTask, 'the follow task must exist');
  assert.equal(followTask!.state, 'completed', 'the server counted the follows itself');

  const claimed = await api<{ rewardCoins: number; alreadyClaimed: boolean }>(
    'POST',
    `/api/v1/me/tasks/${followTask!.id}/claim`,
    {},
    user.token,
  );
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body.error));
  assert.equal(claimed.body.data!.alreadyClaimed, false);

  const afterFirst = await balances(user.id);
  assert.equal(afterFirst.reward, followTask!.rewardCoins);

  const again = await api<{ alreadyClaimed: boolean }>(
    'POST',
    `/api/v1/me/tasks/${followTask!.id}/claim`,
    {},
    user.token,
  );
  assert.equal(again.body.data!.alreadyClaimed, true);
  assert.equal((await balances(user.id)).reward, afterFirst.reward, 'paid once');
});

test('a task reward goes to the reward balance, which is not withdrawable', async () => {
  const user = await registerUser();
  await giveReward(user.id, 500);
  const method = await firstPayoutMethod();

  // Reward balance is spendable in-app; it is not cash and cannot be paid out.
  const res = await api(
    'POST',
    '/api/v1/withdrawals',
    { methodId: method.id, amount: 100, destination: 'TRC20-ADDRESS-0009' },
    user.token,
    key(),
  );
  assert.equal(res.status, 422, 'the withdrawable balance is empty regardless of reward balance');
  assert.equal((await balances(user.id)).reward, 500, 'and the reward balance is untouched');
});

// ── Conversion ──

test('reward balance converts to coins at the configured rate', async () => {
  const user = await registerUser();
  await giveReward(user.id, 200);

  __setMemoForTesting({ 'monetization.reward_to_coin_rate': 2 });
  const res = await api<{ coins: number; rewardBalance: number; coinBalance: number }>(
    'POST',
    '/api/v1/me/rewards/convert',
    { amount: 100 },
    user.token,
    key(),
  );
  __setMemoForTesting(null);

  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.equal(res.body.data!.coins, 200, '100 reward at 2 coins each');
  assert.equal(res.body.data!.rewardBalance, 100);
  assert.equal(res.body.data!.coinBalance, 200);
});

test('conversion only runs one way', async () => {
  const user = await registerUser();
  await giveReward(user.id, 100);

  const res = await api<{ coins: number }>(
    'POST',
    '/api/v1/me/rewards/convert',
    { amount: 100 },
    user.token,
    key(),
  );
  assert.equal(res.status, 200);

  // There is no route back: coins cannot become reward balance, and neither can
  // become withdrawable. The absence is the guarantee.
  const after = await balances(user.id);
  assert.equal(after.reward, 0);
  assert.equal(after.withdrawable, 0, 'converting never produces cash');
});

test('converting more than the balance is refused', async () => {
  const user = await registerUser();
  await giveReward(user.id, 50);

  const res = await api(
    'POST',
    '/api/v1/me/rewards/convert',
    { amount: 100 },
    user.token,
    key(),
  );
  assert.equal(res.status, 422);
  assert.equal((await balances(user.id)).reward, 50);
});

// ── Referrals ──

test('a referral code is stable and unique per account', async () => {
  const a = await registerUser();
  const b = await registerUser();

  const first = await api<{ code: string }>('GET', '/api/v1/me/referrals', undefined, a.token);
  const again = await api<{ code: string }>('GET', '/api/v1/me/referrals', undefined, a.token);
  const other = await api<{ code: string }>('GET', '/api/v1/me/referrals', undefined, b.token);

  assert.equal(first.body.data!.code, again.body.data!.code, 'the code does not change');
  assert.notEqual(first.body.data!.code, other.body.data!.code);
});

test('a referral pays on a qualifying action, not on signup', async () => {
  const referrer = await registerUser();
  const referred = await registerUser();

  const summary = await api<{ code: string; rewardCoins: number }>(
    'GET',
    '/api/v1/me/referrals',
    undefined,
    referrer.token,
  );
  const code = summary.body.data!.code;

  const recorded = await rewards.recordReferral(referred.id, code, { ip: '127.0.0.1' });
  assert.equal(recorded.recorded, true);

  // Signing up pays nothing — otherwise the reward is for creating accounts.
  assert.equal((await balances(referrer.id)).reward, 0);

  const paid = await rewards.qualifyReferral(referred.id);
  assert.equal(paid.paid, true);
  assert.equal((await balances(referrer.id)).reward, summary.body.data!.rewardCoins);

  // Qualifying twice pays once.
  const again = await rewards.qualifyReferral(referred.id);
  assert.equal(again.paid, false);
  assert.equal((await balances(referrer.id)).reward, summary.body.data!.rewardCoins);
});

test('you cannot refer yourself', async () => {
  const user = await registerUser();
  const summary = await api<{ code: string }>('GET', '/api/v1/me/referrals', undefined, user.token);

  const recorded = await rewards.recordReferral(user.id, summary.body.data!.code, {});
  assert.equal(recorded.recorded, false);
});

// ── The ledger reconstructs everything ──

test('every movement leaves a ledger row that reconstructs the balance', async () => {
  const user = await registerUser();
  await giveReward(user.id, 100);

  await api('POST', '/api/v1/me/rewards/convert', { amount: 100 }, user.token, key());

  const rows = await query<{
    entry_type: string;
    amount: string | number;
    balance_before: string | number;
    balance_after: string | number;
  }>(
    `SELECT entry_type, amount, balance_before, balance_after
       FROM wallet_ledger WHERE user_id = ? ORDER BY id`,
    [user.id],
  );

  assert.ok(rows.length >= 2, 'a conversion is a debit and a credit');
  for (const row of rows) {
    assert.equal(
      Number(row.balance_after),
      Number(row.balance_before) + Number(row.amount),
      `${row.entry_type} must reconstruct`,
    );
  }
});
// ── Monetization eligibility ──
//
// The screen behind this rendered one fixed sample for every account. What
// matters here is that a requirement nobody measures can never let someone
// through, and that applying re-checks rather than trusting what the app says.

interface Status {
  state: string;
  progress: number;
  criteriaMet: number;
  criteria: {
    id: string; label: string; metric: string; current: number; required: number;
    met: boolean; measurable: boolean; isBoolean: boolean;
  }[];
  canApply: boolean;
  appliedAt: string | null;
  unmeasurable: string[];
}

/** A criterion of our own, so no test depends on the seeded thresholds. */
async function addCriterion(
  key: string,
  metric: string,
  required: number,
  opts: { isBoolean?: boolean; enabled?: boolean } = {},
): Promise<void> {
  await execute(
    `INSERT INTO monetization_criteria
       (criterion_key, label, metric, required, unit, is_boolean, is_enabled, sort_order)
     VALUES (:key, :key, :metric, :required, NULL, :isBoolean, :enabled, 900)`,
    {
      key, metric, required,
      isBoolean: opts.isBoolean ? 1 : 0,
      enabled: opts.enabled === false ? 0 : 1,
    },
  );
}

/** Runs `body` with only this test's own criteria enforced. */
async function onlyTestCriteria<T>(body: () => Promise<T>): Promise<T> {
  await execute("UPDATE monetization_criteria SET is_enabled = 0 WHERE criterion_key NOT LIKE 'test\\_%'");
  try {
    return await body();
  } finally {
    await execute("UPDATE monetization_criteria SET is_enabled = 1 WHERE criterion_key NOT LIKE 'test\\_%'");
    await execute("DELETE FROM monetization_criteria WHERE criterion_key LIKE 'test\\_%'");
  }
}

test('requirements are measured, not assumed', async () => {
  const user = await registerUser();

  const res = await api<Status>('GET', '/api/v1/me/monetization', undefined, user.token);
  assert.equal(res.status, 200, JSON.stringify(res.body.error));

  const s = res.body.data!;
  assert.ok(s.criteria.length > 0, 'the platform publishes requirements');
  assert.equal(s.state, 'locked', 'a brand new account has not qualified');
  assert.equal(s.canApply, false);

  const followers = s.criteria.find((c) => c.metric === 'followers');
  assert.ok(followers, 'followers is one of the seeded requirements');
  assert.equal(followers!.current, 0);
  assert.equal(followers!.met, false);

  const restriction = s.criteria.find((c) => c.metric === 'no_active_restriction');
  assert.equal(restriction!.met, true, 'nobody has restricted this account');
});

test('a restriction in force fails its requirement, and lifting it passes again', async () => {
  const user = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const before = await api<Status>('GET', '/api/v1/me/monetization', undefined, user.token);
  assert.equal(
    before.body.data!.criteria.find((c) => c.metric === 'no_active_restriction')!.met, true);

  const action = await execute(
    `INSERT INTO moderation_actions (admin_id, target_type, target_id, action, reason)
     VALUES (:adminId, 'user', :userId, 'suspension', 'test')`,
    { adminId: admin.id, userId: user.id },
  );

  const during = await api<Status>('GET', '/api/v1/me/monetization', undefined, user.token);
  assert.equal(
    during.body.data!.criteria.find((c) => c.metric === 'no_active_restriction')!.met, false,
    'a live suspension is a failed requirement');

  // Reverted actions are history, not restrictions.
  await execute('UPDATE moderation_actions SET reverted_at = NOW(3) WHERE id = ?', [action.insertId]);

  const after = await api<Status>('GET', '/api/v1/me/monetization', undefined, user.token);
  assert.equal(
    after.body.data!.criteria.find((c) => c.metric === 'no_active_restriction')!.met, true,
    'lifting it counts again');
});

test('a requirement nothing measures blocks rather than passes', async () => {
  const user = await registerUser();

  await onlyTestCriteria(async () => {
    await addCriterion('test_unknown', 'vibes', 1);

    const res = await api<Status>('GET', '/api/v1/me/monetization', undefined, user.token);
    const s = res.body.data!;

    const row = s.criteria.find((c) => c.id === 'test_unknown')!;
    assert.equal(row.measurable, false, 'nothing measures "vibes"');
    assert.equal(row.met, false, 'and an unmeasured requirement is never met');
    assert.deepEqual(s.unmeasurable, ['vibes'], 'the operator is told which one');
    assert.equal(s.canApply, false);

    const applied = await api('POST', '/api/v1/me/monetization/apply', undefined, user.token);
    assert.equal(applied.status, 503, 'and applying is refused rather than granted');
  });
});

test('meeting every requirement makes an account eligible, and applying queues it', async () => {
  const user = await registerUser();

  await onlyTestCriteria(async () => {
    await addCriterion('test_age', 'account_age_days', 0);
    await addCriterion('test_clean', 'no_active_restriction', 1, { isBoolean: true });

    const eligible = await api<Status>('GET', '/api/v1/me/monetization', undefined, user.token);
    assert.equal(eligible.body.data!.state, 'eligible');
    assert.equal(eligible.body.data!.progress, 100);
    assert.equal(eligible.body.data!.canApply, true);

    const applied = await api<Status>('POST', '/api/v1/me/monetization/apply', undefined, user.token);
    assert.equal(applied.status, 200, JSON.stringify(applied.body.error));
    assert.equal(applied.body.data!.state, 'review');
    assert.ok(applied.body.data!.appliedAt);

    // Applying twice is not an error, and does not move the queue position.
    const again = await api<Status>('POST', '/api/v1/me/monetization/apply', undefined, user.token);
    assert.equal(again.status, 200);
    assert.equal(again.body.data!.appliedAt, applied.body.data!.appliedAt, 'the first time stands');
  });
});

test('re-measuring never overrides a decision that a person made', async () => {
  const user = await registerUser();

  await onlyTestCriteria(async () => {
    await addCriterion('test_free', 'account_age_days', 0);

    await api('GET', '/api/v1/me/monetization', undefined, user.token);
    await api('POST', '/api/v1/me/monetization/apply', undefined, user.token);

    // An admin turns it on. Then the bar moves out of reach.
    await execute(
      "UPDATE user_monetization SET state = 'enabled', enabled_at = NOW(3) WHERE user_id = ?",
      [user.id],
    );
    await execute("UPDATE monetization_criteria SET required = 99999 WHERE criterion_key = 'test_free'");

    const res = await api<Status>('GET', '/api/v1/me/monetization', undefined, user.token);
    assert.equal(res.body.data!.state, 'enabled',
      'losing ground must not silently switch off an approved account');
    assert.equal(res.body.data!.criteriaMet, 0, 'though the progress it reports stays honest');
  });
});

test('progress reflects how close each requirement is, not just how many are done', async () => {
  const user = await registerUser();

  await onlyTestCriteria(async () => {
    await addCriterion('test_far', 'followers', 100);
    await addCriterion('test_done', 'account_age_days', 0);

    const res = await api<Status>('GET', '/api/v1/me/monetization', undefined, user.token);
    assert.equal(res.body.data!.criteriaMet, 1);
    assert.equal(res.body.data!.progress, 50, 'one finished, one at zero');
  });
});

test('a requirement that is switched off is not enforced', async () => {
  const user = await registerUser();

  await onlyTestCriteria(async () => {
    await addCriterion('test_off', 'followers', 100000, { enabled: false });
    await addCriterion('test_on', 'account_age_days', 0);

    const res = await api<Status>('GET', '/api/v1/me/monetization', undefined, user.token);
    assert.ok(!res.body.data!.criteria.some((c) => c.id === 'test_off'), 'switched off, so absent');
    assert.equal(res.body.data!.state, 'eligible');
  });
});

test('monetization status needs a session', async () => {
  assert.equal((await api('GET', '/api/v1/me/monetization')).status, 401);
  assert.equal((await api('POST', '/api/v1/me/monetization/apply')).status, 401);
});

test('an admin cannot create a criterion nothing can measure', async () => {
  const admin = await registerUser();
  await makeAdmin(admin);

  const bad = await api<unknown>(
    'POST', '/api/v1/admin/criteria',
    { values: { criterion_key: 'test_typo', label: 'Typo', metric: 'folowers', required: 10 } },
    admin.token,
  );
  assert.equal(bad.status, 400, 'a typo is refused where it is made');
  assert.match(bad.body.error!.message, /followers/, 'and the valid names are offered');

  const good = await api<unknown>(
    'POST', '/api/v1/admin/criteria',
    { values: { criterion_key: 'test_ok', label: 'Real', metric: 'followers', required: 10 } },
    admin.token,
  );
  assert.equal(good.status, 201, JSON.stringify(good.body.error));
  await execute("DELETE FROM monetization_criteria WHERE criterion_key = 'test_ok'");
});
