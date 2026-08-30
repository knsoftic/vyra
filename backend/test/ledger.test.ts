/**
 * Ledger integration tests — run against the real database.
 *
 * These assert the two rules the whole money system rests on:
 *   ADR-013  balance and ledger move together, and never disagree.
 *   ADR-018  the four balances do not merge, and only cleared gift earnings pay out.
 *
 * Each test creates its own user and removes it afterwards, so the suite leaves
 * no rows behind and can run repeatedly against a database that holds real data.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ulid } from 'ulid';
import { pool, transaction, execute, query, queryOne } from '../src/core/db.ts';
import { closeRedis } from '../src/core/redis.ts';
import { AppError } from '../src/core/errors.ts';
import {
  credit,
  debit,
  convert,
  assertPayable,
  getBalances,
  reconcile,
} from '../src/modules/wallet/ledger.ts';

const created: number[] = [];

async function makeUser(): Promise<number> {
  const publicId = ulid();
  const result = await execute(
    `INSERT INTO users (public_id, username, email, password_hash, account_type, status)
     VALUES (:publicId, :username, :email, 'x', 'creator', 'active')`,
    {
      publicId,
      username: `t_${publicId.slice(-12).toLowerCase()}`,
      email: `${publicId.slice(-12).toLowerCase()}@test.local`,
    },
  );
  created.push(result.insertId);
  return result.insertId;
}

before(async () => {
  const row = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'wallet_ledger'",
  );
  assert.ok(row && Number(row.c) === 1, 'migrations must be applied before running these tests');
});

after(async () => {
  for (const id of created) {
    await execute('DELETE FROM wallet_ledger WHERE user_id = ?', [id]);
    await execute('DELETE FROM wallets WHERE user_id = ?', [id]);
    await execute('DELETE FROM users WHERE id = ?', [id]);
  }
  await pool.end();
  await closeRedis();
});

test('a credit writes the balance and the ledger row together', async () => {
  const userId = await makeUser();

  const result = await transaction((tx) =>
    credit(tx, {
      userId,
      wallet: 'coin',
      type: 'purchase',
      amount: 1000,
      description: 'Coin purchase',
    }),
  );

  assert.equal(result.balanceBefore, 0);
  assert.equal(result.balanceAfter, 1000);

  const balances = await getBalances(userId);
  assert.equal(balances.coin, 1000);

  const entries = await query<{ amount: string; balance_after: string; wallet: string }>(
    'SELECT amount, balance_after, wallet FROM wallet_ledger WHERE user_id = ?',
    [userId],
  );
  assert.equal(entries.length, 1);
  assert.equal(Number(entries[0]?.amount), 1000);
  assert.equal(Number(entries[0]?.balance_after), 1000);
  assert.equal(entries[0]?.wallet, 'coin');
});

test('the four balances do not bleed into one another', async () => {
  const userId = await makeUser();

  await transaction(async (tx) => {
    await credit(tx, { userId, wallet: 'coin', type: 'purchase', amount: 500, description: 'coins' });
    await credit(tx, { userId, wallet: 'reward', type: 'task_reward', amount: 40, description: 'task' });
    await credit(tx, { userId, wallet: 'live_gift', type: 'gift_received', amount: 900, description: 'gift' });
  });

  const b = await getBalances(userId);
  assert.equal(b.coin, 500, 'coin balance must hold only coin movements');
  assert.equal(b.reward, 40, 'reward balance must hold only reward movements');
  assert.equal(b.liveGift, 900, 'live gift balance must hold only gift movements');
  assert.equal(b.withdrawable, 0, 'nothing becomes withdrawable without clearing');
});

test('a debit larger than the balance is refused, and changes nothing', async () => {
  const userId = await makeUser();
  await transaction((tx) =>
    credit(tx, { userId, wallet: 'coin', type: 'purchase', amount: 100, description: 'coins' }),
  );

  await assert.rejects(
    () =>
      transaction((tx) =>
        debit(tx, { userId, wallet: 'coin', type: 'promotion', amount: 250, description: 'promo' }),
      ),
    (err: unknown) => err instanceof AppError && err.code === 'insufficient_balance',
  );

  const b = await getBalances(userId);
  assert.equal(b.coin, 100, 'a refused debit must leave the balance untouched');

  const entries = await query<{ c: number }>(
    'SELECT COUNT(*) AS c FROM wallet_ledger WHERE user_id = ?',
    [userId],
  );
  assert.equal(Number(entries[0]?.c), 1, 'the failed debit must not leave a ledger row');
});

test('reward converts one way into coins', async () => {
  const userId = await makeUser();
  await transaction((tx) =>
    credit(tx, { userId, wallet: 'reward', type: 'task_reward', amount: 200, description: 'tasks' }),
  );

  const out = await transaction((tx) =>
    convert(tx, {
      userId,
      from: 'reward',
      to: 'coin',
      amount: 200,
      rate: 1,
      type: 'reward_to_coins',
      description: 'Reward converted to coins',
    }),
  );

  assert.equal(out.produced, 200);
  const b = await getBalances(userId);
  assert.equal(b.reward, 0);
  assert.equal(b.coin, 200);
});

test('coins cannot be converted back into reward, or into withdrawable', async () => {
  const userId = await makeUser();
  await transaction((tx) =>
    credit(tx, { userId, wallet: 'coin', type: 'purchase', amount: 500, description: 'coins' }),
  );

  for (const to of ['reward', 'withdrawable'] as const) {
    await assert.rejects(
      () =>
        transaction((tx) =>
          convert(tx, {
            userId,
            from: 'coin',
            to,
            amount: 100,
            rate: 1,
            type: 'reward_to_coins',
            description: 'should be refused',
          }),
        ),
      (err: unknown) => err instanceof AppError && err.code === 'invalid_state_transition',
      `coin -> ${to} must be refused`,
    );
  }

  const b = await getBalances(userId);
  assert.equal(b.coin, 500, 'refused conversions must not move anything');
});

test('reward cannot be turned into withdrawable — task farming must not pay cash', async () => {
  const userId = await makeUser();
  await transaction((tx) =>
    credit(tx, { userId, wallet: 'reward', type: 'task_reward', amount: 10_000, description: 'tasks' }),
  );

  await assert.rejects(
    () =>
      transaction((tx) =>
        convert(tx, {
          userId,
          from: 'reward',
          to: 'withdrawable',
          amount: 10_000,
          rate: 1,
          type: 'withdrawal_request',
          description: 'should be refused',
        }),
      ),
    (err: unknown) => err instanceof AppError && err.code === 'invalid_state_transition',
  );

  const b = await getBalances(userId);
  assert.equal(b.withdrawable, 0);
  assert.equal(b.reward, 10_000);
});

test('only the withdrawable balance is payable', () => {
  assert.doesNotThrow(() => assertPayable('withdrawable'));
  for (const wallet of ['coin', 'reward', 'live_gift'] as const) {
    assert.throws(
      () => assertPayable(wallet),
      (err: unknown) => err instanceof AppError && err.code === 'wallet_not_payable',
      `${wallet} must not be payable`,
    );
  }
});

test('a frozen wallet blocks spending but still accepts an admin correction', async () => {
  const userId = await makeUser();
  await transaction((tx) =>
    credit(tx, { userId, wallet: 'coin', type: 'purchase', amount: 300, description: 'coins' }),
  );
  await execute(
    "UPDATE wallets SET is_frozen = 1, frozen_reason = 'Under review' WHERE user_id = ?",
    [userId],
  );

  await assert.rejects(
    () =>
      transaction((tx) =>
        debit(tx, { userId, wallet: 'coin', type: 'promotion', amount: 50, description: 'promo' }),
      ),
    (err: unknown) => err instanceof AppError && err.code === 'wallet_frozen',
  );

  // An admin must still be able to put things right on a frozen wallet.
  await assert.doesNotReject(() =>
    transaction((tx) =>
      credit(tx, {
        userId,
        wallet: 'coin',
        type: 'admin_credit',
        amount: 25,
        description: 'Goodwill credit',
      }),
    ),
  );

  const b = await getBalances(userId);
  assert.equal(b.coin, 325);
});

test('concurrent debits cannot overdraw the same wallet', async () => {
  const userId = await makeUser();
  await transaction((tx) =>
    credit(tx, { userId, wallet: 'coin', type: 'purchase', amount: 100, description: 'coins' }),
  );

  // Ten simultaneous spends of 20 against a balance of 100: exactly five may win.
  const attempts = Array.from({ length: 10 }, () =>
    transaction((tx) =>
      debit(tx, { userId, wallet: 'coin', type: 'gift_sent', amount: 20, description: 'gift' }),
    ).then(
      () => 'ok' as const,
      () => 'refused' as const,
    ),
  );

  const results = await Promise.all(attempts);
  const succeeded = results.filter((r) => r === 'ok').length;

  assert.equal(succeeded, 5, 'exactly five debits of 20 fit inside a balance of 100');

  const b = await getBalances(userId);
  assert.equal(b.coin, 0, 'balance must land exactly on zero, never below');
});

test('reconcile agrees with the ledger after a mixed sequence', async () => {
  const userId = await makeUser();
  await transaction(async (tx) => {
    await credit(tx, { userId, wallet: 'coin', type: 'purchase', amount: 1000, description: 'buy' });
    await debit(tx, { userId, wallet: 'coin', type: 'promotion', amount: 250, description: 'promo' });
    await credit(tx, { userId, wallet: 'reward', type: 'task_reward', amount: 60, description: 'task' });
    await credit(tx, { userId, wallet: 'live_gift', type: 'gift_received', amount: 400, description: 'gift' });
  });

  const result = await reconcile(userId);
  assert.equal(result.ok, true, `unexpected drift: ${JSON.stringify(result.drift)}`);

  const b = await getBalances(userId);
  assert.equal(b.coin, 750);
  assert.equal(b.reward, 60);
  assert.equal(b.liveGift, 400);
});

test('reconcile reports drift rather than silently repairing it', async () => {
  const userId = await makeUser();
  await transaction((tx) =>
    credit(tx, { userId, wallet: 'coin', type: 'purchase', amount: 500, description: 'buy' }),
  );

  // Simulate a bug writing the balance without a matching ledger row.
  await execute('UPDATE wallets SET coin_balance = 9999 WHERE user_id = ?', [userId]);

  const result = await reconcile(userId);
  assert.equal(result.ok, false, 'drift must be detected');
  assert.deepEqual(result.drift.coin, { stored: 9999, derived: 500 });

  const b = await getBalances(userId);
  assert.equal(b.coin, 9999, 'reconcile must not overwrite the evidence');
});
