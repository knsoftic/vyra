/**
 * Creation pipeline end-to-end — upload, drafts, publish, catalogue.
 *
 * Covers the Phase 4 exit criteria that do not need a physical device:
 *   - an upload survives interruption and resumes (criterion 5)
 *   - drafts persist server-side, so they outlive an app update (criterion 3)
 *   - an admin can add a filter and it appears without an app release (criterion 4)
 *
 * A small chunk size is configured before the app loads so multi-chunk behaviour
 * can be exercised with kilobytes instead of megabytes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.RATE_LIMIT_ENABLED = 'false';
process.env.NODE_ENV = 'development';
// 4 KB chunks: enough to prove chunking without moving megabytes.
process.env.UPLOAD_CHUNK_SIZE = '4096';

const { createApp } = await import('../src/app.ts');
const { pool, execute, queryOne } = await import('../src/core/db.ts');
const { closeRedis } = await import('../src/core/redis.ts');
const { upsertAsset, setAssetEnabled, invalidateCatalogue } = await import(
  '../src/modules/creative/catalogue.service.ts'
);

const CHUNK = 4096;

let server: Server;
let base = '';
const createdEmails: string[] = [];
const createdSlugs: string[] = [];
const createdTags: string[] = [];

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, string[]> };
  meta?: { hasMore: boolean; nextCursor?: string };
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

async function putChunk(
  uploadId: string,
  index: number,
  data: Buffer,
  token: string,
): Promise<{ status: number; body: Envelope<{ received: number; duplicate: boolean }> }> {
  const res = await fetch(`${base}/api/v1/uploads/${uploadId}/chunks/${index}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
    body: new Uint8Array(data),
  });
  return { status: res.status, body: (await res.json()) as Envelope<{ received: number; duplicate: boolean }> };
}

interface Session {
  user: { id: string };
  tokens: { accessToken: string };
}

async function registerUser(): Promise<{ token: string; userId: string; email: string }> {
  const id = Math.random().toString(36).slice(2, 10);
  const email = `p4_${id}@vyra.test`;
  createdEmails.push(email);
  const res = await api<Session>('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username: `p4_${id}`,
    birthdate: '1995-04-12',
    device: { deviceId: `dev-p4-${id}`, platform: 'web' },
  });
  assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.body.error)}`);
  return {
    token: res.body.data!.tokens.accessToken,
    userId: res.body.data!.user.id,
    email,
  };
}

/** Deterministic filler so assembled bytes can be compared exactly. */
function makeFile(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i += 1) buf[i] = i % 251;
  return buf;
}

function chunksOf(file: Buffer): Buffer[] {
  const out: Buffer[] = [];
  for (let offset = 0; offset < file.length; offset += CHUNK) {
    out.push(file.subarray(offset, Math.min(offset + CHUNK, file.length)));
  }
  return out;
}

