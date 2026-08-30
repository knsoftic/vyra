/**
 * Verification, support and moderation end-to-end.
 *
 * The Phase 12 exit criteria, written as the things that would be damaging:
 *
 *   1. an identity document is never returned to anyone through the API
 *   2. documents are destroyed once the decision is final
 *   3. an internal staff note never reaches the user
 *   4. a moderation decision actually enforces what it says
 *   5. every action is attributed, reasoned and reversible
 *   6. a reporter learns the outcome and nothing else
 *   7. an ordinary account cannot reach any staff surface
 *   8. a temporary restriction lifts by itself
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
const moderation = await import('../src/modules/trust/moderation.service.ts');

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

interface Actor {
  token: string;
  publicId: string;
  id: number;
  username: string;
}

async function registerUser(): Promise<Actor> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `p12_${suffix}@vyra.test`;
  const username = `p12_${suffix}`;
  createdEmails.push(email);

  const res = await api<{ user: { id: string }; tokens: { accessToken: string } }>(
    'POST',
    '/api/v1/auth/register',
    {
      email,
      password: 'Str0ng-Passphrase!',
      username,
      birthdate: '1995-04-12',
      device: { deviceId: `dev-p12-${suffix}`, platform: 'web' },
    },
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));

  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return {
    token: res.body.data!.tokens.accessToken,
    publicId: res.body.data!.user.id,
    id: row!.id,
    username,
  };
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

const rid = () => `V${Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(25, '0')}`;

async function makeVideo(userId: number): Promise<{ id: number; publicId: string }> {
  const publicId = rid();
  const result = await execute(
    `INSERT INTO videos
       (public_id, user_id, caption, duration_sec, privacy, status, processing_status)
     VALUES (:publicId, :userId, 'trust test', 30, 'public', 'published', 'complete')`,
    { publicId, userId },
  );
  return { id: result.insertId, publicId };
}

/** A completed upload the applicant owns, so a document key passes ownership. */
async function makeUpload(userId: number): Promise<string> {
  const { ulid } = await import('ulid');
  const key = `upload/${ulid()}.jpg`;
  await execute(
    `INSERT INTO upload_sessions
       (public_id, user_id, kind, filename, content_type, size_bytes,
        chunk_size, total_chunks, storage_key, status, expires_at)
     VALUES (:publicId, :userId, 'image', 'id.jpg', 'image/jpeg', 1024, 1024, 1, :key, 'complete',
             DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY))`,
    { publicId: ulid(), userId, key },
  );
  return key;
}

interface VerificationShape {
  id: string;
  tier: string;
  status: string;
  documentCount: number;
}

interface TicketShape {
  id: string;
  subject: string;
  status: string;
  messages: { id: string; body: string; isStaff: boolean; isInternal?: boolean }[];
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

      await execute(
        `DELETE d FROM verification_documents d
           JOIN verification_requests r ON r.id = d.request_id WHERE r.user_id = ?`,
        [id],
      );
      await execute('DELETE FROM verification_requests WHERE user_id = ?', [id]);
      await execute(
        'DELETE m FROM ticket_messages m JOIN support_tickets t ON t.id = m.ticket_id WHERE t.user_id = ?',
        [id],
      );
      await execute('DELETE FROM ticket_messages WHERE author_id = ?', [id]);
      await execute('DELETE FROM support_tickets WHERE user_id = ?', [id]);
      await execute('DELETE FROM moderation_actions WHERE admin_id = ?', [id]);
      await execute(
        'DELETE FROM moderation_actions WHERE target_type = ? AND target_id = ?',
        ['user', id],
      );
      await execute('DELETE FROM reports WHERE reporter_id = ?', [id]);
      await execute('DELETE FROM reports WHERE target_type = ? AND target_id = ?', ['user', id]);
      await execute('DELETE FROM upload_sessions WHERE user_id = ?', [id]);
      await execute('DELETE FROM feed_seen WHERE user_id = ?', [id]);
      await execute(
        'DELETE FROM reports WHERE target_type = ? AND target_id IN (SELECT id FROM videos WHERE user_id = ?)',
        ['video', id],
      );
      await execute(
        'DELETE FROM moderation_actions WHERE target_type = ? AND target_id IN (SELECT id FROM videos WHERE user_id = ?)',
        ['video', id],
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

// ── Identity documents ──

test('a storage key is never returned to anyone', async () => {
  const applicant = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const key = await makeUpload(applicant.id);
  const submitted = await api<VerificationShape>(
    'POST',
    '/api/v1/me/verification',
    { tier: 'creator', documentKeys: [key] },
    applicant.token,
  );
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body.error));
  assert.equal(submitted.body.data!.documentCount, 1, 'the count is returned');

  // Not in the submission response.
  assert.ok(
    !JSON.stringify(submitted.body).includes(key),
    'the submission response must not echo the key back',
  );

  // Not in the applicant's own list.
  const mine = await api<VerificationShape[]>(
    'GET', '/api/v1/me/verification', undefined, applicant.token,
  );
  assert.ok(!JSON.stringify(mine.body).includes(key));

  // Not in the reviewer's queue either — only ids a link can be requested for.
  const queue = await api<unknown[]>('GET', '/api/v1/admin/verification', undefined, admin.token);
  assert.equal(queue.status, 200, JSON.stringify(queue.body.error));
  assert.ok(
    !JSON.stringify(queue.body).includes(key),
    'a reviewer gets document ids, never storage keys',
  );
});

