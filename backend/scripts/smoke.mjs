/**
 * Live smoke test across every phase, against a booted server.
 *
 * Separate from the unit and integration suites: it starts the real app, walks
 * users through the whole product, and cleans up after itself. If any of this
 * fails, the API is broken in a way the suites missed — which is exactly what
 * happened the first time it ran.
 */

process.env.RATE_LIMIT_ENABLED = 'false';
process.env.NODE_ENV = 'development';
process.env.UPLOAD_CHUNK_SIZE = '4096';

// Resolved relative to this file so the script runs from any working
// directory. On Windows a bare absolute path is not a valid ESM specifier,
// hence the URL rather than a path string.
const SRC = new URL('../src/', import.meta.url);
const load = (rel) => import(new URL(rel, SRC).href);

const { createApp } = await load('app.ts');
const { pool, execute, queryOne } = await load('core/db.ts');
const { closeRedis } = await load('core/redis.ts');

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(`${label} ${detail}`);
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

async function api(method, path, body, token) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() };
}

const emails = [];
async function register(tag) {
  const id = Math.random().toString(36).slice(2, 10);
  const email = `smoke_${id}@vyra.test`;
  emails.push(email);
  const res = await api('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username: `smoke_${id}`,
    birthdate: '1995-04-12',
    device: { deviceId: `smoke-${id}`, platform: 'web' },
  });
  check(`register ${tag}`, res.status === 201, JSON.stringify(res.body.error ?? ''));
  const row = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
  return { token: res.body.data?.tokens.accessToken, publicId: res.body.data?.user.id, email, dbId: row?.id };
}

const rid = () => Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(25, '0');

