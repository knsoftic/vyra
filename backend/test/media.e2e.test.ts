/**
 * Processing pipeline and playback, end to end against the real database.
 *
 * The centrepiece is exit criterion 5: a worker killed mid-job must resume
 * without duplicating or losing output. That is simulated honestly — a stage is
 * claimed and then abandoned, exactly as a `kill -9` would leave it — and the
 * recovery path is asserted rather than assumed.
 *
 * Playback privacy is the other focus, because it is the point where "followers
 * only" either means something or does not.
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
const pipeline = await import('../src/modules/media/pipeline.ts');
const { advance } = await import('../src/jobs/pipeline.worker.ts');
const { signMediaUrl, verifyMediaUrl, mediaUrlFor } = await import('../src/core/signed-url.ts');

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
  const email = `p5_${suffix}@vyra.test`;
  createdEmails.push(email);
  const res = await api<Session>('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username: `p5_${suffix}`,
    birthdate: '1995-04-12',
    device: { deviceId: `dev-p5-${suffix}`, platform: 'web' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return { token: res.body.data!.tokens.accessToken, publicId: res.body.data!.user.id, id: row!.id };
}

/** Creates a video row directly — this suite is about processing, not publishing. */
async function makeVideo(
  userId: number,
  privacy: 'public' | 'followers' | 'friends' | 'private' = 'public',
  status = 'processing',
): Promise<{ id: number; publicId: string }> {
  const publicId = `V${Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(25, '0')}`;
  const result = await execute(
    `INSERT INTO videos (public_id, user_id, caption, duration_sec, privacy, status, processing_status)
     VALUES (:publicId, :userId, 'pipeline test', 8, :privacy, :status, 'pending')`,
    { publicId, userId, privacy, status },
  );
  return { id: result.insertId, publicId };
}

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  // Wrapped in try/finally: a cleanup failure must still close the pool and the
  // Redis client, or the process hangs and the real error is never reported.
  try {
    for (const email of createdEmails) {
      const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
      if (!user) continue;
      const id = user.id;
      await execute(
        'DELETE ps FROM processing_stages ps JOIN videos v ON v.id = ps.video_id WHERE v.user_id = ?',
        [id],
      );
      await execute(
        'DELETE vp FROM video_probes vp JOIN videos v ON v.id = vp.video_id WHERE v.user_id = ?',
        [id],
      );
      await execute(
        'DELETE q FROM video_quality_scores q JOIN videos v ON v.id = q.video_id WHERE v.user_id = ?',
        [id],
      );
      await execute(
        'DELETE va FROM video_assets va JOIN videos v ON v.id = va.video_id WHERE v.user_id = ?',
        [id],
      );
      await execute('DELETE FROM render_jobs WHERE user_id = ?', [id]);
      await execute('DELETE FROM videos WHERE user_id = ?', [id]);
      // The follow tests generate notifications, which hold a foreign key to users.
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
    // fetch keeps sockets alive, and `close()` waits for every open connection —
    // so without this the teardown hangs and the process never exits.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await closeRedis();
  }
});

// ── Stage bookkeeping ──

test('a video gets one row per stage, and initialising twice is harmless', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);

  await pipeline.initStages(video.id);
  await pipeline.initStages(video.id);

  const stages = await pipeline.getStages(video.id);
  assert.equal(stages.length, pipeline.STAGES.length);
  assert.equal(new Set(stages.map((s) => s.stage)).size, pipeline.STAGES.length);
});

test('stages run in order', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  await pipeline.initStages(video.id);

  assert.equal(await pipeline.nextStage(video.id), 'probe');
  await pipeline.claimStage(video.id, 'probe');
  await pipeline.completeStage(video.id, 'probe', { probed: false });
  assert.equal(await pipeline.nextStage(video.id), 'render');
});

test('a stage can only be claimed once', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  await pipeline.initStages(video.id);

  // Two workers reaching for the same stage at the same moment.
  const [first, second] = await Promise.all([
    pipeline.claimStage(video.id, 'probe'),
    pipeline.claimStage(video.id, 'probe'),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1, 'exactly one worker may claim a stage');
});

test('a completed stage is never re-run', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  await pipeline.initStages(video.id);

  await pipeline.claimStage(video.id, 'probe');
  await pipeline.completeStage(video.id, 'probe', { done: true });

  assert.equal(await pipeline.claimStage(video.id, 'probe'), false);
  const output = await pipeline.stageOutput<{ done: boolean }>(video.id, 'probe');
  assert.deepEqual(output, { done: true }, 'the original output must survive');
});