test('a document can only be opened through a short-lived signed link', async () => {
  const applicant = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const key = await makeUpload(applicant.id);
  await api('POST', '/api/v1/me/verification', { tier: 'creator', documentKeys: [key] }, applicant.token);

  const doc = await queryOne<{ id: number }>(
    `SELECT d.id FROM verification_documents d
       JOIN verification_requests r ON r.id = d.request_id
      WHERE r.user_id = ?`,
    [applicant.id],
  );

  const link = await api<{ url: string; expiresInSeconds: number }>(
    'POST',
    `/api/v1/admin/verification/documents/${doc!.id}/view`,
    {},
    admin.token,
  );
  assert.equal(link.status, 200, JSON.stringify(link.body.error));
  assert.ok(link.body.data!.url.includes('sig='), 'the link is signed');
  assert.ok(link.body.data!.expiresInSeconds <= 600, 'and short-lived');

  // The applicant cannot ask for a link to their own document either — the
  // route is staff-only, because nothing good comes of re-issuing shareable
  // links to identity documents.
  const asApplicant = await api(
    'POST',
    `/api/v1/admin/verification/documents/${doc!.id}/view`,
    {},
    applicant.token,
  );
  assert.equal(asApplicant.status, 403);
});

test('opening a document is written to the security log', async () => {
  const applicant = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const key = await makeUpload(applicant.id);
  await api('POST', '/api/v1/me/verification', { tier: 'creator', documentKeys: [key] }, applicant.token);

  const doc = await queryOne<{ id: number }>(
    `SELECT d.id FROM verification_documents d
       JOIN verification_requests r ON r.id = d.request_id WHERE r.user_id = ?`,
    [applicant.id],
  );
  await api('POST', `/api/v1/admin/verification/documents/${doc!.id}/view`, {}, admin.token);

  const events = await query<{ event: string; detail: string | null }>(
    "SELECT event, detail FROM security_events WHERE user_id = ? AND event = 'verification_document_viewed'",
    [applicant.id],
  );
  assert.equal(events.length, 1, 'looking at someone’s passport leaves a trace');
  assert.ok(events[0]!.detail?.includes(String(admin.id)), 'and the trace names who looked');
});

test('documents are destroyed once the decision is final', async () => {
  const applicant = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const key = await makeUpload(applicant.id);
  const submitted = await api<VerificationShape>(
    'POST', '/api/v1/me/verification', { tier: 'creator', documentKeys: [key] }, applicant.token,
  );

  const before = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM verification_documents d
       JOIN verification_requests r ON r.id = d.request_id
      WHERE r.user_id = ? AND d.deleted_at IS NULL`,
    [applicant.id],
  );
  assert.equal(Number(before?.c), 1);

  const decided = await api<VerificationShape>(
    'POST',
    `/api/v1/admin/verification/${submitted.body.data!.id}`,
    { decision: 'approved', note: 'Documents check out' },
    admin.token,
  );
  assert.equal(decided.status, 200, JSON.stringify(decided.body.error));

  const after = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM verification_documents d
       JOIN verification_requests r ON r.id = d.request_id
      WHERE r.user_id = ? AND d.deleted_at IS NULL`,
    [applicant.id],
  );
  assert.equal(Number(after?.c), 0, 'a decided request keeps no identity documents');

  // The decision itself survives, so it stays auditable.
  const record = await queryOne<{ status: string }>(
    'SELECT status FROM verification_requests WHERE user_id = ?',
    [applicant.id],
  );
  assert.equal(record?.status, 'approved');
});

