/**
 * Chat end-to-end, against the real database.
 *
 * The Phase 8 exit criteria for messaging, and the rules that are easy to get
 * wrong and expensive to get wrong:
 *
 *   1. a chat id is not a key — a non-member cannot read or write
 *   2. blocks work in both directions
 *   3. `whoCanMessage` is enforced where messages are sent, not just displayed
 *   4. a retried send produces one message, not two
 *   5. read receipts move the sender's tick, and only the sender sees it
 *   6. someone added to a group cannot read what was said before they joined
 *   7. "delete for everyone" is the sender's right alone
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

let server: Server;
let base = '';
const createdEmails: string[] = [];

interface Envelope<T> {
  ok: boolean;
  data?: T;
  meta?: { hasMore: boolean; nextCursor?: string };
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

interface Actor {
  token: string;
  publicId: string;
  id: number;
  username: string;
}

async function registerUser(): Promise<Actor> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `p8_${suffix}@vyra.test`;
  const username = `p8_${suffix}`;
  createdEmails.push(email);

  const res = await api<Session>('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username,
    birthdate: '1995-04-12',
    device: { deviceId: `dev-p8-${suffix}`, platform: 'web' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body.error));

  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return {
    token: res.body.data!.tokens.accessToken,
    publicId: res.body.data!.user.id,
    id: row!.id,
    username,
  };
}

interface ChatShape {
  id: string;
  kind: string;
  title: string;
  unreadCount: number;
  memberCount: number;
  myRole: string;
  lastMessage?: { id: string; body?: string; status: string };
  participants: { id: string }[];
}

interface MessageShape {
  id: string;
  body?: string;
  status: string;
  isDeleted?: boolean;
  kind: string;
}

const send = (over: Record<string, unknown> = {}) => ({
  kind: 'text',
  body: 'hello',
  clientId: randomUUID(),
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

      // Messages and receipts first — they reference chats and users.
      await execute(
        `DELETE r FROM message_receipts r
           JOIN messages m ON m.id = r.message_id
           JOIN chat_participants p ON p.chat_id = m.chat_id
          WHERE p.user_id = ?`,
        [id],
      );
      await execute(
        `DELETE m FROM messages m
           JOIN chat_participants p ON p.chat_id = m.chat_id
          WHERE p.user_id = ?`,
        [id],
      );
      const chats = await query<{ chat_id: number }>(
        'SELECT chat_id FROM chat_participants WHERE user_id = ?',
        [id],
      );
      await execute('DELETE FROM chat_participants WHERE user_id = ?', [id]);
      for (const row of chats) {
        await execute('DELETE FROM chat_participants WHERE chat_id = ?', [row.chat_id]);
        await execute('DELETE FROM chats WHERE id = ?', [row.chat_id]);
      }

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
      await execute('DELETE FROM users WHERE id = ?', [id]);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await closeRedis();
  }
});

// ── Routing ──

test('an unknown route is 404, not 401', async () => {
  // `router.use(requireAuth)` runs for every request that reaches the router,
  // not only the paths it handles, so mounting auth that way turned every
  // unknown path under the API prefix into "Authentication required".
  const res = await api('GET', '/api/v1/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.error?.code, 'not_found');
});

test('a chat route without a token is 401, not 404', async () => {
  // The other direction: moving auth onto each route must not have removed it.
  const res = await api('GET', '/api/v1/chats');
  assert.equal(res.status, 401);
});

// ── Opening a conversation ──

test('a private chat is created once, however many times it is opened', async () => {
  const alice = await registerUser();
  const bob = await registerUser();

  const first = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  assert.equal(first.status, 200, JSON.stringify(first.body.error));

  // Both directions, because "open a chat" is symmetric and two people tapping
  // at once must not produce two conversations.
  const second = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: alice.publicId }, bob.token,
  );
  assert.equal(second.body.data!.id, first.body.data!.id);

  assert.equal(first.body.data!.kind, 'private');
  assert.equal(first.body.data!.memberCount, 2);
});

test('a private chat is titled by the other person, for each side', async () => {
  const alice = await registerUser();
  const bob = await registerUser();

  const forAlice = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const forBob = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: alice.publicId }, bob.token,
  );

  assert.notEqual(forAlice.body.data!.title, forBob.body.data!.title);
});

test('you cannot open a chat with yourself', async () => {
  const alice = await registerUser();
  const res = await api('POST', '/api/v1/chats/direct', { userId: alice.publicId }, alice.token);
  assert.equal(res.status, 400);
});

// ── Access control ──

test('a chat id is not a key: a non-member gets not_found', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const stranger = await registerUser();

  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  const read = await api('GET', `/api/v1/chats/${chatId}/messages`, undefined, stranger.token);
  assert.equal(read.status, 404, 'a stranger must not read the thread');
  assert.equal(read.body.error?.code, 'not_found');

  const write = await api('POST', `/api/v1/chats/${chatId}/messages`, send(), stranger.token);
  assert.equal(write.status, 404, 'a stranger must not write into the thread');

  // Not "forbidden": that would confirm the conversation exists.
  assert.notEqual(write.body.error?.code, 'forbidden');
});

test('a block stops messaging in both directions', async () => {
  const alice = await registerUser();
  const bob = await registerUser();

  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  await api('POST', `/api/v1/users/${alice.publicId}/block`, {}, bob.token);

  const blocked = await api('POST', `/api/v1/chats/${chatId}/messages`, send(), alice.token);
  assert.equal(blocked.status, 404, 'the blocked party is told the account is gone');

  // And the blocker cannot use the chat either — a block is not a mute.
  const reverse = await api('POST', `/api/v1/chats/${chatId}/messages`, send(), bob.token);
  assert.equal(reverse.status, 404);
});

test('whoCanMessage is enforced when sending, not only when displayed', async () => {
  const alice = await registerUser();
  const bob = await registerUser();

  // Bob accepts nobody.
  const patched = await api('PATCH', '/api/v1/me/privacy', { whoCanMessage: 'nobody' }, bob.token);
  assert.equal(patched.status, 200, JSON.stringify(patched.body.error));

  const blocked = await api('POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token);
  assert.equal(blocked.status, 403);

  // Bob accepts people he follows. He does not follow Alice yet.
  await api('PATCH', '/api/v1/me/privacy', { whoCanMessage: 'followers' }, bob.token);
  const stillBlocked = await api(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  assert.equal(stillBlocked.status, 403, "the recipient own-follow list is the gate");

  // Once Bob follows Alice, she may write to him.
  await api('POST', `/api/v1/users/${alice.publicId}/follow`, {}, bob.token);
  const allowed = await api('POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body.error));
});

test('a privacy change applies to a conversation that already exists', async () => {
  const alice = await registerUser();
  const bob = await registerUser();

  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  const before = await api('POST', `/api/v1/chats/${chatId}/messages`, send(), alice.token);
  assert.equal(before.status, 201);

  await api('PATCH', '/api/v1/me/privacy', { whoCanMessage: 'nobody' }, bob.token);

  const after = await api('POST', `/api/v1/chats/${chatId}/messages`, send(), alice.token);
  assert.equal(after.status, 403, 'the setting is re-checked per send, not only at creation');
});

// ── Sending ──

test('a retried send produces one message, not two', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  const payload = send({ body: 'exactly once' });

  const first = await api<MessageShape>(
    'POST', `/api/v1/chats/${chatId}/messages`, payload, alice.token,
  );
  const retry = await api<MessageShape>(
    'POST', `/api/v1/chats/${chatId}/messages`, payload, alice.token,
  );

  assert.equal(first.status, 201);
  assert.equal(retry.status, 200, 'a repeat is accepted, not rejected');
  assert.equal(retry.body.data!.id, first.body.data!.id, 'and returns the original message');

  const listed = await api<MessageShape[]>(
    'GET', `/api/v1/chats/${chatId}/messages`, undefined, alice.token,
  );
  const matching = listed.body.data!.filter((m) => m.body === 'exactly once');
  assert.equal(matching.length, 1);
});

test('an empty message is refused', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );

  const res = await api(
    'POST', `/api/v1/chats/${chat.body.data!.id}/messages`,
    { kind: 'text', body: '   ', clientId: randomUUID() },
    alice.token,
  );
  assert.equal(res.status, 400);
});

test('a voice note without a duration is refused', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );

  const res = await api(
    'POST', `/api/v1/chats/${chat.body.data!.id}/messages`,
    { kind: 'voice', mediaKey: 'audio/x.m4a', clientId: randomUUID() },
    alice.token,
  );
  assert.equal(res.status, 400);
});

// ── Receipts ──

test('reading moves the sender tick, and only the sender sees it', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  const sent = await api<MessageShape>(
    'POST', `/api/v1/chats/${chatId}/messages`, send({ body: 'tick test' }), alice.token,
  );
  assert.equal(sent.body.data!.status, 'sent');

  await api('POST', `/api/v1/chats/${chatId}/read`, {}, bob.token);

  const forSender = await api<MessageShape[]>(
    'GET', `/api/v1/chats/${chatId}/messages`, undefined, alice.token,
  );
  assert.equal(forSender.body.data![0]!.status, 'seen');

  // Bob is not the sender, so delivery state is not his to see.
  const forReader = await api<MessageShape[]>(
    'GET', `/api/v1/chats/${chatId}/messages`, undefined, bob.token,
  );
  assert.equal(forReader.body.data![0]!.status, 'sent');
});

test('reading clears the unread badge for the reader only', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  await api('POST', `/api/v1/chats/${chatId}/messages`, send(), alice.token);
  await api('POST', `/api/v1/chats/${chatId}/messages`, send(), alice.token);

  const bobInbox = await api<ChatShape[]>('GET', '/api/v1/chats', undefined, bob.token);
  assert.equal(bobInbox.body.data![0]!.unreadCount, 2);

  // The sender never has an unread count for their own messages.
  const aliceInbox = await api<ChatShape[]>('GET', '/api/v1/chats', undefined, alice.token);
  assert.equal(aliceInbox.body.data![0]!.unreadCount, 0);

  await api('POST', `/api/v1/chats/${chatId}/read`, {}, bob.token);
  const cleared = await api<ChatShape[]>('GET', '/api/v1/chats', undefined, bob.token);
  assert.equal(cleared.body.data![0]!.unreadCount, 0);
});

// ── Groups ──

test('a group hides what was said before a member joined', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const carol = await registerUser();

  const group = await api<ChatShape>(
    'POST', '/api/v1/chats/group',
    { title: 'Early days', memberIds: [bob.publicId] },
    alice.token,
  );
  assert.equal(group.status, 201, JSON.stringify(group.body.error));
  const chatId = group.body.data!.id;

  await api('POST', `/api/v1/chats/${chatId}/messages`, send({ body: 'before carol' }), alice.token);

  // A second of separation, because the cut-off is the join timestamp.
  await new Promise((r) => setTimeout(r, 1100));

  const added = await api('POST', `/api/v1/chats/${chatId}/members`, {
    memberIds: [carol.publicId],
  }, alice.token);
  assert.equal(added.status, 200, JSON.stringify(added.body.error));

  await api('POST', `/api/v1/chats/${chatId}/messages`, send({ body: 'after carol' }), alice.token);

  const carolSees = await api<MessageShape[]>(
    'GET', `/api/v1/chats/${chatId}/messages`, undefined, carol.token,
  );
  const bodies = carolSees.body.data!.map((m) => m.body);
  assert.ok(bodies.includes('after carol'));
  assert.ok(!bodies.includes('before carol'), 'joining a group is not a licence to read its past');
});

test('only staff can rename a group or add people', async () => {
  const alice = await registerUser();
  const bob = await registerUser();

  const group = await api<ChatShape>(
    'POST', '/api/v1/chats/group', { title: 'Locked', memberIds: [bob.publicId] }, alice.token,
  );
  const chatId = group.body.data!.id;

  const rename = await api('PATCH', `/api/v1/chats/${chatId}`, { title: 'Hijacked' }, bob.token);
  assert.equal(rename.status, 403);

  const asOwner = await api('PATCH', `/api/v1/chats/${chatId}`, { title: 'Renamed' }, alice.token);
  assert.equal(asOwner.status, 200);
});

test('a member can leave, and then cannot read the group', async () => {
  const alice = await registerUser();
  const bob = await registerUser();

  const group = await api<ChatShape>(
    'POST', '/api/v1/chats/group', { title: 'Leavers', memberIds: [bob.publicId] }, alice.token,
  );
  const chatId = group.body.data!.id;

  const left = await api(
    'DELETE', `/api/v1/chats/${chatId}/members/${bob.publicId}`, undefined, bob.token,
  );
  assert.equal(left.status, 200, JSON.stringify(left.body.error));

  const after = await api('GET', `/api/v1/chats/${chatId}/messages`, undefined, bob.token);
  assert.equal(after.status, 404);
});

test('the owner cannot be removed by an admin', async () => {
  const alice = await registerUser();
  const bob = await registerUser();

  const group = await api<ChatShape>(
    'POST', '/api/v1/chats/group', { title: 'Ownership', memberIds: [bob.publicId] }, alice.token,
  );
  const chatId = group.body.data!.id;

  await execute(
    `UPDATE chat_participants p JOIN chats c ON c.id = p.chat_id
        SET p.role = 'admin'
      WHERE c.public_id = ? AND p.user_id = ?`,
    [chatId, bob.id],
  );

  const attempt = await api(
    'DELETE', `/api/v1/chats/${chatId}/members/${alice.publicId}`, undefined, bob.token,
  );
  assert.equal(attempt.status, 403);
});

// ── Deletion ──

test('delete for everyone belongs to the sender alone', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  const sent = await api<MessageShape>(
    'POST', `/api/v1/chats/${chatId}/messages`, send({ body: 'regrettable' }), alice.token,
  );
  const messageId = sent.body.data!.id;

  const byOther = await api(
    'DELETE', `/api/v1/messages/${messageId}?forEveryone=true`, undefined, bob.token,
  );
  assert.equal(byOther.status, 403);

  const bySender = await api(
    'DELETE', `/api/v1/messages/${messageId}?forEveryone=true`, undefined, alice.token,
  );
  assert.equal(bySender.status, 200);

  const seen = await api<MessageShape[]>(
    'GET', `/api/v1/chats/${chatId}/messages`, undefined, bob.token,
  );
  const withdrawn = seen.body.data!.find((m) => m.id === messageId);
  assert.ok(withdrawn, 'the message keeps its place in the thread');
  assert.equal(withdrawn!.isDeleted, true);
  assert.equal(withdrawn!.body, undefined, 'but not its content');
});

test('delete for me hides it for one person only', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  const sent = await api<MessageShape>(
    'POST', `/api/v1/chats/${chatId}/messages`, send({ body: 'mine only' }), alice.token,
  );
  const messageId = sent.body.data!.id;

  await api('DELETE', `/api/v1/messages/${messageId}`, undefined, bob.token);

  const bobSees = await api<MessageShape[]>(
    'GET', `/api/v1/chats/${chatId}/messages`, undefined, bob.token,
  );
  assert.ok(!bobSees.body.data!.some((m) => m.id === messageId));

  const aliceSees = await api<MessageShape[]>(
    'GET', `/api/v1/chats/${chatId}/messages`, undefined, alice.token,
  );
  assert.ok(aliceSees.body.data!.some((m) => m.id === messageId));
});

// ── Inbox ──

test('the inbox is ordered by most recent activity', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const carol = await registerUser();

  const withBob = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const withCarol = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: carol.publicId }, alice.token,
  );

  await api('POST', `/api/v1/chats/${withBob.body.data!.id}/messages`, send(), alice.token);
  await new Promise((r) => setTimeout(r, 50));
  await api('POST', `/api/v1/chats/${withCarol.body.data!.id}/messages`, send(), alice.token);

  const inbox = await api<ChatShape[]>('GET', '/api/v1/chats', undefined, alice.token);
  assert.equal(inbox.body.data![0]!.id, withCarol.body.data!.id);
});

test('timestamps are instants, not local wall-clock read as UTC', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );

  const before = Date.now();
  const sent = await api<MessageShape & { createdAt: string }>(
    'POST', `/api/v1/chats/${chat.body.data!.id}/messages`, send(), alice.token,
  );
  const after = Date.now();

  const at = new Date(sent.body.data!.createdAt).getTime();

  // The pool used to read MySQL DATETIMEs as UTC while MySQL wrote them in the
  // machine local zone, putting every timestamp hours into the future. A window
  // of a few seconds catches any offset without being flaky.
  assert.ok(
    at >= before - 5000 && at <= after + 5000,
    `createdAt ${sent.body.data!.createdAt} is not close to now — check the pool timezone`,
  );
});

test('the inbox carries the last message of each conversation', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<ChatShape>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );

  await api('POST', `/api/v1/chats/${chat.body.data!.id}/messages`, send({ body: 'first' }), alice.token);
  await api('POST', `/api/v1/chats/${chat.body.data!.id}/messages`, send({ body: 'latest' }), alice.token);

  const inbox = await api<ChatShape[]>('GET', '/api/v1/chats', undefined, alice.token);
  assert.equal(inbox.body.data![0]!.lastMessage?.body, 'latest');
});
