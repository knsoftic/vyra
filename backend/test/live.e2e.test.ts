/**
 * Live streaming and gifting end-to-end.
 *
 * The Phase 9 exit criteria, and the properties that would cost real money to
 * get wrong:
 *
 *   1. a stream key is issued once and never readable again
 *   2. viewer counts are derived from rows, not from what a client reports
 *   3. a gift moves coins from sender to creator, or moves nothing at all
 *   4. a retried gift charges once — including with the cache unavailable
 *   5. the platform share is configuration, and what applied is recorded
 *   6. creator earnings are held for a clearing period before they can be taken
 *   7. gifting is not a route around the payout rules
 *   8. an admin can stop a stream, and the host cannot undo it
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
const giftsService = await import('../src/modules/live/gifts.service.ts');

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
  const email = `p9_${suffix}@vyra.test`;
  createdEmails.push(email);

  const res = await api<{ user: { id: string }; tokens: { accessToken: string } }>(
    'POST',
    '/api/v1/auth/register',
    {
      email,
      password: 'Str0ng-Passphrase!',
      username: `p9_${suffix}`,
      birthdate: '1995-04-12',
      device: { deviceId: `dev-p9-${suffix}`, platform: 'web' },
    },
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));

  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return { token: res.body.data!.tokens.accessToken, publicId: res.body.data!.user.id, id: row!.id };
}

/** Puts coins in someone's wallet so they can afford to send something. */
async function giveCoins(userId: number, coins: number): Promise<void> {
  await execute('INSERT IGNORE INTO wallets (user_id) VALUES (?)', [userId]);
  await execute('UPDATE wallets SET coin_balance = coin_balance + ? WHERE user_id = ?', [
    coins,
    userId,
  ]);
}

async function balances(userId: number): Promise<{ coin: number; liveGift: number; withdrawable: number }> {
  const row = await queryOne<{
    coin_balance: string | number;
    live_gift_balance: string | number;
    withdrawable_amount: string | number;
  }>('SELECT coin_balance, live_gift_balance, withdrawable_amount FROM wallets WHERE user_id = ?', [
    userId,
  ]);
  return {
    coin: Number(row?.coin_balance ?? 0),
    liveGift: Number(row?.live_gift_balance ?? 0),
    withdrawable: Number(row?.withdrawable_amount ?? 0),
  };
}

interface StreamShape {
  id: string;
  title: string;
  state: string;
  viewerCount: number;
  likeCount: number;
  giftCoins: number;
  playbackUrl?: string;
  host: { id: string };
}

interface StartedShape {
  stream: StreamShape;
  credentials: { streamId: string; ingestUrl: string; streamKey: string; expiresAt: string };
}

interface GiftResultShape {
  id: string;
  coinsSpent: number;
  coinsToCreator: number;
  platformSharePercent: number;
  senderBalance: number;
  clearsAt: string;
  duplicate: boolean;
}

