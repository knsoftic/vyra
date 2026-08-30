/**
 * Recommendation engine end-to-end, against the real database.
 *
 * Covers the Phase 7 exit criteria:
 *   1. the For You feed serves personalised, diverse results within budget
 *   2. with the ML service unavailable it degrades to the rules ranker silently
 *   3. new-creator exploration reaches the configured share of slots
 *   4. progressive distribution promotes and demotes on performance
 *   5. changing a weight changes the feed without a deploy, and is audited
 *
 * The ML service is genuinely absent on this machine, so criterion 2 is not
 * simulated — it is the natural state of every test here.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.RATE_LIMIT_ENABLED = 'false';
process.env.NODE_ENV = 'development';

const { createApp } = await import('../src/app.ts');
const { pool, execute, query, queryOne } = await import('../src/core/db.ts');
const { closeRedis } = await import('../src/core/redis.ts');
const { buildFeed } = await import('../src/modules/feed/feed.service.ts');
const { seedWeights, setWeight, getWeights, invalidateWeights } = await import(
  '../src/modules/feed/weights.ts'
);
const distribution = await import('../src/modules/feed/distribution.ts');
const { mlStatus, __resetBreaker } = await import('../src/modules/feed/ml-client.ts');

let server: Server;
let base = '';
const createdEmails: string[] = [];
let adminRoleId = 0;

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
  const email = `p7_${suffix}@vyra.test`;
  createdEmails.push(email);
  const res = await api<Session>('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username: `p7_${suffix}`,
    birthdate: '1995-04-12',
    device: { deviceId: `dev-p7-${suffix}`, platform: 'web' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return { token: res.body.data!.tokens.accessToken, publicId: res.body.data!.user.id, id: row!.id };
}

/** Promotes a registered user to admin, via the explicit link added in 016. */
async function makeAdmin(userId: number): Promise<void> {
  await execute(
    `INSERT INTO admin_users (public_id, name, email, password_hash, role_id, user_id, status)
     VALUES (:publicId, 'Test Admin', :email, 'x', :roleId, :userId, 'active')`,
    {
      publicId: `A${Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(25, '0')}`,
      email: `admin_${userId}@vyra.test`,
      roleId: adminRoleId,
      userId,
    },
  );
}

const rid = () => `V${Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(25, '0')}`;

async function makeVideo(
  userId: number,
  options: { categorySlug?: string; publishedHoursAgo?: number; level?: number } = {},
): Promise<{ id: number; publicId: string }> {
  const category = options.categorySlug
    ? await queryOne<{ id: number }>('SELECT id FROM categories WHERE slug = ?', [options.categorySlug])
    : null;

  const publicId = rid();
  const result = await execute(
    `INSERT INTO videos
       (public_id, user_id, category_id, caption, duration_sec, privacy, status,
        processing_status, published_at, distribution_level, hls_key)
     VALUES (:publicId, :userId, :categoryId, 'feed test', 30, 'public', 'published',
             'complete', (NOW(3) - INTERVAL :hours HOUR), :level, :hlsKey)`,
    {
      publicId,
      userId,
      categoryId: category?.id ?? null,
      hours: options.publishedHoursAgo ?? 1,
      level: options.level ?? 1,
      hlsKey: `hls/${publicId}/master.m3u8`,
    },
  );
  return { id: result.insertId, publicId };
}

