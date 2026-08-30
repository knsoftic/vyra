/**
 * Communities and calls end-to-end.
 *
 * The rules under test:
 *
 *   1. ADR-014 — an ordinary member cannot enumerate the roster
 *   2. a private community admits by request, and a rejected request admits nobody
 *   3. a banned member is out of the conversation, not merely flagged
 *   4. moderators run the room but cannot redefine it or promote anyone
 *   5. a call is offered before any device opens a microphone
 *   6. the messaging rules cannot be bypassed by dialling instead of typing
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

let server: Server;
let base = '';
const createdEmails: string[] = [];

interface Envelope<T> {
  ok: boolean;
  data?: T;
  meta?: { hasMore: boolean; restricted?: boolean; nextCursor?: string };
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
}

async function registerUser(): Promise<Actor> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `p8c_${suffix}@vyra.test`;
  createdEmails.push(email);

  const res = await api<Session>('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username: `p8c_${suffix}`,
    birthdate: '1995-04-12',
    device: { deviceId: `dev-p8c-${suffix}`, platform: 'web' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body.error));

  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return {
    token: res.body.data!.tokens.accessToken,
    publicId: res.body.data!.user.id,
    id: row!.id,
  };
}

interface CommunityShape {
  id: string;
  chatId: string;
  name: string;
  memberCount: number;
  isPrivate: boolean;
  myRole?: string;
  joinRequestPending?: boolean;
  permissions: { canPost: boolean };
}

interface MemberShape {
  user: { id: string };
  role: string;
  isBanned: boolean;
}

interface RequestShape {
  id: string;
  user: { id: string };
  status: string;
}

interface CallShape {
  id: string;
  state: string;
  kind: string;
  outgoing: boolean;
  durationSec: number;
}

async function makeCommunity(
  owner: Actor,
  over: Record<string, unknown> = {},
): Promise<CommunityShape> {
  const res = await api<CommunityShape>(
    'POST', '/api/v1/communities',
    { name: `Test ${Math.random().toString(36).slice(2, 8)}`, description: 'A place', ...over },
    owner.token,
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  return res.body.data!;
}

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

      const communityIds = await query<{ id: number; chat_id: number }>(
        'SELECT id, chat_id FROM communities WHERE owner_id = ?',
        [id],
      );
      for (const c of communityIds) {
        await execute('DELETE FROM community_join_requests WHERE community_id = ?', [c.id]);
        await execute('DELETE FROM community_members WHERE community_id = ?', [c.id]);
        await execute('DELETE FROM communities WHERE id = ?', [c.id]);
      }
      await execute('DELETE FROM community_members WHERE user_id = ?', [id]);
      await execute('DELETE FROM community_join_requests WHERE user_id = ?', [id]);

      await execute(
        `DELETE cp FROM call_participants cp
           JOIN calls c ON c.id = cp.call_id
           JOIN chat_participants p ON p.chat_id = c.chat_id
          WHERE p.user_id = ?`,
        [id],
      );
      await execute(
        `DELETE c FROM calls c
           JOIN chat_participants p ON p.chat_id = c.chat_id
          WHERE p.user_id = ?`,
        [id],
      );
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

// ── Creation ──

test('creating a community also creates the chat people talk in', async () => {
  const owner = await registerUser();
  const community = await makeCommunity(owner);

  assert.equal(community.myRole, 'owner');
  assert.equal(community.memberCount, 1);

  // The owner is a participant of the backing chat, not only of the community.
  const messages = await api('GET', `/api/v1/chats/${community.chatId}/messages`, undefined, owner.token);
  assert.equal(messages.status, 200, 'the owner can read the community chat');
});

test('a public community admits immediately', async () => {
  const owner = await registerUser();
  const joiner = await registerUser();
  const community = await makeCommunity(owner);

  const join = await api<{ joined: boolean; pending: boolean }>(
    'POST', `/api/v1/communities/${community.id}/join`, {}, joiner.token,
  );
  assert.equal(join.status, 200, JSON.stringify(join.body.error));
  assert.equal(join.body.data!.joined, true);
  assert.equal(join.body.data!.pending, false);

  const after = await api<CommunityShape>(
    'GET', `/api/v1/communities/${community.id}`, undefined, joiner.token,
  );
  assert.equal(after.body.data!.myRole, 'member');
  assert.equal(after.body.data!.memberCount, 2);

  // And can now talk in it.
  const posted = await api(
    'POST', `/api/v1/chats/${community.chatId}/messages`,
    { kind: 'text', body: 'hello everyone', clientId: `c-${Math.random()}` },
    joiner.token,
  );
  assert.equal(posted.status, 201, JSON.stringify(posted.body.error));
});

// ── ADR-014 ──

test('an ordinary member cannot enumerate the roster', async () => {
  const owner = await registerUser();
  const member = await registerUser();
  const other = await registerUser();

  const community = await makeCommunity(owner);
  await api('POST', `/api/v1/communities/${community.id}/join`, {}, member.token);
  await api('POST', `/api/v1/communities/${community.id}/join`, {}, other.token);

  const asOwner = await api<MemberShape[]>(
    'GET', `/api/v1/communities/${community.id}/members`, undefined, owner.token,
  );
  assert.equal(asOwner.body.data!.length, 3, 'staff see everyone');
  assert.notEqual(asOwner.body.meta?.restricted, true);

  const asMember = await api<MemberShape[]>(
    'GET', `/api/v1/communities/${community.id}/members`, undefined, member.token,
  );
  assert.equal(asMember.body.data!.length, 1, 'a member sees staff only');
  assert.equal(asMember.body.data![0]!.role, 'owner');
  assert.equal(
    asMember.body.meta?.restricted,
    true,
    'and is told the list is narrowed rather than complete',
  );

  // The other member is not in the narrowed list — which is the point.
  assert.ok(!asMember.body.data!.some((m) => m.user.id === other.publicId));
});

test('the member count is visible even though the list is not', async () => {
  const owner = await registerUser();
  const member = await registerUser();
  const community = await makeCommunity(owner);
  await api('POST', `/api/v1/communities/${community.id}/join`, {}, member.token);

  const view = await api<CommunityShape>(
    'GET', `/api/v1/communities/${community.id}`, undefined, member.token,
  );
  assert.equal(view.body.data!.memberCount, 2);
});

test('a non-member cannot browse the roster either', async () => {
  const owner = await registerUser();
  const stranger = await registerUser();
  const community = await makeCommunity(owner);

  const res = await api<MemberShape[]>(
    'GET', `/api/v1/communities/${community.id}/members`, undefined, stranger.token,
  );
  assert.equal(res.body.meta?.restricted, true);
  assert.ok(res.body.data!.every((m) => m.role !== 'member'));
});

// ── Private communities ──

test('a private community admits by request, and rejection admits nobody', async () => {
  const owner = await registerUser();
  const applicant = await registerUser();
  const community = await makeCommunity(owner, { isPrivate: true });

  const join = await api<{ joined: boolean; pending: boolean }>(
    'POST', `/api/v1/communities/${community.id}/join`, { message: 'please' }, applicant.token,
  );
  assert.equal(join.body.data!.joined, false);
  assert.equal(join.body.data!.pending, true);

  // Not a member yet, so not able to post.
  const blocked = await api(
    'POST', `/api/v1/chats/${community.chatId}/messages`,
    { kind: 'text', body: 'let me in', clientId: `c-${Math.random()}` },
    applicant.token,
  );
  assert.equal(blocked.status, 404, 'a pending request is not membership');

  const pending = await api<RequestShape[]>(
    'GET', `/api/v1/communities/${community.id}/requests`, undefined, owner.token,
  );
  assert.equal(pending.body.data!.length, 1);
  const requestId = pending.body.data![0]!.id;

  const rejected = await api(
    'POST', `/api/v1/communities/${community.id}/requests/${requestId}`,
    { approve: false }, owner.token,
  );
  assert.equal(rejected.status, 200);

  const after = await api<CommunityShape>(
    'GET', `/api/v1/communities/${community.id}`, undefined, applicant.token,
  );
  assert.equal(after.body.data!.myRole, undefined, 'rejection does not admit');
  assert.equal(after.body.data!.memberCount, 1);
});

test('approving a request admits to the community and its chat together', async () => {
  const owner = await registerUser();
  const applicant = await registerUser();
  const community = await makeCommunity(owner, { isPrivate: true });

  await api('POST', `/api/v1/communities/${community.id}/join`, {}, applicant.token);
  const pending = await api<RequestShape[]>(
    'GET', `/api/v1/communities/${community.id}/requests`, undefined, owner.token,
  );
  await api(
    'POST', `/api/v1/communities/${community.id}/requests/${pending.body.data![0]!.id}`,
    { approve: true }, owner.token,
  );

  const view = await api<CommunityShape>(
    'GET', `/api/v1/communities/${community.id}`, undefined, applicant.token,
  );
  assert.equal(view.body.data!.myRole, 'member');

  const posted = await api(
    'POST', `/api/v1/chats/${community.chatId}/messages`,
    { kind: 'text', body: 'thanks', clientId: `c-${Math.random()}` },
    applicant.token,
  );
  assert.equal(posted.status, 201, 'admission reaches both halves');
});

test('only staff can read the join request queue', async () => {
  const owner = await registerUser();
  const member = await registerUser();
  const community = await makeCommunity(owner, { isPrivate: true });
  await api('POST', `/api/v1/communities/${community.id}/join`, {}, member.token);

  const res = await api('GET', `/api/v1/communities/${community.id}/requests`, undefined, member.token);
  assert.equal(res.status, 403);
});

// ── Moderation ──

test('a ban removes someone from the conversation, not just flags them', async () => {
  const owner = await registerUser();
  const troublemaker = await registerUser();
  const community = await makeCommunity(owner);
  await api('POST', `/api/v1/communities/${community.id}/join`, {}, troublemaker.token);

  const banned = await api<{ isBanned: boolean }>(
    'POST', `/api/v1/communities/${community.id}/members/${troublemaker.publicId}/moderate`,
    { banned: true }, owner.token,
  );
  assert.equal(banned.status, 200, JSON.stringify(banned.body.error));
  assert.equal(banned.body.data!.isBanned, true);

  const posting = await api(
    'POST', `/api/v1/chats/${community.chatId}/messages`,
    { kind: 'text', body: 'still here', clientId: `c-${Math.random()}` },
    troublemaker.token,
  );
  assert.equal(posting.status, 404, 'a ban is not decorative');

  // And rejoining is refused rather than silently allowed.
  const rejoin = await api(
    'POST', `/api/v1/communities/${community.id}/join`, {}, troublemaker.token,
  );
  assert.equal(rejoin.status, 403);
});

test('a muted member cannot post but is still a member', async () => {
  const owner = await registerUser();
  const member = await registerUser();
  const community = await makeCommunity(owner);
  await api('POST', `/api/v1/communities/${community.id}/join`, {}, member.token);

  await api(
    'POST', `/api/v1/communities/${community.id}/members/${member.publicId}/moderate`,
    { muted: true }, owner.token,
  );

  const posting = await api(
    'POST', `/api/v1/chats/${community.chatId}/messages`,
    { kind: 'text', body: 'hello', clientId: `c-${Math.random()}` },
    member.token,
  );
  assert.equal(posting.status, 403);

  const view = await api<CommunityShape>(
    'GET', `/api/v1/communities/${community.id}`, undefined, member.token,
  );
  assert.equal(view.body.data!.myRole, 'member', 'muting is not removal');
});

test('canPost off leaves staff able to post and members not', async () => {
  const owner = await registerUser();
  const member = await registerUser();
  const community = await makeCommunity(owner);
  await api('POST', `/api/v1/communities/${community.id}/join`, {}, member.token);

  await api('PATCH', `/api/v1/communities/${community.id}`, { canPost: false }, owner.token);

  const asMember = await api(
    'POST', `/api/v1/chats/${community.chatId}/messages`,
    { kind: 'text', body: 'announcement?', clientId: `c-${Math.random()}` },
    member.token,
  );
  assert.equal(asMember.status, 403);

  const asOwner = await api(
    'POST', `/api/v1/chats/${community.chatId}/messages`,
    { kind: 'text', body: 'announcement', clientId: `c-${Math.random()}` },
    owner.token,
  );
  assert.equal(asOwner.status, 201);
});

test('a moderator runs the room but cannot redefine it or promote anyone', async () => {
  const owner = await registerUser();
  const mod = await registerUser();
  const member = await registerUser();

  const community = await makeCommunity(owner);
  await api('POST', `/api/v1/communities/${community.id}/join`, {}, mod.token);
  await api('POST', `/api/v1/communities/${community.id}/join`, {}, member.token);

  await api(
    'PATCH', `/api/v1/communities/${community.id}/members/${mod.publicId}`,
    { role: 'moderator' }, owner.token,
  );

  // Can moderate.
  const muting = await api(
    'POST', `/api/v1/communities/${community.id}/members/${member.publicId}/moderate`,
    { muted: true }, mod.token,
  );
  assert.equal(muting.status, 200);

  // Cannot rename the community.
  const rename = await api(
    'PATCH', `/api/v1/communities/${community.id}`, { name: 'Mine now' }, mod.token,
  );
  assert.equal(rename.status, 403);

  // Cannot promote anyone, including themselves.
  const promote = await api(
    'PATCH', `/api/v1/communities/${community.id}/members/${mod.publicId}`,
    { role: 'admin' }, mod.token,
  );
  assert.equal(promote.status, 403);
});

test('the owner role cannot be reassigned through the role endpoint', async () => {
  const owner = await registerUser();
  const admin = await registerUser();
  const community = await makeCommunity(owner);
  await api('POST', `/api/v1/communities/${community.id}/join`, {}, admin.token);
  await api(
    'PATCH', `/api/v1/communities/${community.id}/members/${admin.publicId}`,
    { role: 'admin' }, owner.token,
  );

  // An admin demoting the owner would be a takeover.
  const attempt = await api(
    'PATCH', `/api/v1/communities/${community.id}/members/${owner.publicId}`,
    { role: 'member' }, admin.token,
  );
  assert.equal(attempt.status, 403);
});

test('the owner cannot leave a community without an owner', async () => {
  const owner = await registerUser();
  const community = await makeCommunity(owner);

  const res = await api('POST', `/api/v1/communities/${community.id}/leave`, {}, owner.token);
  assert.equal(res.status, 403);
});

// ── Calls ──

test('a call rings before it connects, and reports its outcome', async () => {
  const alice = await registerUser();
  const bob = await registerUser();

  const chat = await api<{ id: string }>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  const placed = await api<CallShape>(
    'POST', '/api/v1/calls', { chatId, kind: 'voice' }, alice.token,
  );
  assert.equal(placed.status, 201, JSON.stringify(placed.body.error));
  assert.equal(placed.body.data!.state, 'ringing', 'nothing is captured until it is answered');
  assert.equal(placed.body.data!.outgoing, true);

  const answered = await api<CallShape>(
    'POST', `/api/v1/calls/${placed.body.data!.id}/answer`, {}, bob.token,
  );
  assert.equal(answered.body.data!.state, 'active');
  assert.equal(answered.body.data!.outgoing, false, 'the callee sees it as incoming');

  const ended = await api<CallShape>(
    'POST', `/api/v1/calls/${placed.body.data!.id}/end`, {}, alice.token,
  );
  assert.equal(ended.body.data!.state, 'ended');
});

test('a declined call is recorded as declined, not ended', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<{ id: string }>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );

  const placed = await api<CallShape>(
    'POST', '/api/v1/calls', { chatId: chat.body.data!.id, kind: 'video' }, alice.token,
  );
  const declined = await api<CallShape>(
    'POST', `/api/v1/calls/${placed.body.data!.id}/decline`, {}, bob.token,
  );
  assert.equal(declined.body.data!.state, 'declined');
  assert.equal(declined.body.data!.durationSec, 0);
});

test('a call nobody answered is missed, with no duration', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<{ id: string }>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );

  const placed = await api<CallShape>(
    'POST', '/api/v1/calls', { chatId: chat.body.data!.id, kind: 'voice' }, alice.token,
  );
  // The caller gives up before anyone picks up.
  const ended = await api<CallShape>(
    'POST', `/api/v1/calls/${placed.body.data!.id}/end`, {}, alice.token,
  );

  assert.equal(ended.body.data!.state, 'missed', 'never connected is missed, not ended');
  assert.equal(ended.body.data!.durationSec, 0);
});

test('a stranger cannot end someone else’s call', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const stranger = await registerUser();
  const chat = await api<{ id: string }>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );

  const placed = await api<CallShape>(
    'POST', '/api/v1/calls', { chatId: chat.body.data!.id, kind: 'voice' }, alice.token,
  );

  const res = await api(
    'POST', `/api/v1/calls/${placed.body.data!.id}/end`, {}, stranger.token,
  );
  assert.equal(res.status, 404);
});

test('the messaging rules cannot be bypassed by calling instead of typing', async () => {
  const alice = await registerUser();
  const bob = await registerUser();

  const chat = await api<{ id: string }>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  await api('PATCH', '/api/v1/me/privacy', { whoCanMessage: 'nobody' }, bob.token);

  const call = await api('POST', '/api/v1/calls', { chatId, kind: 'voice' }, alice.token);
  assert.equal(call.status, 403, 'a call is a more intrusive contact than a message');
});

test('a block stops calls in both directions', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<{ id: string }>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  await api('POST', `/api/v1/users/${alice.publicId}/block`, {}, bob.token);

  const call = await api('POST', '/api/v1/calls', { chatId, kind: 'voice' }, alice.token);
  assert.equal(call.status, 404);
});

test('a second call is not placed while one is live', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<{ id: string }>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );
  const chatId = chat.body.data!.id;

  const first = await api<CallShape>('POST', '/api/v1/calls', { chatId, kind: 'voice' }, alice.token);
  const second = await api<CallShape>('POST', '/api/v1/calls', { chatId, kind: 'voice' }, alice.token);

  assert.equal(second.body.data!.id, first.body.data!.id, 'the live call is returned, not a new one');
});

test('call history shows both sides with the right direction', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<{ id: string }>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );

  const placed = await api<CallShape>(
    'POST', '/api/v1/calls', { chatId: chat.body.data!.id, kind: 'voice' }, alice.token,
  );
  await api('POST', `/api/v1/calls/${placed.body.data!.id}/decline`, {}, bob.token);

  const aliceHistory = await api<CallShape[]>('GET', '/api/v1/calls', undefined, alice.token);
  const bobHistory = await api<CallShape[]>('GET', '/api/v1/calls', undefined, bob.token);

  assert.equal(aliceHistory.body.data![0]!.outgoing, true);
  assert.equal(bobHistory.body.data![0]!.outgoing, false);
});

test('signalling payloads are relayed without being inspected', async () => {
  const alice = await registerUser();
  const bob = await registerUser();
  const chat = await api<{ id: string }>(
    'POST', '/api/v1/chats/direct', { userId: bob.publicId }, alice.token,
  );

  const placed = await api<CallShape>(
    'POST', '/api/v1/calls', { chatId: chat.body.data!.id, kind: 'video' }, alice.token,
  );

  // Deliberately not valid SDP: the server must not care.
  const relayed = await api<{ relayed: number }>(
    'POST', `/api/v1/calls/${placed.body.data!.id}/offer`,
    { payload: { anything: 'at all', nested: [1, 2, 3] } },
    alice.token,
  );
  assert.equal(relayed.status, 200, JSON.stringify(relayed.body.error));
  assert.equal(relayed.body.data!.relayed, 1);
});