try {
  console.log('\n── Phase 2: infrastructure ──');
  const health = await api('GET', '/health');
  check('GET /health returns 200', health.status === 200);
  check('health uses the standard envelope', health.body.ok === true && !!health.body.data);

  const ready = await api('GET', '/ready');
  check('GET /ready reports dependency state', typeof ready.body.data?.ready === 'boolean');
  check('/ready sees the database up', ready.body.data?.checks?.database === 'up');

  const missing = await api('GET', '/api/v1/does-not-exist');
  check('unknown route uses the standard error envelope',
    missing.status === 404 && missing.body.error?.code === 'not_found');

  console.log('\n── Phase 3: auth, profile, graph ──');
  const alice = await register('alice');
  const bob = await register('bob');

  const me = await api('GET', '/api/v1/me', undefined, alice.token);
  check('GET /me returns the caller profile', me.status === 200 && !!me.body.data?.username);
  check('unauthenticated /me is rejected', (await api('GET', '/api/v1/me')).status === 401);

  const updated = await api('PATCH', '/api/v1/me',
    { displayName: 'Alice Smoke', bio: 'testing' }, alice.token);
  check('PATCH /me updates the profile', updated.body.data?.displayName === 'Alice Smoke');

  const switched = await api('POST', '/api/v1/me/account-type',
    { category: 'business', type: 'brand' }, alice.token);
  check('account type switches to business', switched.body.data?.accountCategory === 'business');

  const followed = await api('POST', `/api/v1/users/${bob.publicId}/follow`, undefined, alice.token);
  check('follow works and counts correctly', followed.body.data?.followerCount === 1);

  const otp = await api('POST', '/api/v1/auth/otp/request',
    { email: alice.email, purpose: 'signup' });
  check('OTP is issued', otp.status === 200 && !!otp.body.data?.devCode);

  const verified = await api('POST', '/api/v1/auth/otp/verify',
    { email: alice.email, code: otp.body.data.devCode, purpose: 'signup' });
  check('OTP verifies', verified.status === 200);

  const reused = await api('POST', '/api/v1/auth/otp/verify',
    { email: alice.email, code: otp.body.data.devCode, purpose: 'signup' });
  check('a consumed OTP cannot be reused', reused.status === 400);

  const sessions = await api('GET', '/api/v1/auth/sessions', undefined, alice.token);
  check('active sessions are listed', sessions.status === 200 && sessions.body.data.length >= 1);

  console.log('\n── Phase 4: creation ──');
  const catalogue = await api('GET', '/api/v1/creative/catalogue', undefined, alice.token);
  check('catalogue serves 20 filters', catalogue.body.data?.filters?.length === 20);
  check('catalogue serves effects', catalogue.body.data?.effects?.length >= 12);
  check('catalogue serves fonts', catalogue.body.data?.fonts?.length >= 1);
  check('catalogue serves 11 adjustment controls', catalogue.body.data?.adjustments?.length === 11);

  const limits = await api('GET', '/api/v1/creative/limits', undefined, alice.token);
  check('upload limits are exposed', typeof limits.body.data?.maxSizeBytes === 'number');

  const file = Buffer.alloc(5000);
  for (let i = 0; i < file.length; i += 1) file[i] = i % 251;

  const upload = await api('POST', '/api/v1/uploads',
    { filename: 'smoke.mp4', sizeBytes: file.length, contentType: 'video/mp4', durationMs: 4000 },
    alice.token);
  check('upload session created', upload.status === 201, JSON.stringify(upload.body.error ?? ''));

  for (let i = 0; i < upload.body.data.totalChunks; i += 1) {
    const part = file.subarray(i * 4096, Math.min((i + 1) * 4096, file.length));
    const res = await fetch(`${base}/api/v1/uploads/${upload.body.data.id}/chunks/${i}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${alice.token}` },
      body: new Uint8Array(part),
    });
    if (res.status !== 200) check(`chunk ${i} accepted`, false, String(res.status));
  }
  const completed = await api('POST', `/api/v1/uploads/${upload.body.data.id}/complete`, {}, alice.token);
  check('chunked upload completes', completed.status === 200, JSON.stringify(completed.body.error ?? ''));

  const sourceKey = completed.body.data.storageKey;
  const edl = {
    version: 1,
    clips: [{ id: 'c1', sourceKey, trimStartMs: 0, trimEndMs: 4000, speed: 1, rotation: 0, volume: 100, muted: false }],
    effects: [], texts: [], stickers: [], audio: [], aspect: '9:16',
    filterSlug: 'vintage', filterIntensity: 70,
  };

  const draft = await api('POST', '/api/v1/drafts', { caption: 'smoke draft', editList: edl }, alice.token);
  check('draft saves', draft.status === 201, JSON.stringify(draft.body.error ?? ''));
  check('draft is listed',
    (await api('GET', '/api/v1/drafts', undefined, alice.token)).body.data?.length === 1);

  const published = await api('POST', '/api/v1/videos', {
    editList: edl, caption: 'smoke video #smoketest', privacy: 'followers',
    draftId: draft.body.data.id,
  }, alice.token);
  check('publish succeeds', published.status === 201, JSON.stringify(published.body.error ?? ''));
  check('a render job is queued', published.body.data?.renderJob?.status === 'queued');

  const videoId = published.body.data.videoId;
  const dbVideo = await queryOne('SELECT id, privacy, status FROM videos WHERE public_id = ?', [videoId]);
  check('privacy "followers" is stored as followers, not friends', dbVideo?.privacy === 'followers');
  check('a video is not published until it is rendered', dbVideo?.status === 'processing');
  check('publishing consumes the draft',
    (await api('GET', '/api/v1/drafts', undefined, alice.token)).body.data?.length === 0);

  console.log('\n── Phase 5: processing and playback ──');
  const { advance } = await load('jobs/pipeline.worker.ts');
  const { drainQueue, checkFfmpeg } = await load('jobs/render.worker.ts');
  const hasFfmpeg = await checkFfmpeg();
  console.log(`  (FFmpeg on this host: ${hasFfmpeg})`);

  // The pipeline waits on the render job, so the render queue must be drained
  // too — which is what the worker process does in production.
  for (let round = 0; round < 6; round += 1) {
    await drainQueue(5);
    for (let i = 0; i < 10; i += 1) {
      if (!(await advance(dbVideo.id))) break;
    }
  }

  const processing = await api('GET', `/api/v1/videos/${videoId}/processing`, undefined, alice.token);
  const renderStage = (processing.body.data?.stages ?? []).find((s) => s.stage === 'render');

  if (hasFfmpeg) {
    check('processing reaches 100%', processing.body.data?.percent === 100,
      JSON.stringify(processing.body.data ?? {}));
    const quality = await api('GET', `/api/v1/videos/${videoId}/quality`, undefined, alice.token);
    check('a decomposed quality score is produced',
      quality.status === 200 &&
      ['technical', 'spamProbability', 'safetyStatus', 'captionRelevance']
        .every((k) => quality.body.data?.[k] !== undefined));
  } else {
    // Without FFmpeg no playable file can exist. The honest outcome is a clear
    // failure, not a video stuck in limbo — that is what is asserted here.
    check('without FFmpeg the render fails rather than stalling silently',
      renderStage?.status === 'failed', JSON.stringify(renderStage ?? {}));
    check('the failure says what is wrong',
      /render job failed|FFmpeg/i.test(String(renderStage?.error ?? '')),
      String(renderStage?.error ?? ''));

    const failedVideo = await queryOne(
      'SELECT status, processing_status FROM videos WHERE id = ?', [dbVideo.id]);
    check('an unrenderable video is marked failed, not left processing',
      failedVideo?.processing_status === 'failed', JSON.stringify(failedVideo ?? {}));

    const notPlayable = await api('GET', `/api/v1/videos/${videoId}/playback`, undefined, alice.token);
    check('a failed video is never served as playable', notPlayable.body.data?.ready !== true);
  }

  // Privacy holds regardless of processing state.
  check('a non-follower cannot reach a followers-only video',
    (await api('GET', `/api/v1/videos/${videoId}/playback`, undefined, bob.token)).status === 404);
  check('a signed-out viewer cannot reach a followers-only video',
    (await api('GET', `/api/v1/videos/${videoId}/playback`)).status === 404);

  // A separately seeded, fully processed video exercises the playback path.
  const readyPublicId = `S${rid()}`;
  await execute(
    `INSERT INTO videos (public_id, user_id, caption, duration_sec, privacy, status,
                         processing_status, hls_key)
     VALUES (?, ?, 'ready', 5, 'followers', 'published', 'complete', 'hls/smoke/master.m3u8')`,
    [readyPublicId, alice.dbId],
  );

  check('a ready followers-only video is hidden from non-followers',
    (await api('GET', `/api/v1/videos/${readyPublicId}/playback`, undefined, bob.token)).status === 404);

  await api('POST', `/api/v1/users/${alice.publicId}/follow`, undefined, bob.token);
  const afterFollow = await api('GET', `/api/v1/videos/${readyPublicId}/playback`, undefined, bob.token);
  check('a follower can play a ready video', afterFollow.status === 200, String(afterFollow.status));
  check('restricted media is served through a signed URL',
    String(afterFollow.body.data?.hlsUrl ?? '').includes('sig='),
    String(afterFollow.body.data?.hlsUrl ?? ''));

  const reprocess = await api('POST', `/api/v1/admin/videos/${videoId}/reprocess`,
    { reason: 'smoke' }, alice.token);
  check('reprocessing requires admin rights', reprocess.status === 403);

  console.log('\n── Phase 6: behaviour intelligence ──');
  const { randomUUID } = await import('node:crypto');
  const ev = (over = {}) => ({
    event: 'like', dedupeKey: randomUUID(), occurredAt: new Date().toISOString(), ...over,
  });

  const batch = { events: [ev({ videoId: readyPublicId }), ev({ videoId: readyPublicId, event: 'save' })] };
  const firstSend = await api('POST', '/api/v1/events', batch, alice.token);
  check('events are ingested', firstSend.body.data?.accepted === 2,
    JSON.stringify(firstSend.body.data ?? firstSend.body.error ?? ''));

  const retrySend = await api('POST', '/api/v1/events', batch, alice.token);
  check('a retried batch stores nothing new',
    retrySend.body.data?.accepted === 0 && retrySend.body.data?.duplicates === 2,
    JSON.stringify(retrySend.body.data ?? {}));

  const sensitive = await api('POST', '/api/v1/events',
    { events: [{ ...ev(), email: 'someone@example.com' }] }, alice.token);
  check('an event carrying a sensitive field is refused', sensitive.status === 400);

  await api('POST', '/api/v1/me/interests/rebuild', {}, alice.token);
  const interests = await api('GET', '/api/v1/me/interests', undefined, alice.token);
  check('an interest profile is produced',
    interests.status === 200 && typeof interests.body.data?.combined === 'object');

  const segments = await api('GET', '/api/v1/me/segments', undefined, alice.token);
  check('segment membership is queryable', segments.status === 200 && Array.isArray(segments.body.data));

  const affinity = await api('GET', '/api/v1/me/creator-affinity', undefined, alice.token);
  check('creator affinity is queryable', affinity.status === 200 && Array.isArray(affinity.body.data));

  const audience = await api('GET', `/api/v1/videos/${videoId}/audience`, undefined, alice.token);
  check('a creator can see their video audience', audience.status === 200);
  check('another user cannot see it',
    (await api('GET', `/api/v1/videos/${videoId}/audience`, undefined, bob.token)).status === 404);

  console.log('\n── Phase 7: recommendation engine ──');
  const feed = await api('GET', '/api/v1/feed?limit=10', undefined, alice.token);
  check('the For You feed responds', feed.status === 200, JSON.stringify(feed.body.error ?? ''));
  check('the feed uses the standard envelope', feed.body.ok === true && Array.isArray(feed.body.data?.items));
  check('with no ML service it falls back to the rules ranker',
    feed.body.data?.ranker === 'rules', String(feed.body.data?.ranker));

  const feedStart = Date.now();
  await api('GET', '/api/v1/feed?limit=20', undefined, alice.token);
  check('a feed request is served promptly', Date.now() - feedStart < 3000);

  check('the feed requires authentication', (await api('GET', '/api/v1/feed')).status === 401);

  const weightAttempt = await api('PATCH', '/api/v1/admin/ranking/weights/w_like',
    { value: 2, reason: 'smoke' }, alice.token);
  check('an ordinary user cannot change a ranking weight', weightAttempt.status === 403);

  const dist = await api('GET', `/api/v1/videos/${readyPublicId}/distribution`, undefined, alice.token);
  check('a creator can see their distribution level', dist.status === 200 && typeof dist.body.data?.level === 'number');
  check('another user cannot',
    (await api('GET', `/api/v1/videos/${readyPublicId}/distribution`, undefined, bob.token)).status === 404);

  console.log('\n── Notifications and delivery ──');
  const prefs = await api('GET', '/api/v1/me/notification-preferences', undefined, alice.token);
  check('notification preferences load',
    prefs.status === 200 && prefs.body.data?.preferences?.like?.inApp === true,
    JSON.stringify(prefs.body.error ?? ''));
  check('marketing consent is off until it is given',
    prefs.body.data?.preferences?.marketing?.email === false);
  check('quiet hours are readable, not write-only',
    prefs.body.data?.quietHours !== undefined && prefs.body.data.quietHours.start === null);

  const silence = await api('PATCH', '/api/v1/me/notification-preferences',
    { kind: 'like', push: false }, alice.token);
  check('a channel can be turned off',
    silence.status === 200 && silence.body.data?.push === false && silence.body.data?.inApp === true);

  const quiet = await api('PATCH', '/api/v1/me/quiet-hours', { start: 22, end: 7 }, alice.token);
  check('quiet hours save', quiet.status === 200 && quiet.body.data?.start === 22);
  await api('PATCH', '/api/v1/me/quiet-hours', { start: null, end: null }, alice.token);

  const inbox = await api('GET', '/api/v1/me/notifications', undefined, alice.token);
  check('the inbox reads', inbox.status === 200 && Array.isArray(inbox.body.data));
  check('the unread count reads',
    typeof (await api('GET', '/api/v1/me/notifications/count', undefined, alice.token))
      .body.data?.unread === 'number');
  check('the inbox needs a session',
    (await api('GET', '/api/v1/me/notifications')).status === 401);
  check('the outbox is staff-only',
    (await api('GET', '/api/v1/admin/outbox', undefined, alice.token)).status === 403);

  // A verification code that never leaves the building is a broken signup, so
  // the queued row is what proves the wiring, not the response.
  const codeEmail = `smoke_otp_${Math.random().toString(36).slice(2, 8)}@vyra.test`;
  await execute('DELETE FROM outbox WHERE destination = ?', [codeEmail]).catch(() => undefined);
  await api('POST', '/api/v1/auth/otp/request', { email: alice.email, purpose: 'login' });
  const queued = await queryOne(
    "SELECT COUNT(*) AS c FROM outbox WHERE destination = ? AND template = 'otp.login'",
    [alice.email],
  ).catch(() => null);
  check('requesting a code queues an email', Number(queued?.c ?? 0) > 0);

  const unknown = await api('POST', '/api/v1/auth/otp/request', { email: codeEmail, purpose: 'login' });
  const unknownQueued = await queryOne(
    'SELECT COUNT(*) AS c FROM outbox WHERE destination = ?', [codeEmail],
  ).catch(() => null);
  check('an address with no account is not emailed',
    unknown.status === 200 && Number(unknownQueued?.c ?? 0) === 0);

  console.log('\n── Cross-cutting ──');
  const badBody = await api('POST', '/api/v1/auth/login', { email: 'nope' });
  check('validation failures use the standard envelope',
    badBody.status === 400 && badBody.body.error?.code === 'validation_failed');

  const evilEdl = await api('POST', '/api/v1/drafts', {
    caption: 'evil',
    editList: { ...edl, clips: [{ ...edl.clips[0], sourceKey: '../../etc/passwd' }] },
  }, alice.token);
  check('a traversal path in an edit list is refused', evilEdl.status === 400);

  const stolen = await api('POST', '/api/v1/drafts',
    { caption: 'stolen', editList: edl }, bob.token);
  check("another user's media cannot be referenced", stolen.status === 403);
} catch (err) {
  failed += 1;
  failures.push(`threw: ${err instanceof Error ? err.message : String(err)}`);
  console.log('\n  UNCAUGHT:', err);
} finally {
  for (const email of emails) {
    const user = await queryOne('SELECT id FROM users WHERE email = ?', [email]).catch(() => null);
    if (!user) continue;
    const id = user.id;
    for (const sql of [
      'DELETE FROM feed_seen WHERE user_id=?',
      'DELETE FROM impressions WHERE user_id=?',
      'DELETE de FROM distribution_events de JOIN videos v ON v.id=de.video_id WHERE v.user_id=?',
      'DELETE vp FROM video_performance vp JOIN videos v ON v.id=vp.video_id WHERE v.user_id=?',
      'DELETE vs FROM video_stats_hourly vs JOIN videos v ON v.id=vs.video_id WHERE v.user_id=?',
      'DELETE FROM behaviour_events WHERE user_id=?',
      'DELETE FROM watch_events WHERE user_id=? OR creator_id=?',
      'DELETE FROM negative_signals WHERE user_id=?',
      'DELETE FROM user_interest_profiles WHERE user_id=?',
      'DELETE FROM user_segments WHERE user_id=?',
      'DELETE FROM creator_affinity WHERE user_id=? OR creator_id=?',
      'DELETE FROM profile_rebuild_queue WHERE user_id=?',
      'DELETE p FROM video_audience_profiles p JOIN videos v ON v.id=p.video_id WHERE v.user_id=?',
      'DELETE ps FROM processing_stages ps JOIN videos v ON v.id=ps.video_id WHERE v.user_id=?',
      'DELETE vp FROM video_probes vp JOIN videos v ON v.id=vp.video_id WHERE v.user_id=?',
      'DELETE q FROM video_quality_scores q JOIN videos v ON v.id=q.video_id WHERE v.user_id=?',
      'DELETE va FROM video_assets va JOIN videos v ON v.id=va.video_id WHERE v.user_id=?',
      'DELETE vh FROM video_hashtags vh JOIN videos v ON v.id=vh.video_id WHERE v.user_id=?',
      'DELETE vm FROM video_mentions vm JOIN videos v ON v.id=vm.video_id WHERE v.user_id=?',
      'DELETE FROM render_jobs WHERE user_id=?',
      'DELETE FROM videos WHERE user_id=?',
      'DELETE uc FROM upload_chunks uc JOIN upload_sessions us ON us.id=uc.session_id WHERE us.user_id=?',
      'DELETE FROM upload_sessions WHERE user_id=?',
      'DELETE FROM video_drafts WHERE user_id=?',
      'DELETE FROM notifications WHERE user_id=? OR actor_id=?',
      'DELETE FROM follows WHERE follower_id=? OR followee_id=?',
      'DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?',
      'DELETE FROM security_events WHERE user_id=?',
      'DELETE FROM user_sessions WHERE user_id=?',
      'DELETE FROM user_devices WHERE user_id=?',
      'DELETE FROM login_attempts WHERE user_id=?',
      'DELETE FROM referral_codes WHERE user_id=?',
      'DELETE FROM wallets WHERE user_id=?',
      'DELETE FROM business_profiles WHERE user_id=?',
      'DELETE FROM user_profiles WHERE user_id=?',
      'DELETE FROM users WHERE id=?',
    ]) {
      const params = (sql.match(/\?/g) ?? []).map(() => id);
      await execute(sql, params).catch(() => undefined);
    }
    await execute('DELETE FROM outbox WHERE destination=? OR user_id=?', [email, id]).catch(() => undefined);
    await execute('DELETE FROM notification_preferences WHERE user_id=?', [id]).catch(() => undefined);
    await execute('DELETE FROM otp_codes WHERE email=?', [email]).catch(() => undefined);
    await execute('DELETE FROM login_attempts WHERE email=?', [email]).catch(() => undefined);
  }
  await execute("DELETE FROM hashtags WHERE tag='smoketest'").catch(() => undefined);

  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end();
  await closeRedis();

  console.log(`\n═══ SMOKE RESULT: ${passed} passed, ${failed} failed ═══`);
  if (failures.length > 0) {
    console.log('Failures:');
    for (const f of failures) console.log('  -', f);
  }
  process.exit(failed === 0 ? 0 : 1);
}
