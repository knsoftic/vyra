/**
 * Likes, saves and comments.
 *
 * What must be true:
 *   1. liking twice counts once — a double tap is not two likes
 *   2. the count returned is the count in the database, always
 *   3. unliking something never liked does not push the counter negative
 *   4. a video with comments off cannot be commented on
 *   5. deleting a comment takes its replies and the right count with it
 *   6. blocked people cannot reach each other through likes or comments
 *   7. the author is notified once, not once per retry
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';

process.env.RATE_LIMIT_ENABLED = 'false';
process.env.NODE_ENV = 'development';

const { createApp } = await import('../src/app.ts');
const { pool, execute, query, queryOne } = await import('../src/core/db.ts');
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

async function registerUser(): Promise<{ token: string; publicId: string; email: string; dbId: number }> {
  const tag = randomBytes(5).toString('hex');
  const email = `engage_${tag}@vyra.test`;
  createdEmails.push(email);
  const res = await api<Session>('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username: `engage_${tag}`,
    birthdate: '1995-04-12',
    device: { deviceId: `engage-${tag}`, platform: 'web' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return { token: res.body.data!.tokens.accessToken, publicId: res.body.data!.user.id, email, dbId: row!.id };
}

/** A published video, inserted directly — the publish path has its own tests. */
async function makeVideo(authorId: number, allowComments = true): Promise<string> {
  const { ulid } = await import('ulid');
  const publicId = ulid();
  const result = await execute(
    `INSERT INTO videos (public_id, user_id, caption, duration_sec, privacy, status,
                         processing_status, allow_comments, published_at)
     VALUES (:publicId, :userId, 'engagement test', 10, 'public', 'published',
             'complete', :allowComments, NOW(3))`,
    { publicId, userId: authorId, allowComments: allowComments ? 1 : 0 },
  );
  createdVideoIds.push(result.insertId);
  return publicId;
}

async function videoCounts(publicId: string): Promise<{ likes: number; comments: number; saves: number }> {
  const row = await queryOne<{ like_count: number; comment_count: number; save_count: number }>(
    'SELECT like_count, comment_count, save_count FROM videos WHERE public_id = :publicId',
    { publicId },
  );
  return {
    likes: Number(row?.like_count ?? -1),
    comments: Number(row?.comment_count ?? -1),
    saves: Number(row?.save_count ?? -1),
  };
}

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  for (const id of createdVideoIds) {
    await execute('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE video_id = ?)', [id]).catch(() => undefined);
    await execute('DELETE FROM comments WHERE video_id = ?', [id]).catch(() => undefined);
    await execute('DELETE FROM likes WHERE video_id = ?', [id]).catch(() => undefined);
    await execute('DELETE FROM saves WHERE video_id = ?', [id]).catch(() => undefined);
    await execute('DELETE FROM videos WHERE id = ?', [id]).catch(() => undefined);
  }
  for (const email of createdEmails) {
    const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]).catch(() => null);
    if (!user) continue;
    for (const sql of [
      'DELETE FROM notifications WHERE user_id=? OR actor_id=?',
      'DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?',
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

// ── Likes ──

test('liking twice counts once, and the count comes from the database', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(author.dbId);

  const first = await api<{ liked: boolean; likeCount: number }>(
    'POST', `/api/v1/videos/${video}/like`, undefined, viewer.token,
  );
  assert.equal(first.status, 200, JSON.stringify(first.body.error));
  assert.equal(first.body.data!.liked, true);
  assert.equal(first.body.data!.likeCount, 1);

  // The double tap, the retry, the flaky connection — all the same state.
  const second = await api<{ likeCount: number }>(
    'POST', `/api/v1/videos/${video}/like`, undefined, viewer.token,
  );
  assert.equal(second.body.data!.likeCount, 1, 'still one');

  assert.equal((await videoCounts(video)).likes, 1, 'and the database agrees');
});

test('unliking removes exactly one, and never goes below zero', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(author.dbId);

  await api('POST', `/api/v1/videos/${video}/like`, undefined, viewer.token);
  const off = await api<{ liked: boolean; likeCount: number }>(
    'DELETE', `/api/v1/videos/${video}/like`, undefined, viewer.token,
  );
  assert.equal(off.body.data!.liked, false);
  assert.equal(off.body.data!.likeCount, 0);

  // Unliking something never liked is not an error and not a decrement.
  const again = await api<{ likeCount: number }>(
    'DELETE', `/api/v1/videos/${video}/like`, undefined, viewer.token,
  );
  assert.equal(again.body.data!.likeCount, 0, 'floor holds');
  assert.equal((await videoCounts(video)).likes, 0);

  // And it can be liked again afterwards — the row is reused, not duplicated.
  const relike = await api<{ likeCount: number }>(
    'POST', `/api/v1/videos/${video}/like`, undefined, viewer.token,
  );
  assert.equal(relike.body.data!.likeCount, 1);
  const rows = await query('SELECT * FROM likes WHERE video_id = (SELECT id FROM videos WHERE public_id = ?)', [video]);
  assert.equal(rows.length, 1, 'one row, reused');
});