test('asking for more information keeps the documents', async () => {
  const applicant = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const key = await makeUpload(applicant.id);
  const submitted = await api<VerificationShape>(
    'POST', '/api/v1/me/verification', { tier: 'creator', documentKeys: [key] }, applicant.token,
  );

  await api(
    'POST',
    `/api/v1/admin/verification/${submitted.body.data!.id}`,
    { decision: 'more_info', note: 'The date of birth is not readable' },
    admin.token,
  );

  const remaining = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM verification_documents d
       JOIN verification_requests r ON r.id = d.request_id
      WHERE r.user_id = ? AND d.deleted_at IS NULL`,
    [applicant.id],
  );
  assert.equal(Number(remaining?.c), 1, 'the applicant is being asked to add to them');
});

test('a document key that belongs to someone else is refused', async () => {
  const applicant = await registerUser();
  const other = await registerUser();

  const foreignKey = await makeUpload(other.id);
  const res = await api(
    'POST',
    '/api/v1/me/verification',
    { tier: 'creator', documentKeys: [foreignKey] },
    applicant.token,
  );
  assert.equal(res.status, 403, 'a reviewer must not be pointed at a stranger’s document');
});

test('approving verification sets the badge', async () => {
  const applicant = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const key = await makeUpload(applicant.id);
  const submitted = await api<VerificationShape>(
    'POST', '/api/v1/me/verification', { tier: 'business', documentKeys: [key] }, applicant.token,
  );

  await api(
    'POST',
    `/api/v1/admin/verification/${submitted.body.data!.id}`,
    { decision: 'approved', note: 'Registration confirmed' },
    admin.token,
  );

  const row = await queryOne<{ verification_tier: string }>(
    'SELECT verification_tier FROM users WHERE id = ?',
    [applicant.id],
  );
  assert.equal(row?.verification_tier, 'business');
});

test('rejecting verification does not set a badge', async () => {
  const applicant = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const key = await makeUpload(applicant.id);
  const submitted = await api<VerificationShape>(
    'POST', '/api/v1/me/verification', { tier: 'creator', documentKeys: [key] }, applicant.token,
  );
  await api(
    'POST',
    `/api/v1/admin/verification/${submitted.body.data!.id}`,
    { decision: 'rejected', note: 'The document does not match the account name' },
    admin.token,
  );

  const row = await queryOne<{ verification_tier: string }>(
    'SELECT verification_tier FROM users WHERE id = ?',
    [applicant.id],
  );
  assert.equal(row?.verification_tier, 'none');
});

test('only one verification request can be open at a time', async () => {
  const applicant = await registerUser();
  const key1 = await makeUpload(applicant.id);
  const key2 = await makeUpload(applicant.id);

  await api('POST', '/api/v1/me/verification', { tier: 'creator', documentKeys: [key1] }, applicant.token);
  const second = await api(
    'POST', '/api/v1/me/verification', { tier: 'creator', documentKeys: [key2] }, applicant.token,
  );
  assert.equal(second.status, 422);
});

// ── Support ──

test('an internal staff note never reaches the user', async () => {
  const user = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const created = await api<TicketShape>(
    'POST',
    '/api/v1/me/tickets',
    { subject: 'Coins missing', category: 'coins', body: 'I bought coins and they did not arrive.' },
    user.token,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body.error));
  const id = created.body.data!.id;

  const secret = 'INTERNAL: this account has two prior chargebacks';
  await api(
    'POST',
    `/api/v1/admin/tickets/${id}/reply`,
    { body: secret, internal: true },
    admin.token,
  );
  await api(
    'POST',
    `/api/v1/admin/tickets/${id}/reply`,
    { body: 'We are looking into this now.', internal: false },
    admin.token,
  );

  const asUser = await api<TicketShape>('GET', `/api/v1/me/tickets/${id}`, undefined, user.token);
  const serialised = JSON.stringify(asUser.body);

  assert.ok(!serialised.includes(secret), 'an internal note must never reach the user');
  assert.ok(serialised.includes('We are looking into this now.'), 'the reply does');
  assert.equal(asUser.body.data!.messages.length, 2, 'their message and one reply');

  // Staff see both.
  const asStaff = await api<TicketShape>(
    'GET', `/api/v1/admin/tickets/${id}`, undefined, admin.token,
  );
  assert.equal(asStaff.body.data!.messages.length, 3);
  assert.ok(asStaff.body.data!.messages.some((m) => m.isInternal === true));
});

test('an internal note does not move the ticket to waiting', async () => {
  const user = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const created = await api<TicketShape>(
    'POST',
    '/api/v1/me/tickets',
    { subject: 'Question', category: 'account', body: 'How do I change my username?' },
    user.token,
  );
  const id = created.body.data!.id;

  await api(
    'POST', `/api/v1/admin/tickets/${id}/reply`, { body: 'Checking with billing', internal: true },
    admin.token,
  );

  const still = await api<TicketShape>('GET', `/api/v1/me/tickets/${id}`, undefined, user.token);
  assert.equal(
    still.body.data!.status,
    'open',
    'nobody has actually answered, so the clock keeps running',
  );
});

test('a user cannot read someone else ticket', async () => {
  const user = await registerUser();
  const nosy = await registerUser();

  const created = await api<TicketShape>(
    'POST',
    '/api/v1/me/tickets',
    { subject: 'Private matter', category: 'payment', body: 'Something about my payment card.' },
    user.token,
  );

  const res = await api(
    'GET', `/api/v1/me/tickets/${created.body.data!.id}`, undefined, nosy.token,
  );
  assert.equal(res.status, 404);
});

test('a reply reopens a waiting ticket', async () => {
  const user = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const created = await api<TicketShape>(
    'POST',
    '/api/v1/me/tickets',
    { subject: 'Still broken', category: 'technical', body: 'The upload keeps failing.' },
    user.token,
  );
  const id = created.body.data!.id;

  await api(
    'POST', `/api/v1/admin/tickets/${id}/reply`, { body: 'Try again now.', internal: false },
    admin.token,
  );
  const waiting = await api<TicketShape>('GET', `/api/v1/me/tickets/${id}`, undefined, user.token);
  assert.equal(waiting.body.data!.status, 'waiting');

  const replied = await api<TicketShape>(
    'POST', `/api/v1/me/tickets/${id}/reply`, { body: 'Still failing.' }, user.token,
  );
  assert.equal(replied.body.data!.status, 'open', 'they are still asking');
});

// ── Moderation enforcement ──

test('a suspension actually suspends', async () => {
  const offender = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  // The account works before the decision.
  const before = await api('GET', '/api/v1/me', undefined, offender.token);
  assert.equal(before.status, 200);

  const decided = await api<{ enforced: string }>(
    'POST',
    '/api/v1/admin/moderation',
    {
      targetType: 'user',
      targetId: offender.publicId,
      action: 'suspension',
      reason: 'Repeated harassment after a warning',
    },
    admin.token,
  );
  assert.equal(decided.status, 200, JSON.stringify(decided.body.error));
  assert.ok(decided.body.data!.enforced.includes('suspended'));

  // And stops working immediately, rather than when the token expires.
  const after = await api('GET', '/api/v1/me', undefined, offender.token);
  assert.equal(after.status, 403);
  assert.equal(after.body.error?.code, 'account_suspended');
});

test('a content removal actually removes', async () => {
  const creator = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  const video = await makeVideo(creator.id);

  const decided = await api<{ enforced: string }>(
    'POST',
    '/api/v1/admin/moderation',
    {
      targetType: 'video',
      targetId: video.publicId,
      action: 'content_removal',
      reason: 'Prohibited content',
    },
    admin.token,
  );
  assert.ok(decided.body.data!.enforced.includes('removed'));

  const row = await queryOne<{ status: string; deleted_at: Date | null }>(
    'SELECT status, deleted_at FROM videos WHERE id = ?',
    [video.id],
  );
  assert.equal(row?.status, 'removed');
  assert.ok(row?.deleted_at !== null);
});

test('restricting distribution keeps the video but stops recommending it', async () => {
  const creator = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  const video = await makeVideo(creator.id);

  await api(
    'POST',
    '/api/v1/admin/moderation',
    {
      targetType: 'video',
      targetId: video.publicId,
      action: 'restrict_distribution',
      reason: 'Borderline under the guidelines',
    },
    admin.token,
  );

  const row = await queryOne<{ status: string; deleted_at: Date | null }>(
    'SELECT status, deleted_at FROM videos WHERE id = ?',
    [video.id],
  );
  // Still there — the creator has not lost their work — but out of the feed,
  // which selects only published rows.
  assert.equal(row?.status, 'restricted');
  assert.equal(row?.deleted_at, null);
});

test('a decision without a reason is refused', async () => {
  const offender = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const res = await api(
    'POST',
    '/api/v1/admin/moderation',
    { targetType: 'user', targetId: offender.publicId, action: 'suspension', reason: '' },
    admin.token,
  );
  assert.equal(res.status, 400, 'a decision nobody can review is not a decision');
});

test('reverting a suspension restores the account', async () => {
  const offender = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const decided = await api<{ actionId: number }>(
    'POST',
    '/api/v1/admin/moderation',
    {
      targetType: 'user',
      targetId: offender.publicId,
      action: 'suspension',
      reason: 'Reported for spam',
    },
    admin.token,
  );

  const reverted = await api<{ restored: string }>(
    'POST',
    `/api/v1/admin/moderation/${decided.body.data!.actionId}/revert`,
    { reason: 'Appeal upheld — the reports were coordinated' },
    admin.token,
  );
  assert.equal(reverted.status, 200, JSON.stringify(reverted.body.error));
  assert.ok(reverted.body.data!.restored.includes('restored'));

  const row = await queryOne<{ status: string }>('SELECT status FROM users WHERE id = ?', [
    offender.id,
  ]);
  assert.equal(row?.status, 'active', 'a reverted suspension is actually lifted');
});

test('reverting a removal restores the video', async () => {
  const creator = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  const video = await makeVideo(creator.id);

  const decided = await api<{ actionId: number }>(
    'POST',
    '/api/v1/admin/moderation',
    {
      targetType: 'video',
      targetId: video.publicId,
      action: 'content_removal',
      reason: 'Reported as prohibited',
    },
    admin.token,
  );

  await api(
    'POST',
    `/api/v1/admin/moderation/${decided.body.data!.actionId}/revert`,
    { reason: 'Mistaken identification' },
    admin.token,
  );

  const row = await queryOne<{ status: string; deleted_at: Date | null }>(
    'SELECT status, deleted_at FROM videos WHERE id = ?',
    [video.id],
  );
  assert.equal(row?.status, 'published');
  assert.equal(row?.deleted_at, null);
});

test('an action cannot be reverted twice', async () => {
  const offender = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const decided = await api<{ actionId: number }>(
    'POST',
    '/api/v1/admin/moderation',
    { targetType: 'user', targetId: offender.publicId, action: 'suspension', reason: 'Spam' },
    admin.token,
  );
  const actionId = decided.body.data!.actionId;

  await api('POST', `/api/v1/admin/moderation/${actionId}/revert`, { reason: 'Appeal' }, admin.token);
  const again = await api(
    'POST', `/api/v1/admin/moderation/${actionId}/revert`, { reason: 'Appeal' }, admin.token,
  );
  assert.equal(again.status, 422);
});

test('a ban does not delete anything', async () => {
  const offender = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);
  const video = await makeVideo(offender.id);

  await api(
    'POST',
    '/api/v1/admin/moderation',
    {
      targetType: 'user',
      targetId: offender.publicId,
      action: 'permanent_ban',
      reason: 'Severe and repeated breaches',
    },
    admin.token,
  );

  // The account loses access; its content, wallet and history stay where they
  // are, because reversing a ban has to be possible.
  const user = await queryOne<{ status: string; deleted_at: Date | null }>(
    'SELECT status, deleted_at FROM users WHERE id = ?',
    [offender.id],
  );
  assert.equal(user?.status, 'banned');
  assert.equal(user?.deleted_at, null);

  const row = await queryOne<{ deleted_at: Date | null }>(
    'SELECT deleted_at FROM videos WHERE id = ?',
    [video.id],
  );
  assert.equal(row?.deleted_at, null, 'a ban is a loss of access, not a deletion');
});

test('a temporary restriction lifts by itself', async () => {
  const offender = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const decided = await api<{ actionId: number; expiresAt?: string }>(
    'POST',
    '/api/v1/admin/moderation',
    {
      targetType: 'user',
      targetId: offender.publicId,
      action: 'temporary_restriction',
      reason: 'Cooling-off period',
      durationHours: 24,
    },
    admin.token,
  );
  assert.ok(decided.body.data!.expiresAt, 'the expiry is stated');

  const frozen = await queryOne<{ status: string }>('SELECT status FROM users WHERE id = ?', [
    offender.id,
  ]);
  assert.equal(frozen?.status, 'frozen');

  // Bring the expiry forward and run the sweep.
  await execute(
    'UPDATE moderation_actions SET expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR) WHERE id = ?',
    [decided.body.data!.actionId],
  );
  const result = await moderation.expireRestrictions();
  assert.ok(result.lifted >= 1);

  const after = await queryOne<{ status: string }>('SELECT status FROM users WHERE id = ?', [
    offender.id,
  ]);
  assert.equal(after?.status, 'active', 'a temporary restriction nobody lifts is a permanent one');
});

// ── What a reporter is told ──

test('a reporter learns the outcome and nothing else', async () => {
  const reporter = await registerUser();
  const offender = await registerUser();
  const admin = await registerUser();
  await makeAdmin(admin);

  const filed = await api<{ reportId: string }>(
    'POST',
    '/api/v1/reports',
    { targetType: 'user', targetId: offender.publicId, reason: 'harassment' },
    reporter.token,
  );
  assert.equal(filed.status, 201, JSON.stringify(filed.body.error));

  const pending = await api<{ status: string; outcome: string }>(
    'GET', `/api/v1/me/reports/${filed.body.data!.reportId}/outcome`, undefined, reporter.token,
  );
  assert.equal(pending.body.data!.status, 'pending');

  await api(
    'POST',
    '/api/v1/admin/moderation',
    {
      reportId: filed.body.data!.reportId,
      targetType: 'user',
      targetId: offender.publicId,
      action: 'warning',
      reason: 'First offence, warned',
    },
    admin.token,
  );

  const outcome = await api<{ status: string; outcome: string }>(
    'GET', `/api/v1/me/reports/${filed.body.data!.reportId}/outcome`, undefined, reporter.token,
  );
  assert.equal(outcome.body.data!.status, 'actioned');

  const text = JSON.stringify(outcome.body);
  assert.ok(!text.includes('warning'), 'the reporter is not told what action was taken');
  assert.ok(!text.includes('First offence'), 'nor the moderator’s reasoning');
  assert.ok(!text.includes(offender.username), 'nor anything more about the account');
});

test('someone else report is not readable', async () => {
  const reporter = await registerUser();
  const nosy = await registerUser();
  const offender = await registerUser();

  const filed = await api<{ reportId: string }>(
    'POST',
    '/api/v1/reports',
    { targetType: 'user', targetId: offender.publicId, reason: 'spam' },
    reporter.token,
  );

  const res = await api(
    'GET', `/api/v1/me/reports/${filed.body.data!.reportId}/outcome`, undefined, nosy.token,
  );
  assert.equal(res.status, 404);
});

// ── The staff boundary ──

test('an ordinary account cannot reach any staff surface', async () => {
  const user = await registerUser();

  const staffRoutes: [string, string][] = [
    ['GET', '/api/v1/admin/verification'],
    ['GET', '/api/v1/admin/reports'],
    ['GET', '/api/v1/admin/tickets'],
  ];

  for (const [method, path] of staffRoutes) {
    const res = await api(method, path, undefined, user.token);
    assert.equal(res.status, 403, `${path} must refuse an ordinary account`);
  }

  const moderate = await api(
    'POST',
    '/api/v1/admin/moderation',
    { targetType: 'user', targetId: user.publicId, action: 'reinstate', reason: 'trying it on' },
    user.token,
  );
  assert.equal(moderate.status, 403);
});