async function startUpload(
  token: string,
  sizeBytes: number,
): Promise<{ id: string; totalChunks: number; storageKey: string }> {
  const res = await api<{ id: string; totalChunks: number; storageKey: string; chunkSize: number }>(
    'POST', '/api/v1/uploads',
    { filename: 'clip.mp4', sizeBytes, contentType: 'video/mp4', durationMs: 5000 },
    token,
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  assert.equal(res.body.data!.chunkSize, CHUNK, 'the configured chunk size should be reported');
  return res.body.data!;
}

/** Uploads a file completely and returns its storage key. */
async function uploadFile(token: string, file: Buffer): Promise<string> {
  const session = await startUpload(token, file.length);
  const parts = chunksOf(file);
  for (const [i, part] of parts.entries()) {
    const r = await putChunk(session.id, i, part, token);
    assert.equal(r.status, 200, `chunk ${i}: ${JSON.stringify(r.body.error)}`);
  }
  const done = await api<{ storageKey: string }>(
    'POST', `/api/v1/uploads/${session.id}/complete`, {}, token,
  );
  assert.equal(done.status, 200, JSON.stringify(done.body.error));
  return done.body.data!.storageKey;
}

const edlFor = (sourceKey: string) => ({
  version: 1,
  clips: [{
    id: 'c1', sourceKey, trimStartMs: 0, trimEndMs: 5000, speed: 1,
    rotation: 0, volume: 100, muted: false,
  }],
  effects: [],
  texts: [],
  stickers: [],
  audio: [],
  aspect: '9:16',
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
    await execute(
      'DELETE uc FROM upload_chunks uc JOIN upload_sessions us ON us.id = uc.session_id WHERE us.user_id = ?',
      [id],
    );
    await execute('DELETE FROM render_jobs WHERE user_id = ?', [id]);
    await execute(
      'DELETE vh FROM video_hashtags vh JOIN videos v ON v.id = vh.video_id WHERE v.user_id = ?',
      [id],
    );
    await execute(
      'DELETE vm FROM video_mentions vm JOIN videos v ON v.id = vm.video_id WHERE v.user_id = ?',
      [id],
    );
    await execute(
      'DELETE va FROM video_assets va JOIN videos v ON v.id = va.video_id WHERE v.user_id = ?',
      [id],
    );
    await execute('DELETE FROM videos WHERE user_id = ?', [id]);
    await execute('DELETE FROM upload_sessions WHERE user_id = ?', [id]);
    await execute('DELETE FROM video_drafts WHERE user_id = ?', [id]);
    await execute('DELETE FROM security_events WHERE user_id = ?', [id]);
    await execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
    await execute('DELETE FROM user_devices WHERE user_id = ?', [id]);
    await execute('DELETE FROM login_attempts WHERE user_id = ? OR email = ?', [id, email]);
    await execute('DELETE FROM referral_codes WHERE user_id = ?', [id]);
    await execute('DELETE FROM wallets WHERE user_id = ?', [id]);
    await execute('DELETE FROM user_profiles WHERE user_id = ?', [id]);
    await execute('DELETE FROM users WHERE id = ?', [id]);
  }
  for (const slug of createdSlugs) {
    await execute('DELETE FROM creative_assets WHERE slug = ?', [slug]);
  }
  // After the videos, so no video_hashtags row still references them.
  for (const tag of createdTags) {
    await execute('DELETE FROM hashtags WHERE tag = ?', [tag]);
  }
  await invalidateCatalogue();
  } finally {
    // fetch keeps sockets alive, and `close()` waits for every open connection —
    // so without this the teardown hangs and the process never exits. The
    // try/finally matters too: a failed cleanup statement must not stop the
    // handles being released, or the real error is masked by a hang.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await closeRedis();
  }
});

// ── Catalogue ──

test('the catalogue serves all 20 filters plus effects, packs and fonts', async () => {
  const { token } = await registerUser();
  const res = await api<{
    filters: { slug: string; grade: Record<string, number> }[];
    effects: unknown[];
    stickerPacks: unknown[];
    fonts: unknown[];
    adjustments: unknown[];
    version: string;
  }>('GET', '/api/v1/creative/catalogue', undefined, token);

  assert.equal(res.status, 200);
  const cat = res.body.data!;
  assert.equal(cat.filters.length, 20, 'PHASE_04 requires 20 base filters');
  assert.ok(cat.effects.length >= 12);
  assert.ok(cat.stickerPacks.length >= 1);
  assert.ok(cat.fonts.length >= 1, 'fonts must be served');
  assert.equal(cat.adjustments.length, 11, 'eleven manual adjustment controls');
  assert.ok(cat.version.length > 0);

  // The grade must survive the database round trip intact — this is what keeps
  // the device preview and the server render in agreement.
  const bw = cat.filters.find((f) => f.slug === 'black_white');
  assert.ok(bw, 'black_white should be in the catalogue');
  assert.equal(bw.grade.saturation, -100);
});

test('an admin can add a filter and it appears without an app release', async () => {
  const { token } = await registerUser();
  const slug = `test_filter_${Math.random().toString(36).slice(2, 8)}`;
  createdSlugs.push(slug);

  const before = await api<{ filters: { slug: string }[] }>(
    'GET', '/api/v1/creative/catalogue', undefined, token,
  );
  assert.ok(!before.body.data!.filters.some((f) => f.slug === slug));

  // Exactly what the admin panel will do: write a row, drop the cache.
  await upsertAsset({
    kind: 'filter',
    slug,
    name: 'Test Filter',
    category: 'colour',
    params: {
      grade: { contrast: 25, saturation: 40, temperature: -15 },
      previewColor: 'rgba(0,255,0,0.2)',
      defaultIntensity: 80,
    },
    sortOrder: 99,
  });

  const after = await api<{ filters: { slug: string; grade: Record<string, number>; name: string }[] }>(
    'GET', '/api/v1/creative/catalogue', undefined, token,
  );
  const added = after.body.data!.filters.find((f) => f.slug === slug);
  assert.ok(added, 'the new filter should be visible immediately');
  assert.equal(added.name, 'Test Filter');
  assert.equal(added.grade.saturation, 40);
  assert.equal(added.grade.brightness, 0, 'unspecified controls should default to neutral');
});