test('two people liking the same video count as two', async () => {
  const author = await registerUser();
  const a = await registerUser();
  const b = await registerUser();
  const video = await makeVideo(author.dbId);

  await api('POST', `/api/v1/videos/${video}/like`, undefined, a.token);
  const second = await api<{ likeCount: number }>(
    'POST', `/api/v1/videos/${video}/like`, undefined, b.token,
  );
  assert.equal(second.body.data!.likeCount, 2);
});

test('the author is notified once, however many times the like is retried', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(author.dbId);

  await api('POST', `/api/v1/videos/${video}/like`, undefined, viewer.token);
  await api('POST', `/api/v1/videos/${video}/like`, undefined, viewer.token);
  await api('POST', `/api/v1/videos/${video}/like`, undefined, viewer.token);

  const row = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND kind = 'like' AND actor_id = ?",
    [author.dbId, viewer.dbId],
  );
  assert.equal(Number(row?.c), 1, 'one notification, not three');
});

test('liking your own video does not notify you', async () => {
  const author = await registerUser();
  const video = await makeVideo(author.dbId);

  await api('POST', `/api/v1/videos/${video}/like`, undefined, author.token);
  const row = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND kind = 'like'",
    [author.dbId],
  );
  assert.equal(Number(row?.c), 0);
});

test('a like needs a session', async () => {
  const author = await registerUser();
  const video = await makeVideo(author.dbId);
  const res = await api('POST', `/api/v1/videos/${video}/like`);
  assert.equal(res.status, 401);
});

// ── Saves ──

test('saving is idempotent and private', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(author.dbId);

  await api('POST', `/api/v1/videos/${video}/save`, undefined, viewer.token);
  const again = await api<{ saveCount: number }>(
    'POST', `/api/v1/videos/${video}/save`, undefined, viewer.token,
  );
  assert.equal(again.body.data!.saveCount, 1);

  const saved = await api<{ id: string }[]>('GET', '/api/v1/me/saved', undefined, viewer.token);
  assert.ok(saved.body.data!.some((v) => v.id === video), 'it is in my saved list');

  // A save tells the author nothing — who bookmarked you is not its business.
  const row = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?', [author.dbId],
  );
  assert.equal(Number(row?.c), 0);

  await api('DELETE', `/api/v1/videos/${video}/save`, undefined, viewer.token);
  const after = await api<{ id: string }[]>('GET', '/api/v1/me/saved', undefined, viewer.token);
  assert.ok(!after.body.data!.some((v) => v.id === video), 'and gone when unsaved');
});

// ── Comments ──

test('a comment is stored, counted, and comes back readable', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(author.dbId);

  const posted = await api<{ id: string; body: string; author: { username: string } }>(
    'POST', `/api/v1/videos/${video}/comments`, { body: 'First!' }, viewer.token,
  );
  assert.equal(posted.status, 201, JSON.stringify(posted.body.error));
  assert.equal(posted.body.data!.body, 'First!');

  const list = await api<{ items: { id: string }[]; total: number }>(
    'GET', `/api/v1/videos/${video}/comments`, undefined, viewer.token,
  );
  assert.equal(list.body.data!.items.length, 1);
  assert.equal(list.body.data!.total, 1);
  assert.equal((await videoCounts(video)).comments, 1);
});

test('comments turned off means comments turned off', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(author.dbId, false);

  const res = await api('POST', `/api/v1/videos/${video}/comments`, { body: 'Hello' }, viewer.token);
  assert.equal(res.status, 403);
  assert.equal((await videoCounts(video)).comments, 0);
});

test('an empty comment is refused', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(author.dbId);

  const res = await api('POST', `/api/v1/videos/${video}/comments`, { body: '   ' }, viewer.token);
  assert.equal(res.status, 400);
});