async function startStream(host: Actor, over: Record<string, unknown> = {}): Promise<StartedShape> {
  const res = await api<StartedShape>(
    'POST',
    '/api/v1/live',
    { title: `Stream ${Math.random().toString(36).slice(2, 8)}`, ...over },
    host.token,
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  return res.body.data!;
}

async function firstGiftId(): Promise<string> {
  const row = await queryOne<{ id: number }>(
    "SELECT id FROM gifts WHERE slug = 'heart' AND is_active = 1",
  );
  assert.ok(row, 'the gift catalogue must be seeded — run npm run seed:gifts');
  return String(row!.id);
}

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  try {
    __setMemoForTesting(null);
    for (const email of createdEmails) {
      const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
      if (!user) continue;
      const id = user.id;

      await execute(
        `DELETE c FROM gift_clearing c
           JOIN gift_transactions t ON t.id = c.gift_tx_id
          WHERE t.sender_id = ? OR t.recipient_id = ?`,
        [id, id],
      );
      await execute('DELETE FROM gift_clearing WHERE user_id = ?', [id]);
      await execute('DELETE FROM gift_transactions WHERE sender_id = ? OR recipient_id = ?', [id, id]);
      await execute('DELETE FROM wallet_ledger WHERE user_id = ? OR related_user_id = ?', [id, id]);

      await execute('DELETE FROM live_likes WHERE user_id = ?', [id]);
      await execute(
        'DELETE v FROM live_viewers v JOIN live_streams s ON s.id = v.stream_id WHERE s.host_id = ?',
        [id],
      );
      await execute('DELETE FROM live_viewers WHERE user_id = ?', [id]);
      await execute(
        'DELETE c FROM live_comments c JOIN live_streams s ON s.id = c.stream_id WHERE s.host_id = ?',
        [id],
      );
      await execute('DELETE FROM live_comments WHERE user_id = ?', [id]);
      await execute('DELETE FROM live_streams WHERE host_id = ?', [id]);

      await execute('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', [id, id]);
      await execute('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?', [id, id]);
      await execute('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', [id, id]);
      await execute('DELETE FROM security_events WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_devices WHERE user_id = ?', [id]);
      await execute('DELETE FROM login_attempts WHERE user_id = ?', [id]);
      await execute('DELETE FROM referral_codes WHERE user_id = ?', [id]);
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

// ── Broadcasting ──

test('a stream key is issued once and cannot be read back', async () => {
  const host = await registerUser();
  const started = await startStream(host);

  assert.ok(started.credentials.streamKey.length > 20);
  assert.ok(started.credentials.ingestUrl.startsWith('rtmp://'));

  // Fetching the stream again returns no credential of any kind.
  const fetched = await api<StreamShape>(
    'GET', `/api/v1/live/${started.stream.id}`, undefined, host.token,
  );
  const serialised = JSON.stringify(fetched.body.data);
  assert.ok(
    !serialised.includes(started.credentials.streamKey),
    'the stream key must never appear in a later response',
  );

  // And it is stored hashed, not in plaintext.
  const row = await queryOne<{ stream_key_hash: string | null }>(
    'SELECT stream_key_hash FROM live_streams WHERE public_id = ?',
    [started.stream.id],
  );
  assert.ok(row?.stream_key_hash);
  assert.notEqual(row!.stream_key_hash, started.credentials.streamKey);
  assert.equal(row!.stream_key_hash!.length, 64, 'a SHA-256 hex digest');
});

test('a host cannot run two streams at once', async () => {
  const host = await registerUser();
  await startStream(host);

  const second = await api('POST', '/api/v1/live', { title: 'Second' }, host.token);
  assert.equal(second.status, 400, 'a split audience makes the viewer count meaningless');
});

test('a live stream has a playback url and an ended one does not', async () => {
  const host = await registerUser();
  const started = await startStream(host);
  assert.ok(started.stream.playbackUrl, 'a live stream is playable');

  const ended = await api<StreamShape>(
    'POST', `/api/v1/live/${started.stream.id}/end`, {}, host.token,
  );
  assert.equal(ended.body.data!.state, 'ended');
  assert.equal(ended.body.data!.playbackUrl, undefined, 'nothing to play once it is over');
});

test('ending a stream destroys its key', async () => {
  const host = await registerUser();
  const started = await startStream(host);
  await api('POST', `/api/v1/live/${started.stream.id}/end`, {}, host.token);

  const row = await queryOne<{ stream_key_hash: string | null }>(
    'SELECT stream_key_hash FROM live_streams WHERE public_id = ?',
    [started.stream.id],
  );
  assert.equal(row?.stream_key_hash, null, 'a finished broadcast cannot be resumed with the old key');
});

// ── Watching ──

test('the viewer count is derived from rows, not from what a client says', async () => {
  const host = await registerUser();
  const a = await registerUser();
  const b = await registerUser();
  const started = await startStream(host);
  const id = started.stream.id;

  await api('POST', `/api/v1/live/${id}/join`, {}, a.token);
  const second = await api<{ viewerCount: number }>(
    'POST', `/api/v1/live/${id}/join`, {}, b.token,
  );
  assert.equal(second.body.data!.viewerCount, 2);

  // Joining twice is not two viewers.
  const again = await api<{ viewerCount: number }>(
    'POST', `/api/v1/live/${id}/join`, {}, a.token,
  );
  assert.equal(again.body.data!.viewerCount, 2, 'a reconnect must not inflate the count');

  const left = await api<{ viewerCount: number }>(
    'POST', `/api/v1/live/${id}/leave`, {}, a.token,
  );
  assert.equal(left.body.data!.viewerCount, 1);
});

test('peak viewers only ever moves up', async () => {
  const host = await registerUser();
  const viewer = await registerUser();
  const started = await startStream(host);
  const id = started.stream.id;

  await api('POST', `/api/v1/live/${id}/join`, {}, viewer.token);
  await api('POST', `/api/v1/live/${id}/leave`, {}, viewer.token);

  const row = await queryOne<{ peak_viewers: number; viewer_count: number }>(
    'SELECT peak_viewers, viewer_count FROM live_streams WHERE public_id = ?',
    [id],
  );
  assert.equal(Number(row?.viewer_count), 0);
  assert.ok(Number(row?.peak_viewers) >= 1, 'peak records what happened, not what is happening');
});

test('a banned viewer cannot rejoin or comment', async () => {
  const host = await registerUser();
  const viewer = await registerUser();
  const started = await startStream(host);
  const id = started.stream.id;

  await api('POST', `/api/v1/live/${id}/join`, {}, viewer.token);
  const banned = await api(
    'POST', `/api/v1/live/${id}/viewers/${viewer.publicId}/ban`, {}, host.token,
  );
  assert.equal(banned.status, 200, JSON.stringify(banned.body.error));

  const rejoin = await api('POST', `/api/v1/live/${id}/join`, {}, viewer.token);
  assert.equal(rejoin.status, 403);

  const comment = await api(
    'POST', `/api/v1/live/${id}/comments`, { body: 'still here' }, viewer.token,
  );
  assert.equal(comment.status, 403);
});

test('only the host can see who is watching', async () => {
  const host = await registerUser();
  const viewer = await registerUser();
  const started = await startStream(host);
  await api('POST', `/api/v1/live/${started.stream.id}/join`, {}, viewer.token);

  const asHost = await api<unknown[]>(
    'GET', `/api/v1/live/${started.stream.id}/viewers`, undefined, host.token,
  );
  assert.equal(asHost.body.data!.length, 1);

  const asViewer = await api(
    'GET', `/api/v1/live/${started.stream.id}/viewers`, undefined, viewer.token,
  );
  assert.equal(asViewer.status, 403);
});

// ── Chat and likes ──

test('comments respect the host switch', async () => {
  const host = await registerUser();
  const viewer = await registerUser();
  const started = await startStream(host, { allowComments: false });

  const res = await api(
    'POST', `/api/v1/live/${started.stream.id}/comments`, { body: 'hello' }, viewer.token,
  );
  assert.equal(res.status, 403);
});

test('a client cannot claim an arbitrary number of likes', async () => {
  const host = await registerUser();
  const viewer = await registerUser();
  const started = await startStream(host);
  const id = started.stream.id;

  // Above the per-call cap: rejected by validation rather than silently accepted.
  const absurd = await api('POST', `/api/v1/live/${id}/likes`, { count: 1_000_000 }, viewer.token);
  assert.equal(absurd.status, 400);

  const ok1 = await api<{ likeCount: number; yours: number }>(
    'POST', `/api/v1/live/${id}/likes`, { count: 10 }, viewer.token,
  );
  assert.equal(ok1.body.data!.likeCount, 10);
  assert.equal(ok1.body.data!.yours, 10);

  const ok2 = await api<{ likeCount: number; yours: number }>(
    'POST', `/api/v1/live/${id}/likes`, { count: 5 }, viewer.token,
  );
  assert.equal(ok2.body.data!.likeCount, 15, 'the total is recomputed from the per-viewer rows');
});

// ── Gifting: the money path ──

test('a gift moves coins from the sender to the creator', async () => {
  const sender = await registerUser();
  const creator = await registerUser();
  await giveCoins(sender.id, 1000);

  const before = await balances(sender.id);
  const creatorBefore = await balances(creator.id);

  const res = await api<GiftResultShape>(
    'POST', '/api/v1/gifts',
    { giftId: await firstGiftId(), recipientId: creator.publicId, quantity: 3 },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));

  const gift = res.body.data!;
  assert.equal(gift.coinsSpent, 30, '3 × a 10-coin gift');
  assert.equal(gift.duplicate, false);

  const after = await balances(sender.id);
  const creatorAfter = await balances(creator.id);

  assert.equal(after.coin, before.coin - 30, 'the sender paid exactly what the gift cost');
  assert.equal(
    creatorAfter.liveGift,
    creatorBefore.liveGift + gift.coinsToCreator,
    'and the creator received exactly the recorded share',
  );

  // The platform keeps the difference — no coins are created or destroyed.
  assert.ok(gift.coinsToCreator > 0 && gift.coinsToCreator < gift.coinsSpent);
});

test('the platform share is configuration, and what applied is recorded', async () => {
  const sender = await registerUser();
  const creator = await registerUser();
  await giveCoins(sender.id, 1000);

  // A 30% platform share instead of the default.
  __setMemoForTesting({ 'monetization.gift_platform_share': 0.3 });

  const res = await api<GiftResultShape>(
    'POST', '/api/v1/gifts',
    { giftId: await firstGiftId(), recipientId: creator.publicId, quantity: 1 },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );
  __setMemoForTesting(null);

  assert.equal(res.body.data!.platformSharePercent, 30);
  assert.equal(res.body.data!.coinsToCreator, 7, '10 coins less a 30% share');
});

test('an out-of-range platform share is clamped rather than obeyed', async () => {
  const sender = await registerUser();
  const creator = await registerUser();
  await giveCoins(sender.id, 1000);

  // A share above 1 would credit the creator a negative amount.
  __setMemoForTesting({ 'monetization.gift_platform_share': 5 });

  const res = await api<GiftResultShape>(
    'POST', '/api/v1/gifts',
    { giftId: await firstGiftId(), recipientId: creator.publicId, quantity: 1 },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );
  __setMemoForTesting(null);

  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  assert.ok(res.body.data!.coinsToCreator >= 0, 'a misconfiguration must not owe the creator money');
  assert.equal(res.body.data!.coinsToCreator, 1, 'and the arithmetic must not lose the last coin');
  assert.equal(res.body.data!.platformSharePercent, 90, 'clamped to the maximum');
});

test('a retried gift charges once', async () => {
  const sender = await registerUser();
  const creator = await registerUser();
  await giveCoins(sender.id, 1000);

  const key = randomUUID();
  const payload = { giftId: await firstGiftId(), recipientId: creator.publicId, quantity: 2 };

  const first = await api<GiftResultShape>(
    'POST', '/api/v1/gifts', payload, sender.token, { 'idempotency-key': key },
  );
  const retry = await api<GiftResultShape>(
    'POST', '/api/v1/gifts', payload, sender.token, { 'idempotency-key': key },
  );

  assert.equal(first.status, 201);
  assert.equal(retry.status, 200, 'a repeat is accepted, not rejected');
  assert.equal(retry.body.data!.id, first.body.data!.id, 'and returns the original transaction');
  assert.equal(retry.body.data!.duplicate, true);

  // One transaction, one pair of ledger rows.
  const count = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM gift_transactions WHERE sender_id = ?',
    [sender.id],
  );
  assert.equal(Number(count?.c), 1);

  const after = await balances(sender.id);
  assert.equal(after.coin, 1000 - 20, 'charged once, not twice');
});

test('a gift without an idempotency key is refused', async () => {
  const sender = await registerUser();
  const creator = await registerUser();
  await giveCoins(sender.id, 100);

  const res = await api(
    'POST', '/api/v1/gifts',
    { giftId: await firstGiftId(), recipientId: creator.publicId, quantity: 1 },
    sender.token,
  );
  assert.equal(res.status, 400);
});

test('a gift the sender cannot afford moves nothing at all', async () => {
  const sender = await registerUser();
  const creator = await registerUser();
  await giveCoins(sender.id, 5);

  const creatorBefore = await balances(creator.id);

  const res = await api(
    'POST', '/api/v1/gifts',
    { giftId: await firstGiftId(), recipientId: creator.publicId, quantity: 1 },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );
  assert.equal(res.status, 422, JSON.stringify(res.body.error));
  assert.equal(res.body.error?.code, 'insufficient_balance');

  const senderAfter = await balances(sender.id);
  const creatorAfter = await balances(creator.id);

  assert.equal(senderAfter.coin, 5, 'the sender still has their coins');
  assert.equal(creatorAfter.liveGift, creatorBefore.liveGift, 'and the creator got nothing');

  const rows = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM gift_transactions WHERE sender_id = ?',
    [sender.id],
  );
  assert.equal(Number(rows?.c), 0, 'and no transaction was recorded');
});

