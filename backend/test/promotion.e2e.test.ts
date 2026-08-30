/**
 * Promotion and campaigns end-to-end.
 *
 * The Phase 11 exit criteria:
 *
 *   1. promotion buys distribution and never engagement
 *   2. the budget is held on creation, so two campaigns cannot share coins
 *   3. an unspent budget is returned when a campaign stops or is rejected
 *   4. a campaign cannot outspend its budget or its daily cap
 *   5. a replayed impression is not charged twice
 *   6. targeting filters, and cannot target below the platform's minimum age
 *   7. promoted items are labelled, and never take the first slot
 *   8. every reported number is a count of something that happened
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
const delivery = await import('../src/modules/promotion/delivery.service.ts');
const campaignsService = await import('../src/modules/promotion/campaigns.service.ts');

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
  const email = `p11_${suffix}@vyra.test`;
  createdEmails.push(email);

  const res = await api<{ user: { id: string }; tokens: { accessToken: string } }>(
    'POST',
    '/api/v1/auth/register',
    {
      email,
      password: 'Str0ng-Passphrase!',
      username: `p11_${suffix}`,
      birthdate: '1995-04-12',
      device: { deviceId: `dev-p11-${suffix}`, platform: 'web' },
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

async function giveCoins(userId: number, coins: number): Promise<void> {
  await execute('INSERT IGNORE INTO wallets (user_id) VALUES (?)', [userId]);
  await execute('UPDATE wallets SET coin_balance = coin_balance + ? WHERE user_id = ?', [
    coins,
    userId,
  ]);
}

async function coinBalance(userId: number): Promise<number> {
  const row = await queryOne<{ coin_balance: string | number }>(
    'SELECT coin_balance FROM wallets WHERE user_id = ?',
    [userId],
  );
  return Number(row?.coin_balance ?? 0);
}

const rid = () => `V${Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(25, '0')}`;

async function makeVideo(userId: number): Promise<{ id: number; publicId: string }> {
  const publicId = rid();
  const result = await execute(
    `INSERT INTO videos
       (public_id, user_id, caption, duration_sec, privacy, status, processing_status)
     VALUES (:publicId, :userId, 'promotion test', 30, 'public', 'published', 'complete')`,
    { publicId, userId },
  );
  return { id: result.insertId, publicId };
}

interface CampaignShape {
  id: string;
  name: string;
  status: string;
  budgetCoins: number;
  spentCoins: number;
  targeting: { mode: string; ageMin?: number; ageMax?: number };
}

const key = () => ({ 'idempotency-key': randomUUID() });

const campaignBody = (over: Record<string, unknown> = {}) => ({
  name: 'Test campaign',
  objective: 'reach',
  budgetCoins: 1000,
  durationDays: 7,
  targeting: { mode: 'broad' },
  ...over,
});

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

      await execute('DELETE FROM campaign_impressions WHERE user_id = ?', [id]);
      await execute(
        `DELETE ci FROM campaign_impressions ci
           JOIN campaigns c ON c.id = ci.campaign_id WHERE c.user_id = ?`,
        [id],
      );
      await execute(
        `DELETE ca FROM campaign_analytics ca
           JOIN campaigns c ON c.id = ca.campaign_id WHERE c.user_id = ?`,
        [id],
      );
      await execute(
        `DELETE t FROM campaign_targeting t
           JOIN campaigns c ON c.id = t.campaign_id WHERE c.user_id = ?`,
        [id],
      );
      await execute('DELETE FROM campaigns WHERE user_id = ?', [id]);
      await execute('DELETE FROM wallet_ledger WHERE user_id = ? OR related_user_id = ?', [id, id]);
      await execute('DELETE FROM feed_seen WHERE user_id = ?', [id]);
      await execute('DELETE FROM impressions WHERE user_id = ?', [id]).catch(() => undefined);
      await execute('DELETE FROM distribution_events WHERE video_id IN (SELECT id FROM videos WHERE user_id = ?)', [id]).catch(() => undefined);
      await execute('DELETE FROM videos WHERE user_id = ?', [id]);
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

// ── The rule the whole module exists to respect ──

test('there is no way to buy engagement', async () => {
  const advertiser = await registerUser();
  await giveCoins(advertiser.id, 5000);

  // Every field the API accepts, and none of them buys a like, follow or
  // comment. Anything that looked like one is rejected as an unknown field.
  const res = await api<CampaignShape>(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ likes: 500, followers: 200, comments: 50 }),
    advertiser.token,
    key(),
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));

  const row = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM campaigns WHERE user_id = ?',
    [advertiser.id],
  );
  assert.equal(Number(row?.c), 1);

  // Nothing was created on anyone's behalf.
  const likes = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM likes WHERE user_id = ?',
    [advertiser.id],
  );
  const follows = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?',
    [advertiser.id],
  );
  assert.equal(Number(likes?.c), 0);
  assert.equal(Number(follows?.c), 0);
});

// ── Budget ──

test('creating a campaign holds its whole budget', async () => {
  const advertiser = await registerUser();
  await giveCoins(advertiser.id, 5000);

  const res = await api<CampaignShape>(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ budgetCoins: 2000 }),
    advertiser.token,
    key(),
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  assert.equal(res.body.data!.status, 'pending_review');
  assert.equal(res.body.data!.spentCoins, 0);

  assert.equal(await coinBalance(advertiser.id), 3000, 'the budget left the wallet immediately');
});

test('two campaigns cannot be funded from the same coins', async () => {
  const advertiser = await registerUser();
  await giveCoins(advertiser.id, 1000);

  const first = await api('POST', '/api/v1/campaigns', campaignBody({ budgetCoins: 800 }), advertiser.token, key());
  assert.equal(first.status, 201);

  const second = await api(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ budgetCoins: 800 }),
    advertiser.token,
    key(),
  );
  assert.equal(second.status, 422);
  assert.equal(second.body.error?.code, 'insufficient_balance');
});

test('a retried creation funds one campaign', async () => {
  const advertiser = await registerUser();
  await giveCoins(advertiser.id, 5000);

  const headers = key();
  const body = campaignBody({ budgetCoins: 1000 });

  const first = await api<CampaignShape>('POST', '/api/v1/campaigns', body, advertiser.token, headers);
  const retry = await api<CampaignShape>('POST', '/api/v1/campaigns', body, advertiser.token, headers);

  assert.equal(retry.body.data!.id, first.body.data!.id);
  assert.equal(await coinBalance(advertiser.id), 4000, 'charged once');
});

test('a campaign below the minimum budget is refused', async () => {
  const advertiser = await registerUser();
  await giveCoins(advertiser.id, 5000);

  __setMemoForTesting({ 'ads.min_budget_coins': 500 });
  const res = await api('POST', '/api/v1/campaigns', campaignBody({ budgetCoins: 100 }), advertiser.token, key());
  __setMemoForTesting(null);

  assert.equal(res.status, 422);
  assert.equal(await coinBalance(advertiser.id), 5000, 'nothing was held');
});

// ── Refunds ──

test('stopping a campaign returns what it did not spend', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const created = await api<CampaignShape>(
    'POST', '/api/v1/campaigns', campaignBody({ budgetCoins: 1000 }), advertiser.token, key(),
  );
  const id = created.body.data!.id;
  assert.equal(await coinBalance(advertiser.id), 4000);

  await api('POST', `/api/v1/admin/campaigns/${id}`, { approve: true, note: 'Looks fine' }, admin.token);

  const stopped = await api<CampaignShape>(
    'POST', `/api/v1/campaigns/${id}/state`, { action: 'stop' }, advertiser.token,
  );
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body.error));
  assert.equal(stopped.body.data!.status, 'completed');
  assert.equal(await coinBalance(advertiser.id), 5000, 'nothing was delivered, so nothing was earned');
});

test('a rejected campaign is refunded in full', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const created = await api<CampaignShape>(
    'POST', '/api/v1/campaigns', campaignBody({ budgetCoins: 1500 }), advertiser.token, key(),
  );
  assert.equal(await coinBalance(advertiser.id), 3500);

  const rejected = await api<CampaignShape>(
    'POST',
    `/api/v1/admin/campaigns/${created.body.data!.id}`,
    { approve: false, note: 'Creative breaches the guidelines' },
    admin.token,
  );
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body.error));
  assert.equal(rejected.body.data!.status, 'rejected');
  assert.equal(await coinBalance(advertiser.id), 5000, 'the platform declined to run it');
});

test('a campaign is refunded once, not twice', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const created = await api<CampaignShape>(
    'POST', '/api/v1/campaigns', campaignBody({ budgetCoins: 1000 }), advertiser.token, key(),
  );
  const id = created.body.data!.id;

  await api('POST', `/api/v1/admin/campaigns/${id}`, { approve: true, note: 'Approved' }, admin.token);
  await api('POST', `/api/v1/campaigns/${id}/state`, { action: 'stop' }, advertiser.token);
  assert.equal(await coinBalance(advertiser.id), 5000);

  const again = await api('POST', `/api/v1/campaigns/${id}/state`, { action: 'stop' }, advertiser.token);
  assert.equal(again.status, 422);
  assert.equal(await coinBalance(advertiser.id), 5000, 'still refunded once');
});

// ── Charging for delivery ──

test('a replayed impression is not charged twice', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  const viewer = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const video = await makeVideo(advertiser.id);
  const created = await api<CampaignShape>(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ budgetCoins: 1000, videoId: video.publicId }),
    advertiser.token,
    key(),
  );
  await api(
    'POST', `/api/v1/admin/campaigns/${created.body.data!.id}`,
    { approve: true, note: 'Approved' }, admin.token,
  );

  const row = await queryOne<{ id: number }>('SELECT id FROM campaigns WHERE public_id = ?', [
    created.body.data!.id,
  ]);
  const campaignId = row!.id;
  const impressionId = 'imp-replay-1';

  const first = await delivery.chargeImpressions([
    { campaignId, userId: viewer.id, impressionId },
  ]);
  const replay = await delivery.chargeImpressions([
    { campaignId, userId: viewer.id, impressionId },
  ]);

  assert.equal(first.charged, 1);
  assert.equal(replay.charged, 0);
  assert.equal(replay.duplicates, 1);

  const spent = await queryOne<{ spent_coins: string | number }>(
    'SELECT spent_coins FROM campaigns WHERE id = ?',
    [campaignId],
  );
  assert.ok(Number(spent?.spent_coins) > 0);

  const impressions = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM campaign_impressions WHERE campaign_id = ?',
    [campaignId],
  );
  assert.equal(Number(impressions?.c), 1, 'one delivery, one row');
});

test('a campaign cannot outspend its budget', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const video = await makeVideo(advertiser.id);
  __setMemoForTesting({ 'ads.cost_per_impression': 40, 'ads.min_budget_coins': 1 });

  const created = await api<CampaignShape>(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ budgetCoins: 100, videoId: video.publicId }),
    advertiser.token,
    key(),
  );
  await api(
    'POST', `/api/v1/admin/campaigns/${created.body.data!.id}`,
    { approve: true, note: 'Approved' }, admin.token,
  );

  const row = await queryOne<{ id: number }>('SELECT id FROM campaigns WHERE public_id = ?', [
    created.body.data!.id,
  ]);
  const campaignId = row!.id;

  // Four impressions at 40 coins is 160 against a 100-coin budget.
  const viewers = [await registerUser(), await registerUser(), await registerUser(), await registerUser()];
  await delivery.chargeImpressions(
    viewers.map((v, i) => ({ campaignId, userId: v.id, impressionId: `imp-budget-${i}` })),
  );
  __setMemoForTesting(null);

  const spent = await queryOne<{ spent_coins: string | number; budget_coins: string | number }>(
    'SELECT spent_coins, budget_coins FROM campaigns WHERE id = ?',
    [campaignId],
  );
  assert.ok(
    Number(spent?.spent_coins) <= Number(spent?.budget_coins),
    `spent ${spent?.spent_coins} must not exceed budget ${spent?.budget_coins}`,
  );
});

test('a paused campaign is not delivered and costs nothing', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  const viewer = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const video = await makeVideo(advertiser.id);
  const created = await api<CampaignShape>(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ budgetCoins: 1000, videoId: video.publicId }),
    advertiser.token,
    key(),
  );
  const id = created.body.data!.id;
  await api('POST', `/api/v1/admin/campaigns/${id}`, { approve: true, note: 'Approved' }, admin.token);
  await api('POST', `/api/v1/campaigns/${id}/state`, { action: 'pause' }, advertiser.token);

  const eligible = await delivery.eligibleCampaigns({ userId: viewer.id });
  assert.ok(
    !eligible.some((c) => c.campaignPublicId === id),
    'a paused campaign is not selected',
  );

  const row = await queryOne<{ id: number }>('SELECT id FROM campaigns WHERE public_id = ?', [id]);
  const result = await delivery.chargeImpressions([
    { campaignId: row!.id, userId: viewer.id, impressionId: 'imp-paused' },
  ]);
  assert.equal(result.charged, 0, 'and is not charged even if a signal arrives');
});

// ── Targeting ──

test('an advertiser is never shown their own campaign', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const video = await makeVideo(advertiser.id);
  const created = await api<CampaignShape>(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ budgetCoins: 1000, videoId: video.publicId }),
    advertiser.token,
    key(),
  );
  await api(
    'POST', `/api/v1/admin/campaigns/${created.body.data!.id}`,
    { approve: true, note: 'Approved' }, admin.token,
  );

  const eligible = await delivery.eligibleCampaigns({ userId: advertiser.id });
  assert.ok(!eligible.some((c) => c.campaignPublicId === created.body.data!.id));
});

test('a campaign cannot target below the platform minimum age', async () => {
  const advertiser = await registerUser();
  await giveCoins(advertiser.id, 5000);

  const res = await api<CampaignShape>(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ targeting: { mode: 'custom', ageMin: 8, ageMax: 60 } }),
    advertiser.token,
    key(),
  );
  // Rejected by validation, and if it were not, the service floors it at 13.
  if (res.status === 201) {
    assert.ok((res.body.data!.targeting.ageMin ?? 13) >= 13);
  } else {
    assert.equal(res.status, 400);
  }
});

test('a blocked viewer is never shown that advertiser campaign', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  const viewer = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const video = await makeVideo(advertiser.id);
  const created = await api<CampaignShape>(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ budgetCoins: 1000, videoId: video.publicId }),
    advertiser.token,
    key(),
  );
  await api(
    'POST', `/api/v1/admin/campaigns/${created.body.data!.id}`,
    { approve: true, note: 'Approved' }, admin.token,
  );

  await api('POST', `/api/v1/users/${advertiser.publicId}/block`, {}, viewer.token);

  const eligible = await delivery.eligibleCampaigns({ userId: viewer.id });
  assert.ok(
    !eligible.some((c) => c.campaignPublicId === created.body.data!.id),
    'money does not buy past a block',
  );
});

test('only a published public video can be promoted', async () => {
  const advertiser = await registerUser();
  await giveCoins(advertiser.id, 5000);

  const publicId = rid();
  await execute(
    `INSERT INTO videos (public_id, user_id, caption, duration_sec, privacy, status, processing_status)
     VALUES (:publicId, :userId, 'private test', 30, 'private', 'published', 'complete')`,
    { publicId, userId: advertiser.id },
  );

  const res = await api(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ videoId: publicId }),
    advertiser.token,
    key(),
  );
  assert.equal(res.status, 400, 'promoting a private video would show it to people it excluded');
  assert.equal(await coinBalance(advertiser.id), 5000);
});

test('you cannot promote a video you do not own', async () => {
  const advertiser = await registerUser();
  const other = await registerUser();
  await giveCoins(advertiser.id, 5000);

  const video = await makeVideo(other.id);
  const res = await api(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ videoId: video.publicId }),
    advertiser.token,
    key(),
  );
  assert.equal(res.status, 403);
});

// ── Placement ──

test('promoted items never take the first slot', () => {
  const organic = Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, promoted: false }));
  const promoted = [
    { id: 'a1', promoted: true },
    { id: 'a2', promoted: true },
  ];

  const blended = delivery.blend(organic, promoted);

  assert.equal(blended[0]!.promoted, false, 'the app never opens on an advertisement');
  assert.equal(blended.length, organic.length + promoted.length);
});

test('density is a ceiling, not a target', async () => {
  __setMemoForTesting({ 'ads.feed_density': 0.15 });
  const slots = await delivery.promotedSlotCount(20);
  __setMemoForTesting(null);

  assert.equal(slots, 3, '15% of a 20-item page');

  __setMemoForTesting({ 'ads.feed_density': 0 });
  const none = await delivery.promotedSlotCount(20);
  __setMemoForTesting(null);
  assert.equal(none, 0, 'an operator can turn promotion off entirely');
});

test('an absurd density is clamped', async () => {
  __setMemoForTesting({ 'ads.feed_density': 5 });
  const slots = await delivery.promotedSlotCount(20);
  __setMemoForTesting(null);

  assert.ok(slots <= 10, 'a misconfiguration cannot make the whole feed advertisements');
});

// ── Reporting ──

test('metrics count what happened, and nothing else', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  const viewer = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const video = await makeVideo(advertiser.id);
  const created = await api<CampaignShape>(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ budgetCoins: 1000, videoId: video.publicId, objective: 'video_views' }),
    advertiser.token,
    key(),
  );
  const publicId = created.body.data!.id;
  await api('POST', `/api/v1/admin/campaigns/${publicId}`, { approve: true, note: 'Approved' }, admin.token);

  const row = await queryOne<{ id: number }>('SELECT id FROM campaigns WHERE public_id = ?', [publicId]);
  const campaignId = row!.id;

  // Before any delivery, every number is zero. Nothing is projected.
  const before = await api<{ impressions: number; views: number; costPerView?: number }>(
    'GET', `/api/v1/campaigns/${publicId}/metrics`, undefined, advertiser.token,
  );
  assert.equal(before.body.data!.impressions, 0);
  assert.equal(before.body.data!.views, 0);
  assert.equal(before.body.data!.costPerView, undefined, 'unknown is not reported as free');

  await delivery.chargeImpressions([
    { campaignId, userId: viewer.id, impressionId: 'imp-metrics-1' },
  ]);
  await delivery.recordView(campaignId, viewer.id, 'imp-metrics-1');

  const after = await api<{ impressions: number; views: number; costPerView?: number }>(
    'GET', `/api/v1/campaigns/${publicId}/metrics`, undefined, advertiser.token,
  );
  assert.equal(after.body.data!.impressions, 1);
  assert.equal(after.body.data!.views, 1);
  assert.ok((after.body.data!.costPerView ?? 0) > 0);
});

test('a rewatch does not charge for the view twice', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  const viewer = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const video = await makeVideo(advertiser.id);
  const created = await api<CampaignShape>(
    'POST',
    '/api/v1/campaigns',
    campaignBody({ budgetCoins: 1000, videoId: video.publicId, objective: 'video_views' }),
    advertiser.token,
    key(),
  );
  await api(
    'POST', `/api/v1/admin/campaigns/${created.body.data!.id}`,
    { approve: true, note: 'Approved' }, admin.token,
  );

  const row = await queryOne<{ id: number }>('SELECT id FROM campaigns WHERE public_id = ?', [
    created.body.data!.id,
  ]);
  const campaignId = row!.id;

  await delivery.chargeImpressions([
    { campaignId, userId: viewer.id, impressionId: 'imp-rewatch' },
  ]);
  const first = await delivery.recordView(campaignId, viewer.id, 'imp-rewatch');
  const second = await delivery.recordView(campaignId, viewer.id, 'imp-rewatch');

  assert.equal(first.charged, true);
  assert.equal(second.charged, false, 'the same delivery is paid for once');
});

test('an estimate is a range with a caveat, not a promise', async () => {
  const advertiser = await registerUser();

  const res = await api<{
    estimatedReachMin: number;
    estimatedReachMax: number;
    disclaimer: string;
  }>(
    'POST',
    '/api/v1/campaigns/estimate',
    { budgetCoins: 1000, durationDays: 7, targeting: { mode: 'broad' } },
    advertiser.token,
  );

  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.ok(res.body.data!.estimatedReachMax > res.body.data!.estimatedReachMin);
  assert.ok(res.body.data!.disclaimer.length > 40, 'the caveat is shown, not implied');
  assert.ok(
    res.body.data!.disclaimer.includes('distribution'),
    'and it says what promotion actually buys',
  );
});

// ── Expiry ──

test('an expired campaign completes and refunds', async () => {
  const advertiser = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  await giveCoins(advertiser.id, 5000);

  const created = await api<CampaignShape>(
    'POST', '/api/v1/campaigns', campaignBody({ budgetCoins: 1000 }), advertiser.token, key(),
  );
  await api(
    'POST', `/api/v1/admin/campaigns/${created.body.data!.id}`,
    { approve: true, note: 'Approved' }, admin.token,
  );

  await execute(
    'UPDATE campaigns SET ends_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY) WHERE public_id = ?',
    [created.body.data!.id],
  );

  const result = await campaignsService.expireCampaigns();
  assert.ok(result.completed >= 1);
  assert.equal(await coinBalance(advertiser.id), 5000, 'unspent budget comes back');
});
