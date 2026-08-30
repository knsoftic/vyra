/**
 * Creator analytics.
 *
 * What must be true:
 *   1. a new creator sees zeros and nulls, never a plausible-looking chart
 *   2. every figure is a count of rows that exist, not an estimate
 *   3. a rate with no denominator is null — "nobody watched yet" and
 *      "everyone left immediately" are different statements
 *   4. percentages add up to 100
 *   5. nobody can read anyone else's analytics
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';

process.env.RATE_LIMIT_ENABLED = 'false';
process.env.NODE_ENV = 'development';

const { createApp } = await import('../src/app.ts');
const { pool, execute, queryOne } = await import('../src/core/db.ts');
const { closeRedis } = await import('../src/core/redis.ts');

let server: Server;
let base = '';
const createdEmails: string[] = [];
const createdVideoIds: number[] = [];

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
): Promise<{ status: number; body: Envelope<T> }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Envelope<T> };
}

interface Session {
  user: { id: string };
  tokens: { accessToken: string };
}

async function registerUser(): Promise<{ token: string; dbId: number; email: string }> {
  const tag = randomBytes(5).toString('hex');
  const email = `analytics_${tag}@vyra.test`;
  createdEmails.push(email);
  const res = await api<Session>('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username: `analytics_${tag}`,
    birthdate: '1995-04-12',
    device: { deviceId: `analytics-${tag}`, platform: 'web' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return { token: res.body.data!.tokens.accessToken, dbId: row!.id, email };
}

async function makeVideo(authorId: number, views = 0): Promise<number> {
  const { ulid } = await import('ulid');
  const result = await execute(
    `INSERT INTO videos (public_id, user_id, caption, duration_sec, privacy, status,
                         processing_status, view_count, published_at)
     VALUES (:publicId, :userId, 'analytics test', 30, 'public', 'published',
             'complete', :views, NOW(3))`,
    { publicId: ulid(), userId: authorId, views },
  );
  createdVideoIds.push(result.insertId);
  return result.insertId;
}

/** One watch, recorded the way the behaviour pipeline records it. */
async function recordWatch(
  viewerId: number,
  videoId: number,
  creatorId: number,
  opts: { watchMs: number; completed?: boolean; rewatched?: boolean; source?: string } ,
): Promise<void> {
  await execute(
    `INSERT INTO watch_events
       (user_id, video_id, creator_id, session_id, feed_source, watch_ms, video_ms,
        completion_rate, reached_2s, completed, rewatched, dedupe_key)
     VALUES (:userId, :videoId, :creatorId, :sessionId, :source, :watchMs, 30000,
             :rate, 1, :completed, :rewatched, :dedupeKey)`,
    {
      userId: viewerId,
      videoId,
      creatorId,
      sessionId: randomBytes(13).toString('hex'),
      source: opts.source ?? 'for_you',
      watchMs: opts.watchMs,
      rate: Math.min(1, opts.watchMs / 30000).toFixed(4),
      completed: opts.completed ? 1 : 0,
      rewatched: opts.rewatched ? 1 : 0,
      dedupeKey: randomBytes(16).toString('hex'),
    },
  );
}

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  for (const id of createdVideoIds) {
    await execute('DELETE FROM watch_events WHERE video_id = ?', [id]).catch(() => undefined);
    await execute('DELETE FROM videos WHERE id = ?', [id]).catch(() => undefined);
  }
  for (const email of createdEmails) {
    const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]).catch(() => null);
    if (!user) continue;
    for (const sql of [
      'DELETE FROM watch_events WHERE user_id=? OR creator_id=?',
      'DELETE FROM behaviour_events WHERE user_id=? OR creator_id=?',
      'DELETE FROM follows WHERE follower_id=? OR followee_id=?',
      'DELETE FROM notifications WHERE user_id=? OR actor_id=?',
      'DELETE FROM security_events WHERE user_id=?',
      'DELETE FROM user_sessions WHERE user_id=?',
      'DELETE FROM user_devices WHERE user_id=?',
      'DELETE FROM login_attempts WHERE user_id=?',
      'DELETE FROM referral_codes WHERE user_id=?',
      'DELETE FROM wallets WHERE user_id=?',
      'DELETE FROM user_profiles WHERE user_id=?',
      'DELETE FROM users WHERE id=?',
    ]) {
      const params = (sql.match(/\?/g) ?? []).map(() => user.id);
      await execute(sql, params).catch(() => undefined);
    }
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  await closeRedis();
});

interface Analytics {
  days: number;
  followers: number;
  followerGrowth: number;
  views: number;
  likes: number;
  watchTimeHours: number;
  avgWatchSeconds: number | null;
  completionRate: number | null;
  rewatchRate: number | null;
  viewsSeries: { day: string; value: number }[];
  followerSeries: { day: string; value: number }[];
  categories: { label: string; percent: number }[];
  sources: { label: string; percent: number }[];
  topVideos: unknown[];
  hasNoVideos: boolean;
}