test('disabling a filter removes it from the catalogue at once', async () => {
  const { token } = await registerUser();
  const slug = `test_disable_${Math.random().toString(36).slice(2, 8)}`;
  createdSlugs.push(slug);

  await upsertAsset({ kind: 'filter', slug, name: 'Temp', params: { grade: { contrast: 10 } } });
  const withIt = await api<{ filters: { slug: string }[] }>(
    'GET', '/api/v1/creative/catalogue', undefined, token,
  );
  assert.ok(withIt.body.data!.filters.some((f) => f.slug === slug));

  await setAssetEnabled('filter', slug, false);
  const without = await api<{ filters: { slug: string }[] }>(
    'GET', '/api/v1/creative/catalogue', undefined, token,
  );
  assert.ok(!without.body.data!.filters.some((f) => f.slug === slug));
});

// ── Upload ──

test('a single-chunk upload completes', async () => {
  const { token } = await registerUser();
  const file = makeFile(1000);
  const key = await uploadFile(token, file);
  assert.match(key, /^videos\//);
});

test('a multi-chunk upload assembles to exactly the original bytes', async () => {
  const { token } = await registerUser();
  const file = makeFile(CHUNK * 3 + 517);
  const session = await startUpload(token, file.length);
  assert.equal(session.totalChunks, 4);

  const parts = chunksOf(file);
  for (const [i, part] of parts.entries()) {
    const r = await putChunk(session.id, i, part, token);
    assert.equal(r.status, 200);
  }

  const done = await api<{ storageKey: string; sizeBytes: number }>(
    'POST', `/api/v1/uploads/${session.id}/complete`,
    { checksum: createHash('sha256').update(file).digest('hex') },
    token,
  );
  assert.equal(done.status, 200, JSON.stringify(done.body.error));
  assert.equal(done.body.data!.sizeBytes, file.length);
});

test('chunks may arrive in any order', async () => {
  const { token } = await registerUser();
  const file = makeFile(CHUNK * 3);
  const session = await startUpload(token, file.length);
  const parts = chunksOf(file);

  for (const i of [2, 0, 1]) {
    const r = await putChunk(session.id, i, parts[i]!, token);
    assert.equal(r.status, 200);
  }

  const done = await api<{ sizeBytes: number }>(
    'POST', `/api/v1/uploads/${session.id}/complete`,
    { checksum: createHash('sha256').update(file).digest('hex') },
    token,
  );
  assert.equal(done.status, 200, 'out-of-order chunks must still assemble correctly');
});

test('an interrupted upload resumes and sends only the missing chunks', async () => {
  const { token } = await registerUser();
  const file = makeFile(CHUNK * 4);
  const session = await startUpload(token, file.length);
  const parts = chunksOf(file);

  // The "connection dies" after two of four chunks.
  await putChunk(session.id, 0, parts[0]!, token);
  await putChunk(session.id, 1, parts[1]!, token);

  // Completing now must fail rather than assemble a truncated file.
  const early = await api('POST', `/api/v1/uploads/${session.id}/complete`, {}, token);
  assert.equal(early.status, 409, 'an incomplete upload must not assemble');

  // The client comes back and asks what is missing.
  const status = await api<{ receivedChunks: number[]; totalChunks: number; status: string }>(
    'GET', `/api/v1/uploads/${session.id}`, undefined, token,
  );
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.data!.receivedChunks, [0, 1]);
  assert.equal(status.body.data!.status, 'uploading');

  const missing = Array.from({ length: status.body.data!.totalChunks }, (_, i) => i).filter(
    (i) => !status.body.data!.receivedChunks.includes(i),
  );
  assert.deepEqual(missing, [2, 3]);

  for (const i of missing) {
    const r = await putChunk(session.id, i, parts[i]!, token);
    assert.equal(r.status, 200);
  }

  const done = await api<{ sizeBytes: number }>(
    'POST', `/api/v1/uploads/${session.id}/complete`,
    { checksum: createHash('sha256').update(file).digest('hex') },
    token,
  );
  assert.equal(done.status, 200, 'the resumed upload should complete');
  assert.equal(done.body.data!.sizeBytes, file.length);
});