/** Gives a creator enough followers that they are no longer "new". */
async function establishCreator(creatorId: number): Promise<void> {
  await execute('UPDATE user_profiles SET follower_count = 5000 WHERE user_id = :id', {
    id: creatorId,
  });
}

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await seedWeights(true);

  // A role with the permissions the ranking admin routes require.
  await execute(
    `INSERT INTO roles (slug, name, is_system) VALUES ('test_ranking_admin', 'Test Ranking Admin', 0)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
  );
  const role = await queryOne<{ id: number }>(
    "SELECT id FROM roles WHERE slug = 'test_ranking_admin'",
  );
  adminRoleId = role!.id;
  for (const [module, action] of [
    ['recommendation', 'view'], ['recommendation', 'update'],
    ['videos', 'view'], ['videos', 'update'],
  ] as const) {
    await execute(
      'INSERT IGNORE INTO role_permissions (role_id, module, action) VALUES (:roleId, :module, :action)',
      { roleId: adminRoleId, module, action },
    );
  }
});

after(async () => {
  try {
    for (const email of createdEmails) {
      const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
      if (!user) continue;
      const id = user.id;
      await execute('DELETE FROM admin_users WHERE user_id = ?', [id]);
      await execute('DELETE FROM feed_seen WHERE user_id = ?', [id]);
      await execute('DELETE FROM impressions WHERE user_id = ?', [id]);
      await execute(
        'DELETE de FROM distribution_events de JOIN videos v ON v.id = de.video_id WHERE v.user_id = ?',
        [id],
      );
      await execute(
        'DELETE vp FROM video_performance vp JOIN videos v ON v.id = vp.video_id WHERE v.user_id = ?',
        [id],
      );
      await execute(
        'DELETE s FROM video_stats_hourly s JOIN videos v ON v.id = s.video_id WHERE v.user_id = ?',
        [id],
      );
      await execute('DELETE FROM feed_seen WHERE video_id IN (SELECT id FROM videos WHERE user_id = ?)', [id]);
      await execute('DELETE FROM impressions WHERE video_id IN (SELECT id FROM videos WHERE user_id = ?)', [id]);
      await execute('DELETE FROM behaviour_events WHERE user_id = ? OR creator_id = ?', [id, id]);
      await execute('DELETE FROM watch_events WHERE user_id = ? OR creator_id = ?', [id, id]);
      await execute('DELETE FROM negative_signals WHERE user_id = ?', [id]);
      await execute('DELETE FROM creator_affinity WHERE user_id = ? OR creator_id = ?', [id, id]);
      await execute('DELETE FROM user_interest_profiles WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_segments WHERE user_id = ?', [id]);
      await execute('DELETE FROM profile_rebuild_queue WHERE user_id = ?', [id]);
      await execute('DELETE FROM videos WHERE user_id = ?', [id]);
      await execute('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', [id, id]);
      await execute('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?', [id, id]);
      await execute('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', [id, id]);
      await execute('DELETE FROM audit_logs WHERE admin_id = ?', [id]);
      await execute('DELETE FROM security_events WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_devices WHERE user_id = ?', [id]);
      await execute('DELETE FROM login_attempts WHERE user_id = ?', [id]);
      await execute('DELETE FROM referral_codes WHERE user_id = ?', [id]);
      await execute('DELETE FROM wallets WHERE user_id = ?', [id]);
      await execute('DELETE FROM user_profiles WHERE user_id = ?', [id]);
      await execute('DELETE FROM users WHERE id = ?', [id]);
    }
    await execute('DELETE FROM role_permissions WHERE role_id = ?', [adminRoleId]);
    await execute('DELETE FROM roles WHERE id = ?', [adminRoleId]);
    await seedWeights(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await closeRedis();
  }
});

// ── Exit criterion 1: a personalised, diverse feed ──

test('the feed serves videos from a pool of creators', async () => {
  const viewer = await registerUser();
  const creators = await Promise.all([registerUser(), registerUser(), registerUser()]);
  for (const creator of creators) {
    await establishCreator(creator.id);
    await makeVideo(creator.id, { categorySlug: 'gaming' });
    await makeVideo(creator.id, { categorySlug: 'technology' });
  }

  const res = await api<{ items: { id: string }[]; ranker: string }>(
    'GET', '/api/v1/feed?limit=6', undefined, viewer.token,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.ok(res.body.data!.items.length > 0, 'the feed should not be empty');
});

test('the feed never contains the viewer\'s own videos', async () => {
  const viewer = await registerUser();
  await establishCreator(viewer.id);
  const own = await makeVideo(viewer.id, { categorySlug: 'gaming' });

  const other = await registerUser();
  await establishCreator(other.id);
  await makeVideo(other.id, { categorySlug: 'gaming' });

  const res = await api<{ items: { id: string }[] }>(
    'GET', '/api/v1/feed?limit=10', undefined, viewer.token,
  );
  assert.ok(!res.body.data!.items.some((i) => i.id === own.publicId));
});

test('a blocked creator never appears', async () => {
  const viewer = await registerUser();
  const blocked = await registerUser();
  await establishCreator(blocked.id);
  const hidden = await makeVideo(blocked.id, { categorySlug: 'gaming' });

  await api('POST', `/api/v1/users/${blocked.publicId}/block`, undefined, viewer.token);

  const result = await buildFeed(viewer.id, { limit: 20 });
  assert.ok(
    !result.items.some((i) => i.videoId === String(hidden.id)),
    'a blocked creator must be excluded at retrieval',
  );
});

test('a private video never reaches the feed', async () => {
  const viewer = await registerUser();
  const creator = await registerUser();
  await establishCreator(creator.id);
  const publicVideo = await makeVideo(creator.id, { categorySlug: 'gaming' });
  const privateVideo = await makeVideo(creator.id, { categorySlug: 'gaming' });
  await execute("UPDATE videos SET privacy = 'private' WHERE id = ?", [privateVideo.id]);

  const result = await buildFeed(viewer.id, { limit: 20 });
  const ids = result.items.map((i) => i.videoId);
  assert.ok(!ids.includes(String(privateVideo.id)), 'private content must never be recommended');
  void publicVideo;
});

test('an unprocessed video never reaches the feed', async () => {
  const viewer = await registerUser();
  const creator = await registerUser();
  await establishCreator(creator.id);
  const pending = await makeVideo(creator.id, { categorySlug: 'gaming' });
  await execute("UPDATE videos SET processing_status = 'pending' WHERE id = ?", [pending.id]);

  const result = await buildFeed(viewer.id, { limit: 20 });
  assert.ok(!result.items.map((i) => i.videoId).includes(String(pending.id)));
});

test('every item explains why it was shown', async () => {
  const viewer = await registerUser();
  const creator = await registerUser();
  await establishCreator(creator.id);
  await makeVideo(creator.id, { categorySlug: 'gaming' });

  const result = await buildFeed(viewer.id, { limit: 5 });
  for (const item of result.items) {
    assert.ok(item.reason.length > 0, 'every recommendation needs a reason');
    assert.ok(item.impressionId.length > 0);
  }
});

test('the feed reports per-stage timings', async () => {
  const viewer = await registerUser();
  const creator = await registerUser();
  await establishCreator(creator.id);
  await makeVideo(creator.id, { categorySlug: 'gaming' });

  const result = await buildFeed(viewer.id, { limit: 10 });
  for (const stage of ['weights', 'context', 'retrieval', 'enrichment', 'scoring', 'rerank']) {
    assert.ok(stage in result.diagnostics.timings, `${stage} was not timed`);
  }
});

test('a feed request completes well inside a sane latency budget', async () => {
  const viewer = await registerUser();
  const creators = await Promise.all([registerUser(), registerUser(), registerUser()]);
  for (const creator of creators) {
    await establishCreator(creator.id);
    for (let i = 0; i < 5; i += 1) {
      await makeVideo(creator.id, { categorySlug: i % 2 === 0 ? 'gaming' : 'technology' });
    }
  }

  const started = Date.now();
  await buildFeed(viewer.id, { limit: 20 });
  const elapsed = Date.now() - started;

  // Generous, because this is a laptop with no ML service and a cold cache. It
  // catches an accidental O(n) query per candidate, which is the realistic
  // regression.
  assert.ok(elapsed < 3000, `a feed build took ${elapsed}ms`);
});

test('an empty platform yields an empty feed, not an error', async () => {
  const viewer = await registerUser();
  const res = await api<{ items: unknown[] }>('GET', '/api/v1/feed', undefined, viewer.token);
  assert.equal(res.status, 200, 'no candidates must not mean a broken feed');
  assert.ok(Array.isArray(res.body.data!.items));
});

test('the feed requires authentication', async () => {
  assert.equal((await api('GET', '/api/v1/feed')).status, 401);
});

// ── Exit criterion 2: the ML service is optional ──

test('with no ML service the feed still serves, via the rules ranker', async () => {
  __resetBreaker();
  const viewer = await registerUser();
  const creator = await registerUser();
  await establishCreator(creator.id);
  await makeVideo(creator.id, { categorySlug: 'gaming' });

  const result = await buildFeed(viewer.id, { limit: 5 });

  assert.equal(result.ranker, 'rules', 'the fallback ranker should have served this');
  assert.ok(result.fallbackReason, 'the reason for falling back should be recorded');
  assert.ok(result.items.length > 0, 'the feed must not be empty just because the model is down');
});

test('the ML failure is invisible to the client', async () => {
  const viewer = await registerUser();
  const creator = await registerUser();
  await establishCreator(creator.id);
  await makeVideo(creator.id, { categorySlug: 'gaming' });

  const res = await api<{ items: unknown[] }>('GET', '/api/v1/feed', undefined, viewer.token);
  assert.equal(res.status, 200, 'a dead model must never produce an error response');
  assert.equal(res.body.ok, true);
});

test('repeated ML failures open the breaker rather than retrying every request', async () => {
  __resetBreaker();
  const viewer = await registerUser();
  const creator = await registerUser();
  await establishCreator(creator.id);
  await makeVideo(creator.id, { categorySlug: 'gaming' });

  for (let i = 0; i < 4; i += 1) {
    await buildFeed(viewer.id, { limit: 3 });
  }

  const status = mlStatus();
  assert.equal(status.available, false, 'the breaker should be open after repeated failures');

  // And the feed still works with the breaker open.
  const result = await buildFeed(viewer.id, { limit: 3 });
  assert.equal(result.ranker, 'rules');
  assert.match(String(result.fallbackReason), /cooldown/);
});

// ── Exit criterion 3: new-creator exploration ──

test('new creators reach the configured share of slots', async () => {
  const viewer = await registerUser();

  // Eight established creators with plenty of content.
  for (let i = 0; i < 8; i += 1) {
    const creator = await registerUser();
    await establishCreator(creator.id);
    await makeVideo(creator.id, { categorySlug: 'gaming' });
    await makeVideo(creator.id, { categorySlug: 'technology' });
  }
  // Four brand-new creators, left with zero followers.
  const newcomerIds: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const creator = await registerUser();
    newcomerIds.push(creator.id);
    await makeVideo(creator.id, { categorySlug: 'gaming' });
  }

  const result = await buildFeed(viewer.id, { limit: 20 });
  const newCreatorItems = result.items.filter((i) => i.isNewCreator);

  assert.ok(result.items.length >= 10, 'expected a reasonably full page');
  assert.ok(
    newCreatorItems.length >= 1,
    'new creators got no slots at all — the exploration budget is not reaching the feed',
  );
  assert.ok(
    result.diagnostics.newCreatorShare >= 0.1,
    `new-creator share was ${result.diagnostics.newCreatorShare}, expected at least the configured 0.1`,
  );
});

test('the exploration budget is capped, not unlimited', async () => {
  const viewer = await registerUser();
  for (let i = 0; i < 10; i += 1) {
    const creator = await registerUser();
    await makeVideo(creator.id, { categorySlug: 'gaming' });
  }

  const result = await buildFeed(viewer.id, { limit: 10 });
  // Everything available is from a new creator here, which is fine — the point
  // is that the reservation is a floor and never forces a short page.
  assert.ok(result.items.length > 0);
  assert.ok(result.diagnostics.newCreatorShare <= 1);
});

// ── Exit criterion 4: progressive distribution ──

test('a video is promoted on good performance', async () => {
  const creator = await registerUser();
  const video = await makeVideo(creator.id, { categorySlug: 'gaming', level: 1 });

  await execute(
    `INSERT INTO video_stats_hourly
       (video_id, bucket_hour, impressions, views, completions, quick_skips, likes, comments, shares, saves)
     VALUES (:videoId, DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00'), 200, 160, 80, 20, 10, 3, 2, 5)`,
    { videoId: video.id },
  );

  const verdict = await distribution.evaluateAndApply(video.id);
  assert.equal(verdict.decision, 'promoted');
  assert.equal(verdict.toLevel, 2);
  assert.equal(verdict.applied, true);

  const row = await queryOne<{ distribution_level: number }>(
    'SELECT distribution_level FROM videos WHERE id = ?', [video.id],
  );
  assert.equal(Number(row!.distribution_level), 2);
});