test('a stage gives up after the attempt limit', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  await pipeline.initStages(video.id);

  for (let i = 0; i < pipeline.MAX_STAGE_ATTEMPTS; i += 1) {
    assert.equal(await pipeline.claimStage(video.id, 'probe'), true, `attempt ${i + 1}`);
    await pipeline.failStage(video.id, 'probe', 'simulated failure');
  }

  assert.equal(await pipeline.claimStage(video.id, 'probe'), false, 'must stop retrying');
  assert.equal(await pipeline.nextStage(video.id), null, 'a dead stage stops the pipeline');
});

// ── Exit criterion 5: a killed worker resumes ──

test('a worker killed mid-stage resumes without losing or duplicating work', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  await pipeline.initStages(video.id);

  // Two stages finish normally.
  await pipeline.claimStage(video.id, 'probe');
  await pipeline.completeStage(video.id, 'probe', { probed: false, marker: 'first-run' });
  await pipeline.claimStage(video.id, 'render');
  await pipeline.completeStage(video.id, 'render', { outputKey: 'renders/x.mp4' });

  // The worker claims the third and is then killed: the row stays `running`.
  assert.equal(await pipeline.claimStage(video.id, 'transcode'), true);
  const midway = await pipeline.getStages(video.id);
  assert.equal(midway.find((s) => s.stage === 'transcode')?.status, 'running');

  // Nothing else may pick it up while it still looks alive.
  assert.equal(await pipeline.claimStage(video.id, 'transcode'), false);

  // The stall sweeper releases it (0 minutes so the test does not wait).
  const requeued = await pipeline.requeueStalledStages(0);
  assert.ok(requeued >= 1, 'the abandoned stage should be returned to the queue');

  // A fresh worker resumes at exactly the abandoned stage.
  assert.equal(await pipeline.nextStage(video.id), 'transcode');

  // And the completed work was preserved, not repeated.
  const probeOutput = await pipeline.stageOutput<{ marker: string }>(video.id, 'probe');
  assert.equal(probeOutput?.marker, 'first-run', 'earlier output must survive the restart');

  const stages = await pipeline.getStages(video.id);
  assert.equal(stages.find((s) => s.stage === 'probe')?.status, 'complete');
  assert.equal(stages.find((s) => s.stage === 'render')?.status, 'complete');
  // The attempt counter is not reset, so a stage that keeps killing workers
  // still hits its limit instead of looping forever.
  assert.equal(Number(stages.find((s) => s.stage === 'transcode')?.attempts), 1);
});

test('waiting on a slow render does not exhaust the stage retry budget', async () => {
  // Regression: the render stage used to be returned to `pending` after each
  // poll while the render job was still queued — but claiming it had already
  // consumed an attempt. After three polls the stage hit its limit and the
  // video stalled forever despite nothing having failed. A live run surfaced
  // this; the suite could not, because its videos have no render job at all.
  const user = await registerUser();
  const video = await makeVideo(user.id);
  await execute(
    `INSERT INTO render_jobs (public_id, user_id, video_id, edit_list, status)
     VALUES (:publicId, :userId, :videoId, '{}', 'queued')`,
    { publicId: `RJ${Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(24, '0')}`,
      userId: user.id, videoId: video.id },
  );

  // Poll far more times than the attempt limit.
  for (let i = 0; i < pipeline.MAX_STAGE_ATTEMPTS * 3; i += 1) {
    await advance(video.id);
  }

  const stages = await pipeline.getStages(video.id);
  const render = stages.find((s) => s.stage === 'render');
  assert.equal(render?.status, 'pending', 'a waiting stage should still be runnable');
  assert.ok(
    Number(render?.attempts) < pipeline.MAX_STAGE_ATTEMPTS,
    `waiting burned ${render?.attempts} attempts — the video would stall forever`,
  );
  assert.equal(
    await pipeline.nextStage(video.id),
    'render',
    'the pipeline must still be willing to run the stage',
  );
});

test('the render stage completes once its job finishes', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  const publicId = `RJ${Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(24, '0')}`;
  await execute(
    `INSERT INTO render_jobs (public_id, user_id, video_id, edit_list, status)
     VALUES (:publicId, :userId, :videoId, '{}', 'queued')`,
    { publicId, userId: user.id, videoId: video.id },
  );

  await advance(video.id); // probe
  await advance(video.id); // render defers

  await execute(
    "UPDATE render_jobs SET status = 'complete', output_key = 'renders/x.mp4' WHERE public_id = :p",
    { p: publicId },
  );

  await advance(video.id);
  const stages = await pipeline.getStages(video.id);
  assert.equal(stages.find((s) => s.stage === 'render')?.status, 'complete');
});