test('re-sending a chunk that already arrived is a harmless no-op', async () => {
  const { token } = await registerUser();
  const file = makeFile(CHUNK * 2);
  const session = await startUpload(token, file.length);
  const parts = chunksOf(file);

  const first = await putChunk(session.id, 0, parts[0]!, token);
  assert.equal(first.body.data!.duplicate, false);

  // A client that retried after a response it never saw.
  const again = await putChunk(session.id, 0, parts[0]!, token);
  assert.equal(again.status, 200);
  assert.equal(again.body.data!.duplicate, true);
  assert.equal(again.body.data!.received, 1, 'a duplicate must not inflate the count');

  await putChunk(session.id, 1, parts[1]!, token);
  const done = await api<{ sizeBytes: number }>(
    'POST', `/api/v1/uploads/${session.id}/complete`,
    { checksum: createHash('sha256').update(file).digest('hex') },
    token,
  );
  assert.equal(done.status, 200);
});

test('a wrongly sized chunk is refused', async () => {
  const { token } = await registerUser();
  const file = makeFile(CHUNK * 2);
  const session = await startUpload(token, file.length);

  // Short chunk in a non-final position would leave a gap in the file.
  const short = await putChunk(session.id, 0, makeFile(100), token);
  assert.equal(short.status, 400);
  assert.match(short.body.error!.message, /should be/);
});

test('a corrupted upload is caught by its checksum', async () => {
  const { token } = await registerUser();
  const file = makeFile(CHUNK + 200);
  const session = await startUpload(token, file.length);
  const parts = chunksOf(file);

  await putChunk(session.id, 0, parts[0]!, token);
  // Same length, different bytes — only a checksum can catch this.
  const tampered = Buffer.alloc(parts[1]!.length, 0xff);
  await putChunk(session.id, 1, tampered, token);

  const done = await api('POST', `/api/v1/uploads/${session.id}/complete`,
    { checksum: createHash('sha256').update(file).digest('hex') }, token);
  assert.equal(done.status, 409);
  assert.match(done.body.error!.message, /checksum/i);
});

test('an out-of-range chunk index is refused', async () => {
  const { token } = await registerUser();
  const session = await startUpload(token, 1000);
  const r = await putChunk(session.id, 99, makeFile(10), token);
  assert.equal(r.status, 400);
});

test('one user cannot upload into another user\'s session', async () => {
  const a = await registerUser();
  const b = await registerUser();
  const session = await startUpload(a.token, CHUNK);

  const r = await putChunk(session.id, 0, makeFile(CHUNK), b.token);
  assert.equal(r.status, 404, 'another user\'s session must not even be acknowledged');

  const status = await api('GET', `/api/v1/uploads/${session.id}`, undefined, b.token);
  assert.equal(status.status, 404);
});

test('an unsupported format and an oversized file are refused', async () => {
  const { token } = await registerUser();

  const badType = await api('POST', '/api/v1/uploads',
    { filename: 'x.exe', sizeBytes: 1000, contentType: 'application/x-msdownload' }, token);
  assert.equal(badType.status, 400);

  const tooBig = await api('POST', '/api/v1/uploads',
    { filename: 'x.mp4', sizeBytes: 5 * 1024 * 1024 * 1024, contentType: 'video/mp4' }, token);
  assert.equal(tooBig.status, 400);
});

test('a video longer than the admin limit is refused', async () => {
  const { token } = await registerUser();
  const res = await api('POST', '/api/v1/uploads', {
    filename: 'long.mp4',
    sizeBytes: 1000,
    contentType: 'video/mp4',
    // The seeded limit is 600 seconds.
    durationMs: 700 * 1000,
  }, token);
  assert.equal(res.status, 400);
  assert.match(res.body.error!.message, /seconds/);
});

// ── Drafts ──