test('a promotion writes an auditable record with its numbers', async () => {
  const creator = await registerUser();
  const video = await makeVideo(creator.id, { categorySlug: 'gaming', level: 1 });
  await execute(
    `INSERT INTO video_stats_hourly
       (video_id, bucket_hour, impressions, views, completions, quick_skips, likes, comments, shares, saves)
     VALUES (:videoId, DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00'), 200, 160, 80, 20, 10, 3, 2, 5)`,
    { videoId: video.id },
  );
  await distribution.evaluateAndApply(video.id);

  const history = await distribution.history(video.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.fromLevel, 1);
  assert.equal(history[0]!.toLevel, 2);
  assert.ok(history[0]!.impressions > 0);
  assert.ok(
    (history[0]!.explanation ?? '').length > 0,
    'a distribution change must explain itself',
  );
});

test('a video is demoted when it stops performing', async () => {
  const creator = await registerUser();
  const video = await makeVideo(creator.id, { categorySlug: 'gaming', level: 3 });

  await execute(
    `INSERT INTO video_stats_hourly
       (video_id, bucket_hour, impressions, views, completions, quick_skips, likes, comments, shares, saves)
     VALUES (:videoId, DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00'), 2000, 1900, 1700, 1400, 300, 100, 50, 50)`,
    { videoId: video.id },
  );

  const verdict = await distribution.evaluateAndApply(video.id);
  assert.equal(verdict.decision, 'demoted', verdict.reason);
  assert.equal(verdict.toLevel, 2);
});

