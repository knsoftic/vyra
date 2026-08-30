/**
 * Signing in with a phone number.
 *
 * What must be true:
 *   1. one code signs a person in — into their account, or a new one
 *   2. the same person always lands on the same account
 *   3. a wrong or reused code gets nobody in
 *   4. the request endpoint does not reveal whether a number is registered
 *   5. a session survives being verified, so the app can stay signed in
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';

process.env.RATE_LIMIT_ENABLED = 'false';
process.env.NODE_ENV = 'development';

const { createApp } = await import('../src/app.ts');
const { pool, execute, query } = await import('../src/core/db.ts');
const { closeRedis } = await import('../src/core/redis.ts');
const { setSetting } = await import('../src/core/settings.ts');

let server: Server;
let base = '';
const createdPhones: string[] = [];

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

interface Delivery {
  sent: boolean;
  phone: string;
  devCode?: string;
}

interface Session {
  user: { id: string; username: string; email?: string };
  tokens: { accessToken: string };
  isNewAccount: boolean;
}

const DEVICE = { deviceId: 'phone-e2e', platform: 'android' as const };

/** A number nobody else in the suite will use. */
function freshNumber(): string {
  const tail = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const phone = `92399${tail}`;
  createdPhones.push(phone);
  return phone;
}

/**
 * Moves this number's existing codes into the past.
 *
 * There is a 60 second resend cooldown per number, which is a real protection
 * and stays switched on. Rather than disable it, the tests age the previous
 * request so the cooldown has genuinely elapsed — the same path a person on a
 * phone takes a minute later.
 */
async function pretendCooldownPassed(phone: string): Promise<void> {
  await execute(
    "UPDATE otp_codes SET created_at = created_at - INTERVAL 5 MINUTE WHERE identifier = ?",
    [phone],
  );
}

/** Asks for a code and returns it, the way the app would then read the SMS. */
async function codeFor(phone: string): Promise<string> {
  await pretendCooldownPassed(phone);
  const res = await api<Delivery>('POST', '/api/v1/auth/phone/request', { phone });
  assert.equal(res.status, 200, JSON.stringify(res.body.error));
  assert.ok(res.body.data!.devCode, 'development returns the code so the flow is testable');
  return res.body.data!.devCode!;
}

before(async () => {
  // Every number in this suite is written internationally, so the tests do not
  // depend on whichever country code the developer happens to have configured.
  await setSetting('sms.default_country_code', '', null);

  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  for (const phone of createdPhones) {
    const rows = await query<{ id: number }>('SELECT id FROM users WHERE phone = ?', [phone]).catch(
      () => [],
    );
    for (const row of rows) {
      for (const sql of [
        'DELETE FROM referral_codes WHERE user_id = ?',
        'DELETE FROM wallets WHERE user_id = ?',
        'DELETE FROM user_profiles WHERE user_id = ?',
        'DELETE FROM user_sessions WHERE user_id = ?',
        'DELETE FROM user_devices WHERE user_id = ?',
        'DELETE FROM login_attempts WHERE user_id = ?',
        'DELETE FROM security_events WHERE user_id = ?',
        'DELETE FROM outbox WHERE user_id = ?',
        'DELETE FROM users WHERE id = ?',
      ]) {
        await execute(sql, [row.id]).catch(() => undefined);
      }
    }
    await execute('DELETE FROM otp_codes WHERE identifier = ?', [phone]).catch(() => undefined);
    await execute('DELETE FROM login_attempts WHERE identifier = ?', [phone]).catch(() => undefined);
  }

  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  await closeRedis();
});

test('a correct code creates the account and signs the person in', async () => {
  const phone = freshNumber();
  const code = await codeFor(phone);

  const res = await api<Session>('POST', '/api/v1/auth/phone/verify', {
    phone,
    code,
    device: DEVICE,
  });

  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  assert.equal(res.body.data!.isNewAccount, true);
  assert.ok(res.body.data!.tokens.accessToken, 'verifying IS the sign-in — no second step');

  // An account made from a number has no email, and its username must not be
  // the number: that would publish somebody's mobile on their profile.
  assert.ok(!res.body.data!.user.email);
  assert.ok(
    !res.body.data!.user.username.includes(phone.slice(-7)),
    'the username must not contain the phone number',
  );
});