test('the stall sweeper leaves a genuinely running stage alone', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  await pipeline.initStages(video.id);
  await pipeline.claimStage(video.id, 'probe');

  // A 30-minute threshold: a stage claimed moments ago is still working.
  const requeued = await pipeline.requeueStalledStages(30);
  const stages = await pipeline.getStages(video.id);
  assert.equal(stages.find((s) => s.stage === 'probe')?.status, 'running');
  assert.equal(requeued, 0);
});

test('advancing runs exactly one stage per call', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);

  const first = await advance(video.id);
  assert.equal(first, 'probe');

  const stages = await pipeline.getStages(video.id);
  const finished = stages.filter((s) => s.status === 'complete' || s.status === 'skipped');
  assert.equal(finished.length, 1, 'one call must not run the whole pipeline');
});

test('the pipeline runs to completion and marks the video published', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);

  // Without FFmpeg the media stages skip rather than fail — the pipeline should
  // still finish and publish.
  for (let i = 0; i < 12; i += 1) {
    const stage = await advance(video.id);
    if (!stage) break;
  }

  const progress = await pipeline.pipelineProgress(video.id);
  assert.equal(progress.currentStage, null, `pipeline stalled at ${progress.currentStage}`);
  assert.equal(progress.failed, 0, `stages failed: ${JSON.stringify(progress.stages)}`);
  assert.equal(progress.percent, 100);

  const row = await queryOne<{ status: string; processing_status: string }>(
    'SELECT status, processing_status FROM videos WHERE id = ?', [video.id],
  );
  assert.equal(row!.processing_status, 'complete');
  assert.equal(row!.status, 'published');
});

test('skipped stages record why they were skipped', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  for (let i = 0; i < 12; i += 1) {
    if (!(await advance(video.id))) break;
  }

  const stages = await pipeline.getStages(video.id);
  const transcode = stages.find((s) => s.stage === 'transcode');
  assert.equal(transcode?.status, 'skipped');
  assert.match(String(transcode?.error), /FFmpeg/, 'the reason must be actionable');
});

test('quality scoring produces a decomposed score', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  for (let i = 0; i < 12; i += 1) {
    if (!(await advance(video.id))) break;
  }

  const score = await queryOne<Record<string, unknown>>(
    'SELECT * FROM video_quality_scores WHERE video_id = ?', [video.id],
  );
  assert.ok(score, 'a quality score should have been written');
  for (const column of [
    'technical', 'content_relevance', 'thumbnail_quality', 'caption_relevance',
    'spam_probability', 'duplicate_probability', 'safety_status',
  ]) {
    assert.ok(score[column] !== undefined && score[column] !== null, `${column} must be stored`);
  }
  assert.ok(String(score.model_version).length > 0);
});

// ── Exit criterion 6: admin reprocessing ──

test('resetting the pipeline makes it run again without touching the source', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  await execute(
    `INSERT INTO video_assets (video_id, kind, storage_key, label)
     VALUES (?, 'original', 'videos/2026/08/29/source.mp4', 'source')`,
    [video.id],
  );

  for (let i = 0; i < 12; i += 1) {
    if (!(await advance(video.id))) break;
  }
  assert.equal((await pipeline.pipelineProgress(video.id)).percent, 100);

  await pipeline.resetPipeline(video.id);

  const after = await pipeline.pipelineProgress(video.id);
  assert.equal(after.percent, 0, 'every stage should be pending again');
  assert.equal(after.currentStage, 'probe');

  const stages = await pipeline.getStages(video.id);
  for (const stage of stages) {
    assert.equal(Number(stage.attempts), 0, 'attempts should be reset so retries are available');
  }

  // The original upload must be untouched by reprocessing.
  const original = await queryOne<{ storage_key: string }>(
    "SELECT storage_key FROM video_assets WHERE video_id = ? AND kind = 'original'", [video.id],
  );
  assert.equal(original?.storage_key, 'videos/2026/08/29/source.mp4');
});

test('a single stage can be reset on its own', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  for (let i = 0; i < 12; i += 1) {
    if (!(await advance(video.id))) break;
  }

  await pipeline.resetPipeline(video.id, ['quality']);

  const stages = await pipeline.getStages(video.id);
  assert.equal(stages.find((s) => s.stage === 'quality')?.status, 'pending');
  // Finished means complete OR skipped: without a source asset, probe correctly
  // skips rather than completing.
  const probeStatus = stages.find((s) => s.stage === 'probe')?.status;
  assert.ok(
    probeStatus === 'complete' || probeStatus === 'skipped',
    `other stages must stay finished, probe was ${probeStatus}`,
  );
  assert.equal(await pipeline.nextStage(video.id), 'quality');
});