test('a draft is stored server-side and survives a fresh sign-in', async () => {
  const { token, email } = await registerUser();
  const key = await uploadFile(token, makeFile(1000));

  const saved = await api<{ id: string; clipCount: number; durationSec: number }>(
    'POST', '/api/v1/drafts',
    { caption: 'work in progress', editList: edlFor(key) },
    token,
  );
  assert.equal(saved.status, 201, JSON.stringify(saved.body.error));
  const draftId = saved.body.data!.id;
  assert.equal(saved.body.data!.clipCount, 1);
  assert.equal(saved.body.data!.durationSec, 5);

  // A new sign-in stands in for a reinstall or an app update: the client has no
  // local state at all, and the draft must still be there.
  const relogin = await api<Session>('POST', '/api/v1/auth/login', {
    email, password: 'Str0ng-Passphrase!',
    device: { deviceId: 'reinstalled-device', platform: 'android' },
  });
  assert.equal(relogin.status, 200);
  const freshToken = relogin.body.data!.tokens.accessToken;

  const list = await api<{ id: string; caption: string }[]>(
    'GET', '/api/v1/drafts', undefined, freshToken,
  );
  assert.equal(list.status, 200);
  assert.equal(list.body.data!.length, 1);
  assert.equal(list.body.data![0]!.id, draftId);
  assert.equal(list.body.data![0]!.caption, 'work in progress');
});

test('saving with an id updates the draft instead of creating another', async () => {
  const { token } = await registerUser();
  const key = await uploadFile(token, makeFile(1000));

  const first = await api<{ id: string }>('POST', '/api/v1/drafts',
    { caption: 'v1', editList: edlFor(key) }, token);
  const id = first.body.data!.id;

  const second = await api<{ id: string; caption: string }>('POST', '/api/v1/drafts',
    { id, caption: 'v2', editList: edlFor(key) }, token);
  assert.equal(second.status, 200);
  assert.equal(second.body.data!.id, id);
  assert.equal(second.body.data!.caption, 'v2');

  const list = await api<unknown[]>('GET', '/api/v1/drafts', undefined, token);
  assert.equal(list.body.data!.length, 1, 'updating must not create a second draft');
});

test('drafts are private to their owner', async () => {
  const a = await registerUser();
  const b = await registerUser();
  const key = await uploadFile(a.token, makeFile(1000));

  const saved = await api<{ id: string }>('POST', '/api/v1/drafts',
    { caption: 'mine', editList: edlFor(key) }, a.token);
  const id = saved.body.data!.id;

  assert.equal((await api('GET', `/api/v1/drafts/${id}`, undefined, b.token)).status, 404);
  assert.equal((await api('DELETE', `/api/v1/drafts/${id}`, undefined, b.token)).status, 404);
  assert.equal((await api<unknown[]>('GET', '/api/v1/drafts', undefined, b.token)).body.data!.length, 0);
});

test('deleting a draft is a soft delete, so the row survives', async () => {
  const { token } = await registerUser();
  const key = await uploadFile(token, makeFile(1000));
  const saved = await api<{ id: string }>('POST', '/api/v1/drafts',
    { caption: 'temp', editList: edlFor(key) }, token);
  const id = saved.body.data!.id;

  assert.equal((await api('DELETE', `/api/v1/drafts/${id}`, undefined, token)).status, 200);
  assert.equal((await api('GET', `/api/v1/drafts/${id}`, undefined, token)).status, 404);

  const row = await queryOne<{ deleted_at: Date | null }>(
    'SELECT deleted_at FROM video_drafts WHERE public_id = ?', [id],
  );
  assert.ok(row, 'the row must still exist');
  assert.ok(row.deleted_at !== null, 'it should be soft-deleted, not removed');
});

// ── Ownership ──

test('an edit list referencing another user\'s upload is refused', async () => {
  const a = await registerUser();
  const b = await registerUser();
  const stolenKey = await uploadFile(a.token, makeFile(1000));

  const res = await api('POST', '/api/v1/drafts',
    { caption: 'not mine', editList: edlFor(stolenKey) }, b.token);
  assert.equal(res.status, 403, 'rendering another user\'s footage must be impossible');
  assert.match(res.body.error!.message, /did not upload/);
});

test('an edit list referencing a never-uploaded key is refused', async () => {
  const { token } = await registerUser();
  const res = await api('POST', '/api/v1/drafts',
    { caption: 'fake', editList: edlFor('videos/2026/01/01/deadbeef.mp4') }, token);
  assert.equal(res.status, 403);
});

test('an edit list that has not been completed cannot be used', async () => {
  const { token } = await registerUser();
  // Session created but no chunks sent, so the key exists but the upload does not.
  const session = await startUpload(token, 1000);
  const res = await api('POST', '/api/v1/drafts',
    { caption: 'incomplete', editList: edlFor(session.storageKey) }, token);
  assert.equal(res.status, 403, 'only completed uploads may be referenced');
});

