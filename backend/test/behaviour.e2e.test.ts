/**
 * Behaviour intelligence end-to-end, against the real database.
 *
 * Covers the Phase 6 exit criteria:
 *   1. every event persisted exactly once under retry
 *   2. interest profiles shift within a session and stabilise over time
 *   3. negative signals measurably reduce exposure
 *   4. creator affinity computed and queryable
 *   5. event payloads carry no sensitive fields
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
const profiles = await import('../src/modules/behaviour/profiles.service.ts');

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

async function registerUser(): Promise<{ token: string; publicId: string; id: number }> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `p6_${suffix}@vyra.test`;
  createdEmails.push(email);
  const res = await api<Session>('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username: `p6_${suffix}`,
    birthdate: '1995-04-12',
    device: { deviceId: `dev-p6-${suffix}`, platform: 'web' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return { token: res.body.data!.tokens.accessToken, publicId: res.body.data!.user.id, id: row!.id };
}

const rid = () => `V${Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(25, '0')}`;

async function makeVideo(userId: number, categorySlug: string): Promise<{ id: number; publicId: string }> {
  const category = await queryOne<{ id: number }>(
    'SELECT id FROM categories WHERE slug = ?', [categorySlug],
  );
  const publicId = rid();
  const result = await execute(
    `INSERT INTO videos (public_id, user_id, category_id, caption, duration_sec, privacy, status)
     VALUES (:publicId, :userId, :categoryId, 'behaviour test', 30, 'public', 'published')`,
    { publicId, userId, categoryId: category?.id ?? null },
  );
  createdVideoIds.push(result.insertId);
  return { id: result.insertId, publicId };
}

const event = (over: Record<string, unknown> = {}) => ({
  event: 'like',
  dedupeKey: randomUUID(),
  occurredAt: new Date().toISOString(),
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
    for (const email of createdEmails) {
      const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
      if (!user) continue;
      const id = user.id;
      await execute('DELETE FROM behaviour_events WHERE user_id = ?', [id]);
      await execute('DELETE FROM watch_events WHERE user_id = ? OR creator_id = ?', [id, id]);
      await execute('DELETE FROM negative_signals WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_interest_profiles WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_segments WHERE user_id = ?', [id]);
      await execute('DELETE FROM creator_affinity WHERE user_id = ? OR creator_id = ?', [id, id]);
      await execute('DELETE FROM profile_rebuild_queue WHERE user_id = ?', [id]);
      await execute(
        'DELETE p FROM video_audience_profiles p JOIN videos v ON v.id = p.video_id WHERE v.user_id = ?',
        [id],
      );
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
      await execute('DELETE FROM user_profiles WHERE user_id = ?', [id]);
      await execute('DELETE FROM users WHERE id = ?', [id]);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await closeRedis();
  }
});

// ── Exit criterion 1: exactly once ──

test('an event is stored once', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id, 'gaming');

  const res = await api<{ accepted: number; duplicates: number }>(
    'POST', '/api/v1/events',
    { events: [event({ videoId: video.publicId })] },
    user.token,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.equal(res.body.data!.accepted, 1);
  assert.equal(res.body.data!.duplicates, 0);
});

test('replaying the same batch stores nothing extra', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id, 'gaming');
  const batch = { events: [event({ videoId: video.publicId }), event({ videoId: video.publicId })] };

  const first = await api<{ accepted: number; duplicates: number }>(
    'POST', '/api/v1/events', batch, user.token);
  assert.equal(first.body.data!.accepted, 2);

  // The client never saw the response and retried — the common mobile case.
  const retry = await api<{ accepted: number; duplicates: number }>(
    'POST', '/api/v1/events', batch, user.token);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data!.accepted, 0, 'a retry must not store anything new');
  assert.equal(retry.body.data!.duplicates, 2, 'duplicates are expected, not errors');

  const rows = await query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM behaviour_events WHERE user_id = ?', [user.id]);
  assert.equal(Number(rows[0]!.n), 2, 'exactly two rows should exist');
});

test('retrying many times still yields one row per event', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id, 'gaming');
  const one = event({ videoId: video.publicId, event: 'save' });

  for (let i = 0; i < 5; i += 1) {
    await api('POST', '/api/v1/events', { events: [one] }, user.token);
  }

  const rows = await query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM behaviour_events WHERE user_id = ? AND event = 'save'", [user.id]);
  assert.equal(Number(rows[0]!.n), 1);
});

test('concurrent delivery of the same event still stores it once', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id, 'gaming');
  const one = event({ videoId: video.publicId, event: 'share' });

  // Two devices, or a retry racing the original.
  await Promise.all(
    Array.from({ length: 5 }, () =>
      api('POST', '/api/v1/events', { events: [one] }, user.token)),
  );

  const rows = await query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM behaviour_events WHERE user_id = ? AND event = 'share'", [user.id]);
  assert.equal(Number(rows[0]!.n), 1, 'the unique index must hold under concurrency');
});

test('a watch event is deduplicated too', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id, 'gaming');
  const watch = event({
    event: 'completion', videoId: video.publicId, watchMs: 28_000, videoMs: 30_000,
  });

  await api('POST', '/api/v1/events', { events: [watch] }, user.token);
  const retry = await api<{ duplicates: number }>(
    'POST', '/api/v1/events', { events: [watch] }, user.token);
  assert.equal(retry.body.data!.duplicates, 1);

  const rows = await query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM watch_events WHERE user_id = ?', [user.id]);
  assert.equal(Number(rows[0]!.n), 1);
});

test('the watch rule is applied server-side, not taken from the client', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id, 'gaming');

  await api('POST', '/api/v1/events', {
    events: [event({ event: 'watch_20s', videoId: video.publicId, watchMs: 25_000, videoMs: 30_000 })],
  }, user.token);

  const row = await queryOne<{
    completion_rate: string; reached_20s: number; reached_30s: number; completed: number;
  }>('SELECT completion_rate, reached_20s, reached_30s, completed FROM watch_events WHERE user_id = ?',
    [user.id]);

  assert.ok(row);
  assert.equal(Number(row.reached_20s), 1);
  assert.equal(Number(row.reached_30s), 0);
  assert.ok(Math.abs(Number(row.completion_rate) - 0.8333) < 0.001);
});

test('an event dated far in the future is rejected', async () => {
  const user = await registerUser();
  const future = new Date(Date.now() + 90 * 86_400_000).toISOString();

  const res = await api<{ accepted: number; rejected: { reason: string }[] }>(
    'POST', '/api/v1/events', { events: [event({ occurredAt: future })] }, user.token);
  assert.equal(res.body.data!.accepted, 0);
  assert.match(res.body.data!.rejected[0]!.reason, /too far from the current time/);
});

test('one bad event does not lose the rest of the batch', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id, 'gaming');

  const res = await api<{ accepted: number; rejected: unknown[] }>('POST', '/api/v1/events', {
    events: [
      event({ videoId: video.publicId }),
      event({ occurredAt: 'not-a-date' }),
      event({ videoId: video.publicId, event: 'save' }),
    ],
  }, user.token);

  assert.equal(res.body.data!.accepted, 2, 'the good events should still land');
  assert.equal(res.body.data!.rejected.length, 1);
});

// ── Exit criterion 5: no sensitive fields ──

test('an event carrying a sensitive field is refused', async () => {
  const user = await registerUser();

  for (const field of ['email', 'latitude', 'contacts', 'advertisingId', 'religion']) {
    const res = await api<unknown>(
      'POST', '/api/v1/events',
      { events: [{ ...event(), [field]: 'value' }] },
      user.token,
    );
    // The whole batch is refused, loudly. Silently stripping the field would
    // protect the data but hide a client that is trying to send it.
    assert.equal(res.status, 400, `"${field}" should have been refused`);
    assert.match(res.body.error!.message, /must never carry these fields/);
  }

  const stored = await query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM behaviour_events WHERE user_id = ?', [user.id]);
  assert.equal(Number(stored[0]!.n), 0, 'nothing from a rejected batch may be stored');
});

test('nothing sensitive is ever stored in an event row', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id, 'gaming');

  await api('POST', '/api/v1/events', {
    events: [event({ videoId: video.publicId, event: 'search', query: 'reach me at a@b.com or 555 123 4567' })],
  }, user.token);

  const rows = await query<{ detail: string | null }>(
    'SELECT detail FROM behaviour_events WHERE user_id = ?', [user.id]);

  for (const row of rows) {
    const detail = String(row.detail ?? '');
    assert.ok(!detail.includes('a@b.com'), 'an email address reached the event log');
    assert.ok(!/555.?123.?4567/.test(detail), 'a phone number reached the event log');
  }
});

test('a full audit of stored events finds no sensitive fields', async () => {
  const { auditStoredDetail } = await import('../src/modules/behaviour/privacy.ts');
  const rows = await query<{ detail: string | null }>(
    'SELECT detail FROM behaviour_events WHERE detail IS NOT NULL LIMIT 500');

  for (const row of rows) {
    const verdict = auditStoredDetail(row.detail);
    assert.equal(verdict.ok, true, `stored detail contained ${verdict.forbidden.join(', ')}`);
  }
});

// ── Exit criterion 2: profiles shift, then stabilise ──

test('interest shifts within a session toward what is being watched', async () => {
  const user = await registerUser();
  const creator = await registerUser();
  const gaming = await makeVideo(creator.id, 'gaming');
  const cooking = await makeVideo(creator.id, 'food');

  // A session spent on gaming.
  const events = [];
  for (let i = 0; i < 8; i += 1) {
    events.push(event({
      event: 'completion', videoId: gaming.publicId, watchMs: 29_000, videoMs: 30_000,
    }));
  }
  events.push(event({ event: 'like', videoId: gaming.publicId }));
  events.push(event({ event: 'quick_skip', videoId: cooking.publicId, watchMs: 600, videoMs: 30_000 }));

  await api('POST', '/api/v1/events', { events }, user.token);
  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);

  const res = await api<{ short: Record<string, number>; combined: Record<string, number> }>(
    'GET', '/api/v1/me/interests', undefined, user.token);
  assert.equal(res.status, 200);

  const combined = res.body.data!.combined;
  assert.ok((combined.gaming ?? 0) > 0, `gaming should be positive, got ${JSON.stringify(combined)}`);
  assert.ok(
    (combined.gaming ?? 0) > (combined.food ?? 0),
    'the watched topic should outrank the skipped one',
  );
});

test('the short horizon reacts more than the long horizon', async () => {
  const user = await registerUser();
  const creator = await registerUser();
  const video = await makeVideo(creator.id, 'technology');

  const events = Array.from({ length: 6 }, () =>
    event({ event: 'completion', videoId: video.publicId, watchMs: 29_000, videoMs: 30_000 }));
  await api('POST', '/api/v1/events', { events }, user.token);
  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);

  const res = await api<{ short: Record<string, number>; long: Record<string, number> }>(
    'GET', '/api/v1/me/interests', undefined, user.token);

  const short = res.body.data!.short.technology ?? 0;
  const long = res.body.data!.long.technology ?? 0;
  assert.ok(short > 0 && long > 0, 'both horizons should register the interest');
  assert.ok(short >= long, 'a burst of recent activity should register at least as strongly short-term');
});

test('rebuilding twice with no new signals gives the same profile', async () => {
  const user = await registerUser();
  const creator = await registerUser();
  const video = await makeVideo(creator.id, 'sports');

  await api('POST', '/api/v1/events', {
    events: [event({ event: 'like', videoId: video.publicId })],
  }, user.token);

  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);
  const first = await api<{ combined: Record<string, number> }>(
    'GET', '/api/v1/me/interests', undefined, user.token);

  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);
  const second = await api<{ combined: Record<string, number> }>(
    'GET', '/api/v1/me/interests', undefined, user.token);

  assert.deepEqual(
    second.body.data!.combined, first.body.data!.combined,
    'a profile must be stable when nothing has changed — it is rebuilt, not accumulated',
  );
});

// ── Exit criterion 3: negative signals reduce exposure ──

test('an explicit rejection pushes a topic below an untouched one', async () => {
  const user = await registerUser();
  const creator = await registerUser();
  const rejected = await makeVideo(creator.id, 'beauty');
  const neutral = await makeVideo(creator.id, 'travel');

  await api('POST', '/api/v1/events', {
    events: [
      event({ event: 'not_interested', videoId: rejected.publicId }),
      event({ event: 'impression', videoId: neutral.publicId }),
    ],
  }, user.token);
  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);

  const res = await api<{ combined: Record<string, number> }>(
    'GET', '/api/v1/me/interests', undefined, user.token);
  const combined = res.body.data!.combined;

  assert.ok(
    (combined.beauty ?? 0) < 0,
    `an explicitly rejected topic should go negative, got ${combined.beauty}`,
  );
  assert.ok((combined.beauty ?? 0) < (combined.travel ?? 0));
});

test('a rejection outweighs prior positive watching', async () => {
  const user = await registerUser();
  const creator = await registerUser();
  const video = await makeVideo(creator.id, 'fashion');

  const watching = Array.from({ length: 3 }, () =>
    event({ event: 'completion', videoId: video.publicId, watchMs: 29_000, videoMs: 30_000 }));
  await api('POST', '/api/v1/events', { events: watching }, user.token);
  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);

  const before = await api<{ combined: Record<string, number> }>(
    'GET', '/api/v1/me/interests', undefined, user.token);
  const positive = before.body.data!.combined.fashion ?? 0;
  assert.ok(positive > 0);

  await api('POST', '/api/v1/events', {
    events: [event({ event: 'not_interested', videoId: video.publicId })],
  }, user.token);
  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);

  const after = await api<{ combined: Record<string, number> }>(
    'GET', '/api/v1/me/interests', undefined, user.token);
  const afterValue = after.body.data!.combined.fashion ?? 0;

  assert.ok(
    afterValue < positive,
    `saying "not interested" must reduce exposure: ${positive} → ${afterValue}`,
  );
});

test('a rejection is recorded as a negative signal for suppression', async () => {
  const user = await registerUser();
  const creator = await registerUser();
  const video = await makeVideo(creator.id, 'comedy');

  await api('POST', '/api/v1/events', {
    events: [event({ event: 'hide_creator', videoId: video.publicId, creatorId: creator.publicId })],
  }, user.token);

  const rows = await query<{ kind: string; creator_id: number }>(
    'SELECT kind, creator_id FROM negative_signals WHERE user_id = ?', [user.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, 'hide_creator');

  const hidden = await profiles.hiddenCreators(user.id);
  assert.ok(hidden.includes(creator.id), 'a hidden creator must be queryable for suppression');
});

test('a quick skip is recorded as negative without the user pressing anything', async () => {
  const user = await registerUser();
  const creator = await registerUser();
  const video = await makeVideo(creator.id, 'art');

  await api('POST', '/api/v1/events', {
    events: [event({ event: 'quick_skip', videoId: video.publicId, watchMs: 500, videoMs: 30_000 })],
  }, user.token);

  const rows = await query<{ kind: string }>(
    "SELECT kind FROM negative_signals WHERE user_id = ? AND kind = 'quick_skip'", [user.id]);
  assert.equal(rows.length, 1);
});

// ── Exit criterion 4: creator affinity ──

test('creator affinity is computed and queryable', async () => {
  const user = await registerUser();
  const liked = await registerUser();
  const ignored = await registerUser();
  const likedVideo = await makeVideo(liked.id, 'music');
  const ignoredVideo = await makeVideo(ignored.id, 'music');

  await api('POST', '/api/v1/events', {
    events: [
      event({ event: 'follow', videoId: likedVideo.publicId, creatorId: liked.publicId }),
      event({ event: 'like', videoId: likedVideo.publicId, creatorId: liked.publicId }),
      event({ event: 'save', videoId: likedVideo.publicId, creatorId: liked.publicId }),
      event({ event: 'impression', videoId: ignoredVideo.publicId, creatorId: ignored.publicId }),
    ],
  }, user.token);
  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);

  const res = await api<{ creatorId: string; score: number }[]>(
    'GET', '/api/v1/me/creator-affinity', undefined, user.token);
  assert.equal(res.status, 200);

  const forLiked = res.body.data!.find((a) => a.creatorId === liked.publicId);
  assert.ok(forLiked, 'the engaged-with creator should appear');
  assert.ok(forLiked.score > 0, `expected a positive score, got ${forLiked.score}`);

  const forIgnored = res.body.data!.find((a) => a.creatorId === ignored.publicId);
  assert.ok(
    !forIgnored || forIgnored.score < forLiked.score,
    'a creator merely seen should score below one followed and saved',
  );
});

test('hiding a creator drives affinity negative', async () => {
  const user = await registerUser();
  const creator = await registerUser();
  const video = await makeVideo(creator.id, 'pets');

  await api('POST', '/api/v1/events', {
    events: [
      event({ event: 'like', videoId: video.publicId, creatorId: creator.publicId }),
      event({ event: 'hide_creator', videoId: video.publicId, creatorId: creator.publicId }),
    ],
  }, user.token);
  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);

  const affinity = await queryOne<{ score: string }>(
    'SELECT score FROM creator_affinity WHERE user_id = ? AND creator_id = ?',
    [user.id, creator.id]);
  assert.ok(affinity);
  assert.ok(Number(affinity.score) < 0, `expected a negative score, got ${affinity.score}`);
});

// ── Segments ──

test('a user joins multiple segments at once', async () => {
  const user = await registerUser();
  const creator = await registerUser();
  const gaming = await makeVideo(creator.id, 'gaming');
  const tech = await makeVideo(creator.id, 'technology');

  await api('POST', '/api/v1/events', {
    events: [
      event({ event: 'like', videoId: gaming.publicId }),
      event({ event: 'save', videoId: gaming.publicId }),
      event({ event: 'like', videoId: tech.publicId }),
      event({ event: 'save', videoId: tech.publicId }),
    ],
  }, user.token);
  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);

  const res = await api<{ slug: string; weight: number }[]>(
    'GET', '/api/v1/me/segments', undefined, user.token);
  const slugs = res.body.data!.map((s) => s.slug);

  assert.ok(slugs.includes('gaming'));
  assert.ok(slugs.includes('technology'));
  assert.ok(slugs.length >= 2, 'segments are not mutually exclusive');
});

test('segment membership lapses when the interest stops', async () => {
  const user = await registerUser();
  const creator = await registerUser();
  const video = await makeVideo(creator.id, 'diy');

  await api('POST', '/api/v1/events', {
    events: [event({ event: 'save', videoId: video.publicId })],
  }, user.token);
  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);

  const joined = await api<{ slug: string }[]>('GET', '/api/v1/me/segments', undefined, user.token);
  assert.ok(joined.body.data!.some((s) => s.slug === 'diy'));

  // Age every signal well past the short half-life and remove the interest.
  await execute('DELETE FROM behaviour_events WHERE user_id = ?', [user.id]);
  await api('POST', '/api/v1/me/interests/rebuild', {}, user.token);

  const left = await api<{ slug: string }[]>('GET', '/api/v1/me/segments', undefined, user.token);
  assert.ok(
    !left.body.data!.some((s) => s.slug === 'diy'),
    'a user must not stay filed under a segment they no longer engage with',
  );
});

// ── Priority audience ──

test('priority audience is ordered, and nobody appears twice', async () => {
  const creator = await registerUser();
  const follower = await registerUser();
  const liker = await registerUser();
  const video = await makeVideo(creator.id, 'travel');

  await api('POST', `/api/v1/users/${creator.publicId}/follow`, undefined, follower.token);
  // The follower also likes, to prove tiers do not double-count.
  await api('POST', '/api/v1/events', {
    events: [event({ event: 'like', videoId: video.publicId, creatorId: creator.publicId })],
  }, follower.token);
  await api('POST', '/api/v1/events', {
    events: [event({ event: 'like', videoId: video.publicId, creatorId: creator.publicId })],
  }, liker.token);

  const audience = await profiles.priorityAudience(creator.id);
  assert.ok(audience.length > 0);

  const followerTier = audience.find((t) => t.tier === 'followers');
  assert.ok(followerTier?.userIds.includes(String(follower.id)), 'the follower should be first tier');

  const seen = audience.flatMap((t) => t.userIds);
  assert.equal(new Set(seen).size, seen.length, 'a user must appear in only one tier');

  const likerTier = audience.find((t) => t.tier === 'previous_likers');
  assert.ok(
    !likerTier || !likerTier.userIds.includes(String(follower.id)),
    'someone already counted as a follower must not reappear as a liker',
  );
  assert.ok(likerTier?.userIds.includes(String(liker.id)));
});

test('a blocked user is excluded from the priority audience', async () => {
  const creator = await registerUser();
  const blocked = await registerUser();
  await makeVideo(creator.id, 'food');

  await api('POST', `/api/v1/users/${creator.publicId}/follow`, undefined, blocked.token);
  await api('POST', `/api/v1/users/${blocked.publicId}/block`, undefined, creator.token);

  const audience = await profiles.priorityAudience(creator.id);
  const everyone = audience.flatMap((t) => t.userIds);
  assert.ok(
    !everyone.includes(String(blocked.id)),
    'distribution must respect the block graph',
  );
});

// ── Access control ──

test('behaviour endpoints require authentication', async () => {
  for (const [method, path] of [
    ['POST', '/api/v1/events'],
    ['GET', '/api/v1/me/interests'],
    ['GET', '/api/v1/me/segments'],
    ['GET', '/api/v1/me/creator-affinity'],
  ] as const) {
    const res = await api(method, path, method === 'GET' ? undefined : { events: [] });
    assert.equal(res.status, 401, `${method} ${path} must require authentication`);
  }
});

test('one user cannot read another user\'s video audience', async () => {
  const owner = await registerUser();
  const other = await registerUser();
  const video = await makeVideo(owner.id, 'fitness');

  assert.equal(
    (await api('GET', `/api/v1/videos/${video.publicId}/audience`, undefined, other.token)).status,
    404,
  );
  assert.equal(
    (await api('GET', `/api/v1/videos/${video.publicId}/audience`, undefined, owner.token)).status,
    200,
  );
});

// ── Business events ──

test('a link tap on a business profile is accepted and attributed', async () => {
  const business = await registerUser();
  const visitor = await registerUser();

  const res = await api<{ accepted: number }>(
    'POST', '/api/v1/events',
    { events: [event({ event: 'cta_click', creatorId: business.publicId })] },
    visitor.token,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.equal(res.body.data!.accepted, 1);

  // Attributed to the business, not to the person who tapped — this is what
  // makes the count readable from the business's own analytics.
  const rows = await query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM behaviour_events WHERE creator_id = ? AND event = 'cta_click'",
    [business.id],
  );
  assert.equal(Number(rows[0]!.n), 1);
});

test('an event outside the taxonomy is still rejected', async () => {
  const user = await registerUser();
  const res = await api('POST', '/api/v1/events', { events: [event({ event: 'cta_hover' })] }, user.token);
  assert.equal(res.status, 400, 'the allow-list is the whole point');
});