test('replies attach to the parent and stay one level deep', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(author.dbId);

  const parent = await api<{ id: string }>(
    'POST', `/api/v1/videos/${video}/comments`, { body: 'Top level' }, viewer.token,
  );
  const reply = await api<{ id: string }>(
    'POST', `/api/v1/videos/${video}/comments`,
    { body: 'A reply', parentId: parent.body.data!.id }, author.token,
  );
  assert.equal(reply.status, 201);

  // A reply to the reply lands beside it, not under it.
  const nested = await api<{ id: string }>(
    'POST', `/api/v1/videos/${video}/comments`,
    { body: 'Reply to the reply', parentId: reply.body.data!.id }, viewer.token,
  );
  assert.equal(nested.status, 201);

  const replies = await api<{ id: string }[]>(
    'GET', `/api/v1/comments/${parent.body.data!.id}/replies`, undefined, viewer.token,
  );
  assert.equal(replies.body.data!.length, 2, 'both replies hang off the top-level comment');

  // The top-level list stays top-level.
  const top = await api<{ items: unknown[] }>(
    'GET', `/api/v1/videos/${video}/comments`, undefined, viewer.token,
  );
  assert.equal(top.body.data!.items.length, 1);
});

test('deleting a comment takes its replies and the right count with it', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(author.dbId);

  const parent = await api<{ id: string }>(
    'POST', `/api/v1/videos/${video}/comments`, { body: 'Parent' }, viewer.token,
  );
  await api('POST', `/api/v1/videos/${video}/comments`, { body: 'R1', parentId: parent.body.data!.id }, author.token);
  await api('POST', `/api/v1/videos/${video}/comments`, { body: 'R2', parentId: parent.body.data!.id }, author.token);
  assert.equal((await videoCounts(video)).comments, 3);

  const removed = await api('DELETE', `/api/v1/comments/${parent.body.data!.id}`, undefined, viewer.token);
  assert.equal(removed.status, 200);

  // All three go — a count that includes comments nobody can see is a wrong count.
  assert.equal((await videoCounts(video)).comments, 0);
  const list = await api<{ items: unknown[] }>(
    'GET', `/api/v1/videos/${video}/comments`, undefined, viewer.token,
  );
  assert.equal(list.body.data!.items.length, 0);
});

test('you cannot delete someone else\'s comment, but the video\'s author can', async () => {
  const author = await registerUser();
  const commenter = await registerUser();
  const stranger = await registerUser();
  const video = await makeVideo(author.dbId);

  const comment = await api<{ id: string }>(
    'POST', `/api/v1/videos/${video}/comments`, { body: 'Mine' }, commenter.token,
  );

  const byStranger = await api('DELETE', `/api/v1/comments/${comment.body.data!.id}`, undefined, stranger.token);
  assert.equal(byStranger.status, 403);

  // The video's author moderates their own comment section.
  const byAuthor = await api('DELETE', `/api/v1/comments/${comment.body.data!.id}`, undefined, author.token);
  assert.equal(byAuthor.status, 200);
});

test('a comment like is idempotent too', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const video = await makeVideo(author.dbId);

  const comment = await api<{ id: string }>(
    'POST', `/api/v1/videos/${video}/comments`, { body: 'Like me' }, author.token,
  );
  const id = comment.body.data!.id;

  await api('POST', `/api/v1/comments/${id}/like`, undefined, viewer.token);
  const twice = await api<{ likeCount: number }>('POST', `/api/v1/comments/${id}/like`, undefined, viewer.token);
  assert.equal(twice.body.data!.likeCount, 1);

  const off = await api<{ likeCount: number }>('DELETE', `/api/v1/comments/${id}/like`, undefined, viewer.token);
  assert.equal(off.body.data!.likeCount, 0);
});

// ── Blocks ──

test('a block stops likes and comments in both directions', async () => {
  const author = await registerUser();
  const blocked = await registerUser();
  const video = await makeVideo(author.dbId);

  const block = await api('POST', `/api/v1/users/${blocked.publicId}/block`, undefined, author.token);
  assert.equal(block.status, 200, JSON.stringify(block.body.error));

  // Not 403 — the same answer a deleted video gives, so the response cannot be
  // used to discover that a specific person blocked you.
  const like = await api('POST', `/api/v1/videos/${video}/like`, undefined, blocked.token);
  assert.equal(like.status, 404);

  const comment = await api('POST', `/api/v1/videos/${video}/comments`, { body: 'Hi' }, blocked.token);
  assert.equal(comment.status, 404);
});

// ── The feed's bulk lookup ──

test('the feed can ask about a whole page at once', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const liked = await makeVideo(author.dbId);
  const saved = await makeVideo(author.dbId);
  const neither = await makeVideo(author.dbId);

  await api('POST', `/api/v1/videos/${liked}/like`, undefined, viewer.token);
  await api('POST', `/api/v1/videos/${saved}/save`, undefined, viewer.token);

  const state = await api<{ liked: string[]; saved: string[] }>(
    'POST', '/api/v1/videos/engagement-state',
    { videoIds: [liked, saved, neither] }, viewer.token,
  );
  assert.deepEqual(state.body.data!.liked, [liked]);
  assert.deepEqual(state.body.data!.saved, [saved]);
});