// ── Publish ──

test('publishing creates a video and queues a render', async () => {
  const { token } = await registerUser();
  const key = await uploadFile(token, makeFile(2000));

  const res = await api<{ videoId: string; renderJob: { id: string; status: string } }>(
    'POST', '/api/v1/videos',
    {
      editList: edlFor(key),
      caption: 'my first video #vyra #test',
      privacy: 'public',
      allowComments: true,
    },
    token,
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  assert.ok(res.body.data!.videoId);
  assert.equal(res.body.data!.renderJob.status, 'queued');

  // The video must not be visible until a playable file exists.
  const video = await queryOne<{ status: string; render_status: string; duration_sec: number }>(
    'SELECT status, render_status, duration_sec FROM videos WHERE public_id = ?',
    [res.body.data!.videoId],
  );
  assert.equal(video!.status, 'processing');
  assert.equal(video!.render_status, 'queued');
  assert.equal(Number(video!.duration_sec), 5);

  const job = await api<{ status: string; progress: number }>(
    'GET', `/api/v1/render-jobs/${res.body.data!.renderJob.id}`, undefined, token,
  );
  assert.equal(job.status, 200);
  assert.equal(job.body.data!.status, 'queued');
});

test('hashtags in a caption are extracted and linked', async () => {
  const { token } = await registerUser();
  const key = await uploadFile(token, makeFile(2000));
  const tag = `p4tag${Math.random().toString(36).slice(2, 8)}`;
  createdTags.push(tag);

  const res = await api<{ videoId: string }>('POST', '/api/v1/videos', {
    editList: edlFor(key),
    caption: `look at this #${tag}`,
    privacy: 'public',
  }, token);
  assert.equal(res.status, 201);

  const link = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM video_hashtags vh
       JOIN videos v ON v.id = vh.video_id
       JOIN hashtags h ON h.id = vh.hashtag_id
      WHERE v.public_id = ? AND h.tag = ?`,
    [res.body.data!.videoId, tag],
  );
  assert.equal(Number(link!.n), 1);
});

test('publishing consumes the draft it came from', async () => {
  const { token } = await registerUser();
  const key = await uploadFile(token, makeFile(1000));

  const draft = await api<{ id: string }>('POST', '/api/v1/drafts',
    { caption: 'ready', editList: edlFor(key) }, token);
  const draftId = draft.body.data!.id;

  const published = await api<{ videoId: string }>('POST', '/api/v1/videos', {
    editList: edlFor(key), caption: 'published', privacy: 'public', draftId,
  }, token);
  assert.equal(published.status, 201);

  const list = await api<unknown[]>('GET', '/api/v1/drafts', undefined, token);
  assert.equal(list.body.data!.length, 0, 'the draft should leave the list once published');

  // But only soft-deleted, so nothing is actually destroyed.
  const row = await queryOne<{ deleted_at: Date | null }>(
    'SELECT deleted_at FROM video_drafts WHERE public_id = ?', [draftId],
  );
  assert.ok(row && row.deleted_at !== null);
});

test('a publish with a hostile edit list is refused', async () => {
  const { token } = await registerUser();
  const key = await uploadFile(token, makeFile(1000));

  const evil = {
    ...edlFor(key),
    texts: [{
      id: 't', text: 'x', fontSlug: 'inter', sizePx: 20,
      color: "#fff' -f lavfi -i nullsrc", align: 'left',
      x: 0, y: 0, rotation: 0, startMs: 0, endMs: 1000,
    }],
  };
  const res = await api('POST', '/api/v1/videos',
    { editList: evil, caption: 'nope', privacy: 'public' }, token);
  assert.equal(res.status, 400);
  assert.equal(res.body.error!.code, 'validation_failed');
});

test('creation endpoints require authentication', async () => {
  for (const [method, path] of [
    ['POST', '/api/v1/uploads'],
    ['GET', '/api/v1/drafts'],
    ['POST', '/api/v1/videos'],
    ['GET', '/api/v1/creative/limits'],
  ] as const) {
    const res = await api(method, path, method === 'GET' ? undefined : {});
    assert.equal(res.status, 401, `${method} ${path} must require authentication`);
  }
});