// ── Signed URLs ──

test('a signed URL verifies, and tampering with it does not', async () => {
  const key = 'videos/2026/08/29/private.mp4';
  const url = signMediaUrl(key, 'VIEWER1', 3600);
  const parsed = new URL(url);

  assert.doesNotThrow(() =>
    verifyMediaUrl({
      key,
      expires: parsed.searchParams.get('expires')!,
      viewer: 'VIEWER1',
      signature: parsed.searchParams.get('sig')!,
    }),
  );

  // A different viewer cannot reuse the link.
  assert.throws(() =>
    verifyMediaUrl({
      key,
      expires: parsed.searchParams.get('expires')!,
      viewer: 'VIEWER2',
      signature: parsed.searchParams.get('sig')!,
    }),
  );

  // Nor can the expiry be extended.
  assert.throws(() =>
    verifyMediaUrl({
      key,
      expires: String(Number(parsed.searchParams.get('expires')) + 86400),
      viewer: 'VIEWER1',
      signature: parsed.searchParams.get('sig')!,
    }),
  );

  // Nor can it be pointed at a different object.
  assert.throws(() =>
    verifyMediaUrl({
      key: 'videos/2026/08/29/other.mp4',
      expires: parsed.searchParams.get('expires')!,
      viewer: 'VIEWER1',
      signature: parsed.searchParams.get('sig')!,
    }),
  );
});

test('an expired link is rejected', () => {
  const key = 'videos/a/b/c.mp4';
  const url = new URL(signMediaUrl(key, 'VIEWER1', -10));
  assert.throws(
    () =>
      verifyMediaUrl({
        key,
        expires: url.searchParams.get('expires')!,
        viewer: 'VIEWER1',
        signature: url.searchParams.get('sig')!,
      }),
    /expired/,
  );
});

test('public media is served unsigned so it stays cacheable', () => {
  const url = mediaUrlFor('videos/a/b/c.mp4', 'public', 'VIEWER1');
  assert.ok(!url.includes('sig='), 'signing public media would defeat edge caching');
});

test('restricted media requires a viewer', () => {
  assert.throws(() => mediaUrlFor('videos/a/b/c.mp4', 'private', undefined), /not public/);
  assert.ok(mediaUrlFor('videos/a/b/c.mp4', 'followers', 'VIEWER1').includes('sig='));
});

// ── Playback privacy ──

async function publishedVideo(
  userId: number,
  privacy: 'public' | 'followers' | 'friends' | 'private',
): Promise<string> {
  const video = await makeVideo(userId, privacy, 'published');
  await execute(
    "UPDATE videos SET processing_status = 'complete', hls_key = :key WHERE id = :id",
    { key: `hls/${video.publicId}/master.m3u8`, id: video.id },
  );
  return video.publicId;
}

test('a public video plays for anyone, signed-out included', async () => {
  const owner = await registerUser();
  const id = await publishedVideo(owner.id, 'public');

  const anon = await api<{ ready: boolean; hlsUrl: string }>(
    'GET', `/api/v1/videos/${id}/playback`,
  );
  assert.equal(anon.status, 200);
  assert.equal(anon.body.data!.ready, true);
  assert.ok(!anon.body.data!.hlsUrl.includes('sig='), 'public media should be unsigned');
});

test('a private video is invisible to everyone but its owner', async () => {
  const owner = await registerUser();
  const other = await registerUser();
  const id = await publishedVideo(owner.id, 'private');

  assert.equal((await api('GET', `/api/v1/videos/${id}/playback`)).status, 404);
  assert.equal(
    (await api('GET', `/api/v1/videos/${id}/playback`, undefined, other.token)).status,
    404,
  );

  const mine = await api<{ ready: boolean; hlsUrl: string }>(
    'GET', `/api/v1/videos/${id}/playback`, undefined, owner.token,
  );
  assert.equal(mine.status, 200);
  assert.ok(mine.body.data!.hlsUrl.includes('sig='), 'restricted media must be signed');
});

test('a followers-only video needs an actual follow', async () => {
  const owner = await registerUser();
  const viewer = await registerUser();
  const id = await publishedVideo(owner.id, 'followers');

  assert.equal(
    (await api('GET', `/api/v1/videos/${id}/playback`, undefined, viewer.token)).status,
    404,
    'a non-follower must not see it',
  );

  await api('POST', `/api/v1/users/${owner.publicId}/follow`, undefined, viewer.token);
  assert.equal(
    (await api('GET', `/api/v1/videos/${id}/playback`, undefined, viewer.token)).status,
    200,
  );
});