test('a brand-new creator sees zeros and nulls, not a plausible chart', async () => {
  const creator = await registerUser();

  const res = await api<Analytics>('GET', '/api/v1/me/analytics', undefined, creator.token);
  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  const a = res.body.data!;

  assert.equal(a.followers, 0);
  assert.equal(a.views, 0);
  assert.equal(a.likes, 0);
  assert.equal(a.watchTimeHours, 0);
  assert.equal(a.hasNoVideos, true, 'and it says so plainly');

  // The distinction that matters: nobody has watched yet, which is not the
  // same as everybody leaving immediately.
  assert.equal(a.avgWatchSeconds, null);
  assert.equal(a.completionRate, null);
  assert.equal(a.rewatchRate, null);

  assert.deepEqual(a.topVideos, []);
  assert.deepEqual(a.categories, []);
  assert.deepEqual(a.sources, []);

  // The series still spans the window, filled with real zeros.
  assert.equal(a.viewsSeries.length, a.days);
  assert.ok(a.viewsSeries.every((p) => p.value === 0));
});

test('every figure is a count of rows that exist', async () => {
  const creator = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(creator.dbId, 3);

  await recordWatch(viewer.dbId, video, creator.dbId, { watchMs: 30000, completed: true });
  await recordWatch(viewer.dbId, video, creator.dbId, { watchMs: 15000 });
  await recordWatch(viewer.dbId, video, creator.dbId, { watchMs: 9000, rewatched: true });

  const res = await api<Analytics>('GET', '/api/v1/me/analytics', undefined, creator.token);
  const a = res.body.data!;

  // 30000 + 15000 + 9000 = 54000ms = 0.015 hours, rounded to one decimal = 0
  assert.equal(a.watchTimeHours, 0, 'small numbers round honestly rather than being inflated');
  // 54000 / 3 / 1000 = 18 seconds
  assert.equal(a.avgWatchSeconds, 18);
  // one completion in three watches
  assert.equal(a.completionRate, 33.3);
  assert.equal(a.rewatchRate, 33.3);
  assert.equal(a.views, 3, 'from the video\'s own counter');
  assert.equal(a.hasNoVideos, false);
  assert.equal(a.topVideos.length, 1);
});

test('follower growth counts follows inside the window', async () => {
  const creator = await registerUser();
  const fan = await registerUser();

  const before = await api<Analytics>('GET', '/api/v1/me/analytics', undefined, creator.token);
  assert.equal(before.body.data!.followerGrowth, 0);

  await execute(
    'INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)',
    [fan.dbId, creator.dbId],
  );

  const after = await api<Analytics>('GET', '/api/v1/me/analytics', undefined, creator.token);
  assert.equal(after.body.data!.followerGrowth, 1);
  assert.ok(
    after.body.data!.followerSeries.some((p) => p.value === 1),
    'and it lands on a day in the series',
  );
});

test('traffic sources add up to 100', async () => {
  const creator = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(creator.dbId);

  // A deliberately awkward split: thirds do not divide into whole percentages.
  await recordWatch(viewer.dbId, video, creator.dbId, { watchMs: 5000, source: 'for_you' });
  await recordWatch(viewer.dbId, video, creator.dbId, { watchMs: 5000, source: 'search' });
  await recordWatch(viewer.dbId, video, creator.dbId, { watchMs: 5000, source: 'profile' });

  const res = await api<Analytics>('GET', '/api/v1/me/analytics', undefined, creator.token);
  const total = res.body.data!.sources.reduce((sum, s) => sum + s.percent, 0);
  assert.equal(total, 100, 'a column that reads 97% is a bug the reader has to notice');

  assert.ok(res.body.data!.sources.some((s) => s.label === 'For You'), 'sources are named for people');
});

test('the window is respected and bounded', async () => {
  const creator = await registerUser();

  const short = await api<Analytics>('GET', '/api/v1/me/analytics?days=7', undefined, creator.token);
  assert.equal(short.body.data!.days, 7);
  assert.equal(short.body.data!.viewsSeries.length, 7);

  const silly = await api('GET', '/api/v1/me/analytics?days=9999', undefined, creator.token);
  assert.equal(silly.status, 400, 'an unbounded window is refused, not silently clamped');
});

test('analytics are your own, and only yours', async () => {
  const creator = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(creator.dbId, 100);
  await recordWatch(viewer.dbId, video, creator.dbId, { watchMs: 20000 });

  // There is no route for reading someone else's — the only endpoint is /me.
  const mine = await api<Analytics>('GET', '/api/v1/me/analytics', undefined, viewer.token);
  assert.equal(mine.body.data!.views, 0, "another account's watches are not mine");
  assert.equal(mine.body.data!.hasNoVideos, true);

  const anonymous = await api('GET', '/api/v1/me/analytics');
  assert.equal(anonymous.status, 401);
});

test('business analytics report campaign spend and reach', async () => {
  const business = await registerUser();

  const res = await api<{ adSpendCoins: number; campaignsRunning: number; days: number }>(
    'GET', '/api/v1/me/analytics/business', undefined, business.token,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.equal(res.body.data!.adSpendCoins, 0);
  assert.equal(res.body.data!.campaignsRunning, 0);
  assert.equal(res.body.data!.days, 28);
});