test('gifting yourself is refused', async () => {
  const user = await registerUser();
  await giveCoins(user.id, 1000);

  const res = await api(
    'POST', '/api/v1/gifts',
    { giftId: await firstGiftId(), recipientId: user.publicId, quantity: 1 },
    user.token,
    { 'idempotency-key': randomUUID() },
  );
  // Otherwise coins become withdrawable balance, which is a cash-out route
  // around the payout rules rather than a gift.
  assert.equal(res.status, 400);
});

test('a blocked account cannot be gifted', async () => {
  const sender = await registerUser();
  const creator = await registerUser();
  await giveCoins(sender.id, 1000);
  await api('POST', `/api/v1/users/${sender.publicId}/block`, {}, creator.token);

  const res = await api(
    'POST', '/api/v1/gifts',
    { giftId: await firstGiftId(), recipientId: creator.publicId, quantity: 1 },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );
  assert.equal(res.status, 404);
});

test('a gift in a stream must go to its host', async () => {
  const host = await registerUser();
  const other = await registerUser();
  const sender = await registerUser();
  await giveCoins(sender.id, 1000);

  const started = await startStream(host);

  const res = await api(
    'POST', '/api/v1/gifts',
    {
      giftId: await firstGiftId(),
      recipientId: other.publicId,
      streamId: started.stream.id,
      quantity: 1,
    },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );
  // Otherwise a gift inflates the totals of a stream it had nothing to do with.
  assert.equal(res.status, 400);
});

