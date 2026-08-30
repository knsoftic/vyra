/**
 * Notifications, preferences and delivery end-to-end.
 *
 * The Phase 13 exit criteria:
 *
 *   1. a preference actually gates delivery
 *   2. nobody is notified about their own action, or by someone they blocked
 *   3. a verification code is queued for email, once per code
 *   4. the outbox claims a row before sending, so nothing is sent twice
 *   5. a failure is recorded, backed off, and eventually abandoned — never lost
 *   6. push with no provider fails visibly rather than reporting success
 *   7. quiet hours suppress the interruption, never the record
 *   8. a notification failing never fails the action that caused it
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
const notifications = await import('../src/modules/notifications/notifications.service.ts');
const outbox = await import('../src/modules/notifications/outbox.service.ts');

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
  email: string;
}

async function registerUser(): Promise<Actor> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `p13_${suffix}@vyra.test`;
  createdEmails.push(email);

  const res = await api<{ user: { id: string }; tokens: { accessToken: string } }>(
    'POST',
    '/api/v1/auth/register',
    {
      email,
      password: 'Str0ng-Passphrase!',
      username: `p13_${suffix}`,
      birthdate: '1995-04-12',
      device: { deviceId: `dev-p13-${suffix}`, platform: 'web' },
    },
  );
  assert.equal(res.status, 201, JSON.stringify(res.body.error));

  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return {
    token: res.body.data!.tokens.accessToken,
    publicId: res.body.data!.user.id,
    id: row!.id,
    email,
  };
}

async function outboxFor(userId: number, channel?: 'email' | 'push') {
  return query<{
    id: number;
    channel: string;
    template: string;
    status: string;
    attempts: number;
    last_error: string | null;
    payload: string;
  }>(
    `SELECT id, channel, template, status, attempts, last_error, payload
       FROM outbox WHERE user_id = ? ${channel ? 'AND channel = ?' : ''}
      ORDER BY id`,
    channel ? [userId, channel] : [userId],
  );
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
      await execute('DELETE FROM outbox WHERE destination = ?', [email]);
      if (!user) continue;
      const id = user.id;

      await execute('DELETE FROM outbox WHERE user_id = ?', [id]);
      await execute('DELETE FROM notification_preferences WHERE user_id = ?', [id]);
      await execute('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', [id, id]);
      await execute('DELETE FROM otp_codes WHERE email = ?', [email]);
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

// ── Preferences gate delivery ──

test('a preference turned off actually stops the notification', async () => {
  const recipient = await registerUser();
  const actor = await registerUser();

  const on = await notifications.notify({
    userId: recipient.id,
    actorId: actor.id,
    kind: 'follow',
    body: 'Someone followed you',
  });
  assert.equal(on.inApp, true);

  await notifications.setPreference(recipient.id, 'follow', { inApp: false, push: false });

  const off = await notifications.notify({
    userId: recipient.id,
    actorId: actor.id,
    kind: 'follow',
    body: 'Someone else followed you',
  });
  assert.equal(off.inApp, false);
  assert.equal(off.skipped, 'preference');

  const rows = await query<{ c: number }>(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?',
    [recipient.id],
  );
  assert.equal(Number(rows[0]?.c), 1, 'the second one was never written');
});

interface PreferencesResponse {
  preferences: Record<string, { inApp: boolean; push: boolean; email: boolean }>;
  quietHours: { start: number | null; end: number | null };
}

test('preferences round-trip through the API', async () => {
  const user = await registerUser();

  const defaults = await api<PreferencesResponse>(
    'GET', '/api/v1/me/notification-preferences', undefined, user.token,
  );
  assert.equal(defaults.status, 200, JSON.stringify(defaults.body.error));
  assert.equal(defaults.body.data!.preferences.like!.inApp, true);
  // Consent is given, not withdrawn.
  assert.equal(defaults.body.data!.preferences.marketing!.email, false);

  const updated = await api<{ inApp: boolean; push: boolean; email: boolean }>(
    'PATCH',
    '/api/v1/me/notification-preferences',
    { kind: 'like', push: false },
    user.token,
  );
  assert.equal(updated.body.data!.push, false);
  assert.equal(updated.body.data!.inApp, true, 'unspecified channels are left alone');

  const reread = await api<PreferencesResponse>(
    'GET', '/api/v1/me/notification-preferences', undefined, user.token,
  );
  assert.equal(reread.body.data!.preferences.like!.push, false, 'it persisted');
});

test('quiet hours can be read back, not only written', async () => {
  const user = await registerUser();

  const before = await api<PreferencesResponse>(
    'GET', '/api/v1/me/notification-preferences', undefined, user.token,
  );
  assert.equal(before.body.data!.quietHours.start, null, 'nobody starts with a quiet window');

  const set = await api('PATCH', '/api/v1/me/quiet-hours', { start: 22, end: 7 }, user.token);
  assert.equal(set.status, 200, JSON.stringify(set.body.error));

  // A setting that can be changed but not read is one the screen has to guess at.
  const after = await api<PreferencesResponse>(
    'GET', '/api/v1/me/notification-preferences', undefined, user.token,
  );
  assert.equal(after.body.data!.quietHours.start, 22);
  assert.equal(after.body.data!.quietHours.end, 7);

  const cleared = await api('PATCH', '/api/v1/me/quiet-hours', { start: null, end: null }, user.token);
  assert.equal(cleared.status, 200);
  const off = await api<PreferencesResponse>(
    'GET', '/api/v1/me/notification-preferences', undefined, user.token,
  );
  assert.equal(off.body.data!.quietHours.start, null, 'it can be turned back off');
});

test('marketing is off on every channel by default', async () => {
  const user = await registerUser();
  const prefs = await notifications.preferencesFor(user.id);

  assert.equal(prefs.marketing.inApp, false);
  assert.equal(prefs.marketing.push, false);
  assert.equal(prefs.marketing.email, false);
});

// ── Who is never notified ──

test('nobody is notified about their own action', async () => {
  const user = await registerUser();

  const result = await notifications.notify({
    userId: user.id,
    actorId: user.id,
    kind: 'like',
    body: 'You liked your own video',
  });

  assert.equal(result.inApp, false);
  assert.equal(result.skipped, 'self');
});

test('a blocked actor cannot reach you through a notification', async () => {
  const recipient = await registerUser();
  const actor = await registerUser();

  await api('POST', `/api/v1/users/${actor.publicId}/block`, {}, recipient.token);

  const result = await notifications.notify({
    userId: recipient.id,
    actorId: actor.id,
    kind: 'comment',
    body: 'They commented on your video',
  });

  assert.equal(result.inApp, false);
  assert.equal(result.skipped, 'blocked');
});

// ── Verification codes reach the outbox ──

test('requesting a code queues exactly one email', async () => {
  const user = await registerUser();

  const res = await api<{ sent: boolean }>(
    'POST',
    '/api/v1/auth/otp/request',
    { email: user.email, purpose: 'reset' },
    undefined,
  );
  assert.equal(res.status, 200, JSON.stringify(res.body.error));

  const queued = await query<{ template: string; destination: string; status: string; payload: string }>(
    "SELECT template, destination, status, payload FROM outbox WHERE destination = ? AND channel = 'email'",
    [user.email],
  );

  assert.equal(queued.length, 1, 'one code, one email');
  assert.equal(queued[0]!.template, 'otp.reset');
  assert.equal(queued[0]!.status, 'pending');
  assert.ok(
    (JSON.parse(queued[0]!.payload) as { code?: string }).code,
    'the code travels as a template variable, so a template fix reaches queued mail',
  );
});

test('a code for an address with no account queues nothing', async () => {
  const res = await api<{ sent: boolean }>(
    'POST',
    '/api/v1/auth/otp/request',
    { email: 'nobody-p13@vyra.test', purpose: 'reset' },
    undefined,
  );
  // The response is identical either way — saying otherwise enumerates accounts.
  assert.equal(res.status, 200);

  const queued = await query<{ c: number }>(
    'SELECT COUNT(*) AS c FROM outbox WHERE destination = ?',
    ['nobody-p13@vyra.test'],
  );
  assert.equal(Number(queued[0]?.c), 0);
});

// ── The outbox ──

test('a row is claimed before it is sent, so nothing sends twice', async () => {
  const user = await registerUser();
  // The queue is global, so clear whatever earlier tests left in it before
  // counting. Otherwise this measures the backlog rather than this message.
  await outbox.drain();

  await outbox.queue({
    channel: 'email',
    destination: user.email,
    userId: user.id,
    template: 'otp.reset',
    payload: { code: '123456' },
  });

  const first = await outbox.drain();
  assert.equal(first.sent, 1);

  // A second drain finds nothing: the row is already `sent`.
  const second = await outbox.drain();
  assert.equal(second.sent, 0);

  const rows = await outboxFor(user.id, 'email');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, 'sent');
});

test('a duplicate dedupe key queues one message', async () => {
  const user = await registerUser();
  const key = `test-dedupe-${user.id}`;

  await outbox.queue({
    channel: 'email',
    destination: user.email,
    userId: user.id,
    template: 'otp.reset',
    payload: { code: '111111' },
    dedupeKey: key,
  });
  const second = await outbox.queue({
    channel: 'email',
    destination: user.email,
    userId: user.id,
    template: 'otp.reset',
    payload: { code: '222222' },
    dedupeKey: key,
  });

  assert.equal(second.queued, false, 'the second is recognised as the same message');

  // Regression: this read `affectedRows` from an ON DUPLICATE KEY UPDATE, which
  // mysql2's prepared statements report as a matched row either way. Every
  // duplicate was therefore reported as freshly queued, so any caller deciding
  // "have I already emailed this person" got the wrong answer every time.

  const rows = await outboxFor(user.id, 'email');
  assert.equal(rows.length, 1);
  assert.ok(
    rows[0]!.payload.includes('111111'),
    'and the first code stands — a retry cannot deliver a different one',
  );
});

test('push with no provider fails visibly rather than reporting success', async () => {
  const user = await registerUser();
  await outbox.drain();

  await outbox.queue({
    channel: 'push',
    destination: 'fake-push-token-abcdef',
    userId: user.id,
    template: 'push.like',
    payload: { body: 'Someone liked your video' },
  });

  const result = await outbox.drain();
  assert.equal(result.sent, 0, 'nothing was actually delivered');
  assert.equal(result.failed, 1);

  const rows = await outboxFor(user.id, 'push');
  assert.equal(rows[0]!.status, 'pending', 'it will be retried');
  assert.equal(rows[0]!.attempts, 1);
  assert.ok(
    rows[0]!.last_error?.includes('push provider'),
    'and the reason is on the row, not swallowed',
  );
});

test('a message that keeps failing is abandoned, not lost', async () => {
  const user = await registerUser();

  await outbox.queue({
    channel: 'push',
    destination: 'fake-push-token-fedcba',
    userId: user.id,
    template: 'push.like',
    payload: { body: 'Nothing will deliver this' },
  });

  // Five attempts. The backoff is cleared each round so the test does not wait.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await execute(
      "UPDATE outbox SET next_attempt_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND channel = 'push'",
      [user.id],
    );
    await outbox.drain();
  }

  const rows = await outboxFor(user.id, 'push');
  assert.equal(rows[0]!.status, 'abandoned');
  assert.equal(rows[0]!.attempts, 5);
  assert.ok(rows[0]!.last_error, 'the reason it never arrived is still readable');
});

test('the outbox reports its own state', async () => {
  const user = await registerUser();
  await outbox.queue({
    channel: 'push',
    destination: 'token-for-status-check',
    userId: user.id,
    template: 'push.like',
    payload: { body: 'x' },
  });

  const status = await outbox.status();
  assert.ok(status.pending >= 1);
  assert.ok(['smtp', 'console'].includes(status.transport));
});

// ── Quiet hours ──

test('quiet hours suppress the interruption, not the record', async () => {
  const recipient = await registerUser();
  const actor = await registerUser();

  await notifications.registerDevice(recipient.id, {
    deviceId: `quiet-device-${recipient.id}`,
    platform: 'ios',
    pushToken: `quiet-token-${recipient.id}`,
  });

  // A window covering the whole day, so the test does not depend on the clock.
  await notifications.setQuietHours(recipient.id, 0, 23);

  const result = await notifications.notify({
    userId: recipient.id,
    actorId: actor.id,
    kind: 'follow',
    body: 'Someone followed you',
  });

  assert.equal(result.inApp, true, 'the notification is still recorded');
  assert.equal(result.push, false, 'but nothing lights up a phone');

  const inApp = await query<{ c: number }>(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?',
    [recipient.id],
  );
  assert.equal(Number(inApp[0]?.c), 1);
});

// ── Reading ──

test('the inbox reads, counts and marks read', async () => {
  const recipient = await registerUser();
  const actor = await registerUser();

  await notifications.notify({
    userId: recipient.id,
    actorId: actor.id,
    kind: 'follow',
    body: 'Someone followed you',
  });

  const list = await api<{ id: string; read: boolean; actor?: { username: string } }[]>(
    'GET', '/api/v1/me/notifications', undefined, recipient.token,
  );
  assert.equal(list.status, 200, JSON.stringify(list.body.error));
  assert.equal(list.body.data!.length, 1);
  assert.equal(list.body.data![0]!.read, false);
  assert.ok(list.body.data![0]!.actor, 'the actor travels with it');

  const count = await api<{ unread: number }>(
    'GET', '/api/v1/me/notifications/count', undefined, recipient.token,
  );
  assert.equal(count.body.data!.unread, 1);

  const marked = await api<{ read: number; unread: number }>(
    'POST', '/api/v1/me/notifications/read', {}, recipient.token,
  );
  assert.equal(marked.body.data!.read, 1);
  assert.equal(marked.body.data!.unread, 0);
});

test('you cannot read another account notifications', async () => {
  const recipient = await registerUser();
  const actor = await registerUser();
  const nosy = await registerUser();

  await notifications.notify({
    userId: recipient.id,
    actorId: actor.id,
    kind: 'follow',
    body: 'Someone followed you',
  });

  const theirs = await api<unknown[]>(
    'GET', '/api/v1/me/notifications', undefined, nosy.token,
  );
  assert.equal(theirs.body.data!.length, 0, 'the inbox is scoped to the caller');
});

// ── Devices ──

test('registering a device twice updates the token in place', async () => {
  const user = await registerUser();
  const deviceId = `device-${user.id}`;

  await api('POST', '/api/v1/me/devices', {
    deviceId, platform: 'ios', pushToken: 'token-one-abcdef',
  }, user.token);
  await api('POST', '/api/v1/me/devices', {
    deviceId, platform: 'ios', pushToken: 'token-two-abcdef',
  }, user.token);

  const rows = await query<{ push_token: string }>(
    'SELECT push_token FROM user_devices WHERE user_id = ? AND device_id = ?',
    [user.id, deviceId],
  );
  assert.equal(rows.length, 1, 'one device, not two');
  assert.equal(rows[0]!.push_token, 'token-two-abcdef');
});

test('unregistering stops push but keeps the device', async () => {
  const user = await registerUser();
  const deviceId = `device-off-${user.id}`;

  await api('POST', '/api/v1/me/devices', {
    deviceId, platform: 'android', pushToken: 'token-abcdefgh',
  }, user.token);
  await api('DELETE', `/api/v1/me/devices/${deviceId}`, undefined, user.token);

  const rows = await query<{ push_token: string; deleted_at: Date | null }>(
    'SELECT push_token, deleted_at FROM user_devices WHERE user_id = ? AND device_id = ?',
    [user.id, deviceId],
  );
  assert.equal(rows[0]!.push_token, '');
  assert.equal(rows[0]!.deleted_at, null, 'the device is still recognised next sign-in');
});

test('a device with no token gets no push queued', async () => {
  const recipient = await registerUser();
  const actor = await registerUser();

  const result = await notifications.notify({
    userId: recipient.id,
    actorId: actor.id,
    kind: 'follow',
    body: 'Someone followed you',
  });

  assert.equal(result.inApp, true);
  assert.equal(result.push, false, 'nothing to send it to');
});

// ── Failure isolation ──

test('a notification failing never fails the action that caused it', async () => {
  const recipient = await registerUser();

  // A kind the database enum does not accept: the insert throws inside notify.
  const result = await notifications.notify({
    userId: recipient.id,
    kind: 'not_a_real_kind' as never,
    body: 'This cannot be stored',
  });

  // Swallowed and reported, never rethrown — a like must not fail because a
  // notification did.
  assert.equal(result.inApp, false);
  assert.equal(result.push, false);
  assert.equal(result.email, false);
});

// ── Staff surface ──

test('the outbox is staff-only', async () => {
  const user = await registerUser();

  const status = await api('GET', '/api/v1/admin/outbox', undefined, user.token);
  assert.equal(status.status, 403);

  const drain = await api('POST', '/api/v1/admin/outbox/drain', {}, user.token);
  assert.equal(drain.status, 403);
});