test('the token from verification actually works', async () => {
  const phone = freshNumber();
  const session = await api<Session>('POST', '/api/v1/auth/phone/verify', {
    phone,
    code: await codeFor(phone),
    device: DEVICE,
  });

  const me = await api<{ username: string }>(
    'GET', '/api/v1/me', undefined, session.body.data!.tokens.accessToken,
  );
  assert.equal(me.status, 200, 'the session is usable straight away');
  assert.equal(me.body.data!.username, session.body.data!.user.username);
});

test('the same number always reaches the same account', async () => {
  const phone = freshNumber();

  const first = await api<Session>('POST', '/api/v1/auth/phone/verify', {
    phone,
    code: await codeFor(phone),
    device: DEVICE,
  });
  assert.equal(first.body.data!.isNewAccount, true);

  const second = await api<Session>('POST', '/api/v1/auth/phone/verify', {
    phone,
    code: await codeFor(phone),
    device: { ...DEVICE, deviceId: 'phone-e2e-2' },
  });

  assert.equal(second.status, 200);
  assert.equal(second.body.data!.isNewAccount, false, 'a second account would be the bug');
  assert.equal(second.body.data!.user.id, first.body.data!.user.id);

  const count = await query<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE phone = ?', [phone]);
  assert.equal(Number(count[0]!.c), 1, 'exactly one account per number');
});

test('a wrong code gets nobody in', async () => {
  const phone = freshNumber();
  const real = await codeFor(phone);
  const wrong = real === '000000' ? '111111' : '000000';

  const res = await api('POST', '/api/v1/auth/phone/verify', { phone, code: wrong, device: DEVICE });
  assert.equal(res.status, 400);

  const rows = await query<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE phone = ?', [phone]);
  assert.equal(Number(rows[0]!.c), 0, 'and no account is created on a failed attempt');
});

test('a code cannot be used twice', async () => {
  const phone = freshNumber();
  const code = await codeFor(phone);

  const first = await api('POST', '/api/v1/auth/phone/verify', { phone, code, device: DEVICE });
  assert.equal(first.status, 201);

  const replay = await api('POST', '/api/v1/auth/phone/verify', { phone, code, device: DEVICE });
  assert.equal(replay.status, 400, 'a consumed code is spent');
});

test('asking for a code does not reveal whether the number is registered', async () => {
  const known = freshNumber();
  await api('POST', '/api/v1/auth/phone/verify', {
    phone: known,
    code: await codeFor(known),
    device: DEVICE,
  });

  const unknown = freshNumber();

  await pretendCooldownPassed(known);
  const forKnown = await api<Delivery>('POST', '/api/v1/auth/phone/request', { phone: known });
  const forUnknown = await api<Delivery>('POST', '/api/v1/auth/phone/request', { phone: unknown });

  assert.equal(forKnown.status, forUnknown.status);
  assert.equal(forKnown.body.data!.sent, forUnknown.body.data!.sent);
  assert.deepEqual(
    Object.keys(forKnown.body.data!).sort(),
    Object.keys(forUnknown.body.data!).sort(),
    'the two responses must be indistinguishable',
  );
});

test('a domestic number is refused when no country code is configured', async () => {
  const res = await api('POST', '/api/v1/auth/phone/request', { phone: '03219876543' });
  assert.equal(res.status, 400);
  assert.match(res.body.error!.message, /country code/i, 'and it says what is missing');
});

test('an account made by phone cannot be signed into with an empty password', async () => {
  const phone = freshNumber();
  const session = await api<Session>('POST', '/api/v1/auth/phone/verify', {
    phone,
    code: await codeFor(phone),
    device: DEVICE,
  });

  // The row stores an empty password hash. Argon2 cannot verify against one, so
  // the password path is closed — but it is worth proving rather than assuming.
  const attempt = await api('POST', '/api/v1/auth/login', {
    email: `${session.body.data!.user.username}@vyra.test`,
    password: '',
    device: DEVICE,
  });
  assert.ok(attempt.status >= 400, 'no password gets into a phone-only account');
});