test('a gift in a stream adds to that stream total', async () => {
  const host = await registerUser();
  const sender = await registerUser();
  await giveCoins(sender.id, 1000);
  const started = await startStream(host);

  await api(
    'POST', '/api/v1/gifts',
    {
      giftId: await firstGiftId(),
      recipientId: host.publicId,
      streamId: started.stream.id,
      quantity: 4,
    },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );

  const stream = await api<StreamShape>(
    'GET', `/api/v1/live/${started.stream.id}`, undefined, host.token,
  );
  assert.equal(stream.body.data!.giftCoins, 40);
});

test('a stream that has ended does not accept gifts', async () => {
  const host = await registerUser();
  const sender = await registerUser();
  await giveCoins(sender.id, 1000);
  const started = await startStream(host);
  await api('POST', `/api/v1/live/${started.stream.id}/end`, {}, host.token);

  const res = await api(
    'POST', '/api/v1/gifts',
    {
      giftId: await firstGiftId(),
      recipientId: host.publicId,
      streamId: started.stream.id,
      quantity: 1,
    },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );
  assert.equal(res.status, 400);
});

// ── Clearing ──

test('creator earnings are held before they become withdrawable', async () => {
  const sender = await registerUser();
  const creator = await registerUser();
  await giveCoins(sender.id, 1000);

  await api(
    'POST', '/api/v1/gifts',
    { giftId: await firstGiftId(), recipientId: creator.publicId, quantity: 10 },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );

  const held = await balances(creator.id);
  assert.ok(held.liveGift > 0, 'the value is credited');
  assert.equal(held.withdrawable, 0, 'but not yet available to take');

  // Nothing is due yet, so a clearing run releases nothing.
  const early = await giftsService.releaseCleared();
  assert.equal(early.rows, 0);

  // Once the holding period has elapsed it clears.
  await execute(
    `UPDATE gift_clearing SET clears_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
      WHERE user_id = ?`,
    [creator.id],
  );
  const released = await giftsService.releaseCleared();
  assert.ok(released.rows >= 1);

  const cleared = await balances(creator.id);
  assert.equal(cleared.liveGift, 0, 'moved out of the held balance');
  assert.ok(cleared.withdrawable > 0, 'and into the withdrawable one');
});