test('a friends-only video needs the follow to be mutual', async () => {
  const owner = await registerUser();
  const viewer = await registerUser();
  const id = await publishedVideo(owner.id, 'friends');

  await api('POST', `/api/v1/users/${owner.publicId}/follow`, undefined, viewer.token);
  assert.equal(
    (await api('GET', `/api/v1/videos/${id}/playback`, undefined, viewer.token)).status,
    404,
    'one-way following is not friendship',
  );

  await api('POST', `/api/v1/users/${viewer.publicId}/follow`, undefined, owner.token);
  assert.equal(
    (await api('GET', `/api/v1/videos/${id}/playback`, undefined, viewer.token)).status,
    200,
  );
});

test('a block hides a video that would otherwise be public', async () => {
  const owner = await registerUser();
  const viewer = await registerUser();
  const id = await publishedVideo(owner.id, 'public');

  assert.equal(
    (await api('GET', `/api/v1/videos/${id}/playback`, undefined, viewer.token)).status,
    200,
  );

  await api('POST', `/api/v1/users/${viewer.publicId}/block`, undefined, owner.token);
  assert.equal(
    (await api('GET', `/api/v1/videos/${id}/playback`, undefined, viewer.token)).status,
    404,
    'a blocked viewer must not reach the video',
  );
});

test('a video still processing reports progress instead of a broken URL', async () => {
  const owner = await registerUser();
  const video = await makeVideo(owner.id, 'public', 'processing');
  await pipeline.initStages(video.id);

  const res = await api<{ ready: boolean; progress: { percent: number } }>(
    'GET', `/api/v1/videos/${video.publicId}/playback`, undefined, owner.token,
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.data!.ready, false, 'an unfinished video must not claim to be playable');
  assert.ok(typeof res.body.data!.progress.percent === 'number');
});

test('the owner can read their own processing progress and quality score', async () => {
  const owner = await registerUser();
  const other = await registerUser();
  const video = await makeVideo(owner.id);
  for (let i = 0; i < 12; i += 1) {
    if (!(await advance(video.id))) break;
  }

  const progress = await api<{ percent: number }>(
    'GET', `/api/v1/videos/${video.publicId}/processing`, undefined, owner.token,
  );
  assert.equal(progress.status, 200);
  assert.equal(progress.body.data!.percent, 100);

  const quality = await api<{ technical: number; spamProbability: number }>(
    'GET', `/api/v1/videos/${video.publicId}/quality`, undefined, owner.token,
  );
  assert.equal(quality.status, 200);
  assert.ok(typeof quality.body.data!.technical === 'number');

  // Another user may not read either.
  assert.equal(
    (await api('GET', `/api/v1/videos/${video.publicId}/processing`, undefined, other.token)).status,
    404,
  );
  assert.equal(
    (await api('GET', `/api/v1/videos/${video.publicId}/quality`, undefined, other.token)).status,
    404,
  );
});

test('reprocessing requires admin rights', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);

  const res = await api(
    'POST', `/api/v1/admin/videos/${video.publicId}/reprocess`,
    { reason: 'trying it on' }, user.token,
  );
  assert.equal(res.status, 403, 'an ordinary account must not trigger reprocessing');
});

test('renditions are listed alongside the HLS manifest', async () => {
  const owner = await registerUser();
  const video = await makeVideo(owner.id, 'public', 'published');
  await execute(
    "UPDATE videos SET processing_status = 'complete', hls_key = :key WHERE id = :id",
    { key: `hls/${video.publicId}/master.m3u8`, id: video.id },
  );
  for (const [label, height, bitrate] of [['360p', 360, 600], ['720p', 720, 2200]] as const) {
    await execute(
      `INSERT INTO video_assets (video_id, kind, storage_key, width, height, bitrate_kbps, label)
       VALUES (:id, 'rendition', :key, :w, :h, :b, :label)`,
      { id: video.id, key: `renders/${video.publicId}/${label}.mp4`, w: 640, h: height, b: bitrate, label },
    );
  }

  const res = await api<{ renditions: { label: string; url: string }[] }>(
    'GET', `/api/v1/videos/${video.publicId}/playback`,
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.data!.renditions.length, 2);
  // Ascending by height, so a player without adaptive support gets the cheapest first.
  assert.deepEqual(res.body.data!.renditions.map((r) => r.label), ['360p', '720p']);
});

test('processing stages leave no orphan rows for a video', async () => {
  const user = await registerUser();
  const video = await makeVideo(user.id);
  await pipeline.initStages(video.id);

  const rows = await query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM processing_stages WHERE video_id = ?', [video.id],
  );
  assert.equal(Number(rows[0]!.n), pipeline.STAGES.length);
});