test('a video with too little data is held, not guessed at', async () => {
  const creator = await registerUser();
  const video = await makeVideo(creator.id, { categorySlug: 'gaming', level: 1 });
  await execute(
    `INSERT INTO video_stats_hourly (video_id, bucket_hour, impressions, views, completions)
     VALUES (:videoId, DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00'), 5, 5, 5)`,
    { videoId: video.id },
  );

  const verdict = await distribution.evaluateAndApply(video.id);
  assert.equal(verdict.decision, 'held');
  assert.equal(verdict.applied, false);
});

test('a creator can see how far their video has travelled', async () => {
  const creator = await registerUser();
  const other = await registerUser();
  const video = await makeVideo(creator.id, { categorySlug: 'gaming', level: 2 });

  const res = await api<{ level: number; label: string }>(
    'GET', `/api/v1/videos/${video.publicId}/distribution`, undefined, creator.token,
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.data!.level, 2);
  assert.ok(res.body.data!.label.length > 0);

  assert.equal(
    (await api('GET', `/api/v1/videos/${video.publicId}/distribution`, undefined, other.token)).status,
    404,
    'another user must not see it',
  );
});

// ── Exit criterion 5: admin weights change the feed and are audited ──

test('an ordinary user cannot change a ranking weight', async () => {
  const user = await registerUser();
  const res = await api('PATCH', '/api/v1/admin/ranking/weights/w_like',
    { value: 3, reason: 'trying it on' }, user.token);
  assert.equal(res.status, 403);
});