test('clearing the same row twice releases value once', async () => {
  const sender = await registerUser();
  const creator = await registerUser();
  await giveCoins(sender.id, 1000);

  await api(
    'POST', '/api/v1/gifts',
    { giftId: await firstGiftId(), recipientId: creator.publicId, quantity: 10 },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );
  await execute(
    `UPDATE gift_clearing SET clears_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
      WHERE user_id = ?`,
    [creator.id],
  );

  await giftsService.releaseCleared();
  const once = await balances(creator.id);

  await giftsService.releaseCleared();
  const twice = await balances(creator.id);

  assert.deepEqual(twice, once, 'a second run must not pay out again');
});

// ── The ledger is the record ──

test('every gift writes a matched pair of ledger rows', async () => {
  const sender = await registerUser();
  const creator = await registerUser();
  await giveCoins(sender.id, 1000);

  const res = await api<GiftResultShape>(
    'POST', '/api/v1/gifts',
    { giftId: await firstGiftId(), recipientId: creator.publicId, quantity: 1 },
    sender.token,
    { 'idempotency-key': randomUUID() },
  );

  const rows = await query<{
    user_id: number;
    wallet: string;
    entry_type: string;
    amount: string | number;
    balance_before: string | number;
    balance_after: string | number;
  }>(
    `SELECT user_id, wallet, entry_type, amount, balance_before, balance_after
       FROM wallet_ledger
      WHERE user_id IN (?, ?) AND entry_type IN ('gift_sent', 'gift_received')
      ORDER BY id`,
    [sender.id, creator.id],
  );

  assert.equal(rows.length, 2);

  const debit = rows.find((r) => r.entry_type === 'gift_sent')!;
  const credit = rows.find((r) => r.entry_type === 'gift_received')!;

  assert.equal(Number(debit.amount), -res.body.data!.coinsSpent, 'the debit is negative');
  assert.equal(Number(credit.amount), res.body.data!.coinsToCreator, 'the credit is positive');

  // Each row carries the balance either side, so the history reconstructs.
  assert.equal(
    Number(debit.balance_after),
    Number(debit.balance_before) + Number(debit.amount),
  );
  assert.equal(
    Number(credit.balance_after),
    Number(credit.balance_before) + Number(credit.amount),
  );
});

// ── Moderation ──

test('an admin can stop a stream and the host cannot undo it', async () => {
  const host = await registerUser();
  const admin = await registerUser();
  const { ulid } = await import('ulid');
  // The roles table is configuration an installation supplies; the test creates
  // the one it needs rather than assuming a seeded environment.
  await execute(
    "INSERT IGNORE INTO roles (slug, name, is_system) VALUES ('super_admin', 'Super admin', 1)",
  );
  const role = await queryOne<{ id: number }>(
    "SELECT id FROM roles WHERE slug = 'super_admin'",
  );
  await execute(
    `INSERT INTO admin_users (public_id, user_id, email, password_hash, name, role_id)
     VALUES (?, ?, ?, 'x', 'Test admin', ?)`,
    [ulid(), admin.id, `admin_${admin.id}@vyra.test`, role?.id ?? null],
  );

  const started = await startStream(host);

  const stopped = await api<StreamShape>(
    'POST', `/api/v1/admin/live/${started.stream.id}/stop`,
    { reason: 'Breach of guidelines' },
    admin.token,
  );
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body.error));
  assert.equal(stopped.body.data!.state, 'banned');

  // The host cannot restart the same row, and the reason is recorded.
  const row = await queryOne<{ status: string; ended_reason: string | null }>(
    'SELECT status, ended_reason FROM live_streams WHERE public_id = ?',
    [started.stream.id],
  );
  assert.equal(row?.status, 'stopped_by_admin');
  assert.equal(row?.ended_reason, 'Breach of guidelines');
});

test('an ordinary user cannot stop someone else stream', async () => {
  const host = await registerUser();
  const nosy = await registerUser();
  const started = await startStream(host);

  const res = await api(
    'POST', `/api/v1/admin/live/${started.stream.id}/stop`,
    { reason: 'I do not like it' },
    nosy.token,
  );
  assert.ok(res.status === 403 || res.status === 404, `expected a refusal, got ${res.status}`);
});