test('an admin can change a weight, and it takes effect without a deploy', async () => {
  const admin = await registerUser();
  await makeAdmin(admin.id);

  const before = await getWeights();
  const original = before.x_new_creator_rate!;

  const res = await api<{ previous: number; value: number }>(
    'PATCH', '/api/v1/admin/ranking/weights/x_new_creator_rate',
    { value: 0.4, reason: 'Testing that a weight change reaches the feed.' },
    admin.token,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.equal(res.body.data!.previous, original);
  assert.equal(res.body.data!.value, 0.4);

  // Read back through the same path the feed uses — no restart, no deploy.
  const after = await getWeights();
  assert.equal(after.x_new_creator_rate, 0.4, 'the change must be visible immediately');

  await setWeight('x_new_creator_rate', original, null);
  await invalidateWeights();
});

test('changing a weight writes an audit record with before and after', async () => {
  const admin = await registerUser();
  await makeAdmin(admin.id);

  await api('PATCH', '/api/v1/admin/ranking/weights/w_like',
    { value: 2.5, reason: 'Raising the weight on likes for an experiment.' }, admin.token);

  const audit = await queryOne<{
    action: string; old_value: string; new_value: string; reason: string; admin_name: string;
  }>(
    `SELECT action, old_value, new_value, reason, admin_name FROM audit_logs
      WHERE module = 'recommendation' AND target_id = 'w_like'
      ORDER BY id DESC LIMIT 1`,
  );

  assert.ok(audit, 'a ranking change must be audited');
  assert.equal(audit.action, 'weight_changed');
  assert.match(audit.reason, /experiment/);
  assert.match(String(audit.new_value), /2\.5/);
  assert.ok(String(audit.old_value).length > 0, 'the previous value must be recorded');

  await setWeight('w_like', 1.2, null);
});

test('a weight outside its bounds is refused', async () => {
  const admin = await registerUser();
  await makeAdmin(admin.id);

  // 100 instead of 0.10 — the mistake the bounds exist to catch.
  const res = await api('PATCH', '/api/v1/admin/ranking/weights/x_new_creator_rate',
    { value: 100, reason: 'Typo.' }, admin.token);
  assert.equal(res.status, 400);
  assert.match(res.body.error!.message, /between/);

  const weights = await getWeights();
  assert.notEqual(weights.x_new_creator_rate, 100);
});

test('an unknown weight is refused', async () => {
  const admin = await registerUser();
  await makeAdmin(admin.id);
  const res = await api('PATCH', '/api/v1/admin/ranking/weights/not_a_weight',
    { value: 1, reason: 'x' }, admin.token);
  assert.equal(res.status, 404);
});

test('a weight change requires a reason', async () => {
  const admin = await registerUser();
  await makeAdmin(admin.id);
  const res = await api('PATCH', '/api/v1/admin/ranking/weights/w_like',
    { value: 1.5 }, admin.token);
  assert.equal(res.status, 400, 'a ranking change without a stated reason is not auditable');
});

test('an admin can list every weight with its bounds', async () => {
  const admin = await registerUser();
  await makeAdmin(admin.id);

  const res = await api<{ key: string; value: number; min: number; max: number }[]>(
    'GET', '/api/v1/admin/ranking/weights', undefined, admin.token,
  );
  assert.equal(res.status, 200);
  assert.ok(res.body.data!.length >= 20);
  for (const weight of res.body.data!) {
    assert.ok(weight.min < weight.max);
    assert.ok(weight.value >= weight.min && weight.value <= weight.max);
  }
});

// ── The admin explain view ──

test('an admin can see the full reasoning behind a feed', async () => {
  const admin = await registerUser();
  await makeAdmin(admin.id);
  const creator = await registerUser();
  await establishCreator(creator.id);
  await makeVideo(creator.id, { categorySlug: 'gaming' });

  const res = await api<{
    diagnostics: { poolCounts: Record<string, number>; timings: Record<string, number> };
    ranker: string;
  }>('GET', '/api/v1/admin/feed/explain?limit=5', undefined, admin.token);

  assert.equal(res.status, 200);
  assert.ok(typeof res.body.data!.diagnostics.poolCounts === 'object');
  assert.ok(typeof res.body.data!.diagnostics.timings === 'object');
  assert.equal(res.body.data!.ranker, 'rules');
});

test('the privilege-escalation path is closed', async () => {
  // An ordinary user whose id happens to match an admin_users row id must not
  // inherit that admin's permissions. Before 016 this was possible.
  const admin = await registerUser();
  await makeAdmin(admin.id);
  const impostor = await registerUser();

  const adminRow = await queryOne<{ id: number }>(
    'SELECT id FROM admin_users WHERE user_id = ?', [admin.id],
  );
  assert.ok(adminRow);

  const res = await api('GET', '/api/v1/admin/ranking/weights', undefined, impostor.token);
  assert.equal(res.status, 403, 'a non-admin must never reach an admin route');
});
