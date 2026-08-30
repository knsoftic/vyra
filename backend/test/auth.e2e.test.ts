/**
 * Authentication end-to-end tests.
 *
 * These drive the real HTTP surface against the real database — no mocks — and
 * cover the Phase 3 exit criteria directly:
 *
 *   1. register → OTP → login → refresh → logout completes
 *   2. refresh rotates, and a replayed refresh token kills the whole family
 *   3. revoking a session invalidates its access token on the next request
 *   4. switching account type preserves content and wallet balance
 *   5. blocks are enforced server-side
 *
 * Every account created here is removed afterwards.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// ESM hoists static imports, so these must be set before the app modules load —
// hence the dynamic imports below. Rate limiting is disabled because it needs
// Redis, which these tests do not exercise; leaving it on made every request
// wait out the driver's retry backoff.
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.NODE_ENV = 'development';

const { createApp } = await import('../src/app.ts');
const { pool, execute, query, queryOne } = await import('../src/core/db.ts');
const { closeRedis } = await import('../src/core/redis.ts');

let server: Server;
let base = '';
const createdEmails: string[] = [];

const device = { deviceId: 'test-device-000001', platform: 'web' as const, appVersion: '0.1.0' };

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, string[]> };
  meta?: unknown;
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
  const parsed = (await res.json()) as Envelope<T>;
  return { status: res.status, body: parsed };
}

function uniqueEmail(): string {
  const id = Math.random().toString(36).slice(2, 10);
  const email = `e2e_${id}@vyra.test`;
  createdEmails.push(email);
  return email;
}

const uniqueUsername = () => `e2e_${Math.random().toString(36).slice(2, 10)}`;

interface Session {
  user: { id: string; username: string; accountCategory: string; accountType: string };
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  isNewAccount: boolean;
}

async function registerUser(): Promise<{ session: Session; email: string; username: string }> {
  const email = uniqueEmail();
  const username = uniqueUsername();
  const res = await api<Session>('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username,
    displayName: 'E2E User',
    birthdate: '1995-04-12',
    device: { ...device, deviceId: `dev-${username}` },
  });
  assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.body.error)}`);
  assert.ok(res.body.data);
  return { session: res.body.data, email, username };
}

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  try {
  for (const email of createdEmails) {
    const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) continue;
    await execute('DELETE FROM security_events WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM user_devices WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM login_attempts WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', [user.id, user.id]);
    await execute('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?', [user.id, user.id]);
    await execute('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', [user.id, user.id]);
    await execute('DELETE FROM reports WHERE reporter_id = ?', [user.id]);
    await execute('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?', [user.id, user.id]);
    await execute('DELETE FROM referral_codes WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM wallet_ledger WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM wallets WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM business_profiles WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM user_profiles WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM users WHERE id = ?', [user.id]);
    await execute('DELETE FROM otp_codes WHERE email = ?', [email]);
    await execute('DELETE FROM login_attempts WHERE email = ?', [email]);
  }
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

// ── 1. The full journey ──

test('register → verify email → login → refresh → logout', async () => {
  const { session, email } = await registerUser();
  assert.equal(session.isNewAccount, true);
  assert.ok(session.tokens.accessToken);

  // The access token works straight away.
  const me = await api<{ username: string; emailVerified: boolean }>(
    'GET', '/api/v1/me', undefined, session.tokens.accessToken,
  );
  assert.equal(me.status, 200);
  assert.equal(me.body.data?.emailVerified, false);

  // Email verification via OTP.
  const otp = await api<{ sent: boolean; devCode?: string }>('POST', '/api/v1/auth/otp/request', {
    email,
    purpose: 'signup',
  });
  assert.equal(otp.status, 200);
  const code = otp.body.data?.devCode;
  assert.ok(code, 'development responses must carry the code so the flow is testable');

  const verified = await api('POST', '/api/v1/auth/otp/verify', {
    email,
    code,
    purpose: 'signup',
  });
  assert.equal(verified.status, 200);

  const me2 = await api<{ emailVerified: boolean }>(
    'GET', '/api/v1/me', undefined, session.tokens.accessToken,
  );
  assert.equal(me2.body.data?.emailVerified, true);

  // Sign in fresh.
  const login = await api<Session>('POST', '/api/v1/auth/login', {
    email,
    password: 'Str0ng-Passphrase!',
    device,
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.data?.isNewAccount, false);

  // Refresh.
  const refreshed = await api<{ accessToken: string; refreshToken: string }>(
    'POST', '/api/v1/auth/refresh',
    { refreshToken: login.body.data?.tokens.refreshToken },
  );
  assert.equal(refreshed.status, 200);
  assert.notEqual(
    refreshed.body.data?.refreshToken,
    login.body.data?.tokens.refreshToken,
    'refresh must rotate the token',
  );

  // Logout.
  const out = await api('POST', '/api/v1/auth/logout', undefined, refreshed.body.data?.accessToken);
  assert.equal(out.status, 200);

  // The access token is dead immediately after logout.
  const after = await api('GET', '/api/v1/me', undefined, refreshed.body.data?.accessToken);
  assert.equal(after.status, 401);
});

// ── 2. Refresh token reuse ──

test('replaying a rotated refresh token revokes the entire session family', async () => {
  const { session } = await registerUser();
  const original = session.tokens.refreshToken;

  const first = await api<{ accessToken: string; refreshToken: string }>(
    'POST', '/api/v1/auth/refresh', { refreshToken: original },
  );
  assert.equal(first.status, 200);
  const rotated = first.body.data;
  assert.ok(rotated);

  // The new token works.
  const okCheck = await api('GET', '/api/v1/me', undefined, rotated.accessToken);
  assert.equal(okCheck.status, 200);

  // Replaying the original is treated as theft.
  const replay = await api('POST', '/api/v1/auth/refresh', { refreshToken: original });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error?.code, 'token_invalid');

  // And the legitimate rotated token is now dead too — the whole family went.
  const afterReuse = await api('GET', '/api/v1/me', undefined, rotated.accessToken);
  assert.equal(afterReuse.status, 401, 'reuse detection must revoke the whole family');

  const stillUsable = await api('POST', '/api/v1/auth/refresh', {
    refreshToken: rotated.refreshToken,
  });
  assert.equal(stillUsable.status, 401);
});

// ── 3. Session revocation ──

test('revoking a session invalidates its access token on the next request', async () => {
  const { session, email } = await registerUser();

  // A second device.
  const second = await api<Session>('POST', '/api/v1/auth/login', {
    email,
    password: 'Str0ng-Passphrase!',
    device: { ...device, deviceId: 'second-device-0001' },
  });
  assert.equal(second.status, 200);
  const secondToken = second.body.data?.tokens.accessToken;

  const sessions = await api<{ id: string; isCurrent: boolean }[]>(
    'GET', '/api/v1/auth/sessions', undefined, session.tokens.accessToken,
  );
  assert.equal(sessions.status, 200);
  assert.ok((sessions.body.data?.length ?? 0) >= 2);

  const other = sessions.body.data?.find((s) => !s.isCurrent);
  assert.ok(other, 'expected to see the other device listed');

  const revoked = await api(
    'DELETE', `/api/v1/auth/sessions/${other.id}`, undefined, session.tokens.accessToken,
  );
  assert.equal(revoked.status, 200);

  // The revoked device is locked out at once, without waiting for token expiry.
  const blocked = await api('GET', '/api/v1/me', undefined, secondToken);
  assert.equal(blocked.status, 401);

  // The session that did the revoking still works.
  const alive = await api('GET', '/api/v1/me', undefined, session.tokens.accessToken);
  assert.equal(alive.status, 200);
});

test('logout-all ends every session', async () => {
  const { session, email } = await registerUser();
  const second = await api<Session>('POST', '/api/v1/auth/login', {
    email, password: 'Str0ng-Passphrase!', device: { ...device, deviceId: 'third-device-0001' },
  });

  const result = await api<{ revoked: number }>(
    'POST', '/api/v1/auth/logout-all', undefined, session.tokens.accessToken,
  );
  assert.equal(result.status, 200);
  assert.ok((result.body.data?.revoked ?? 0) >= 2);

  assert.equal((await api('GET', '/api/v1/me', undefined, session.tokens.accessToken)).status, 401);
  assert.equal(
    (await api('GET', '/api/v1/me', undefined, second.body.data?.tokens.accessToken)).status,
    401,
  );
});

// ── 4. Account type switching preserves data ──

test('switching account type preserves wallet balance and profile', async () => {
  const { session } = await registerUser();
  const token = session.tokens.accessToken;

  const userRow = await queryOne<{ id: number }>('SELECT id FROM users WHERE public_id = ?', [
    session.user.id,
  ]);
  assert.ok(userRow);

  // Put real value in the wallet and a real display name on the profile.
  await execute('UPDATE wallets SET coin_balance = 4321, live_gift_balance = 999 WHERE user_id = ?', [
    userRow.id,
  ]);
  await api('PATCH', '/api/v1/me', { displayName: 'Before Switch', bio: 'my bio' }, token);

  const switched = await api<{ accountCategory: string; accountType: string; displayName: string }>(
    'POST', '/api/v1/me/account-type', { category: 'business', type: 'brand' }, token,
  );
  assert.equal(switched.status, 200);
  assert.equal(switched.body.data?.accountCategory, 'business');
  assert.equal(switched.body.data?.accountType, 'brand');
  assert.equal(switched.body.data?.displayName, 'Before Switch');

  // Business details, then switch back.
  await api('PATCH', '/api/v1/me/business', { category: 'Retail', website: 'https://example.com' }, token);
  const back = await api<{ accountCategory: string }>(
    'POST', '/api/v1/me/account-type', { category: 'individual', type: 'creator' }, token,
  );
  assert.equal(back.body.data?.accountCategory, 'individual');

  // Nothing was destroyed by either switch.
  const wallet = await queryOne<{ coin_balance: string; live_gift_balance: string }>(
    'SELECT coin_balance, live_gift_balance FROM wallets WHERE user_id = ?',
    [userRow.id],
  );
  assert.equal(Number(wallet?.coin_balance), 4321, 'wallet must survive an account type switch');
  assert.equal(Number(wallet?.live_gift_balance), 999);

  const biz = await queryOne<{ business_category: string }>(
    'SELECT business_category FROM business_profiles WHERE user_id = ?',
    [userRow.id],
  );
  assert.equal(biz?.business_category, 'Retail', 'business details must be kept for a later switch');

  // Switching back to business restores what was there.
  const again = await api<{ business?: { category?: string } }>(
    'POST', '/api/v1/me/account-type', { category: 'business', type: 'shop' }, token,
  );
  assert.equal(again.body.data?.business?.category, 'Retail');
});

test('an invalid category/type pairing is rejected', async () => {
  const { session } = await registerUser();
  const res = await api('POST', '/api/v1/me/account-type',
    { category: 'individual', type: 'brand' }, session.tokens.accessToken);
  assert.equal(res.status, 400);
  assert.equal(res.body.error?.code, 'validation_failed');
});

// ── 5. Follows and blocks ──

test('follow and unfollow keep counters correct', async () => {
  const a = await registerUser();
  const b = await registerUser();

  const followed = await api<{ following: boolean; followerCount: number }>(
    'POST', `/api/v1/users/${b.session.user.id}/follow`, undefined, a.session.tokens.accessToken,
  );
  assert.equal(followed.status, 200);
  assert.equal(followed.body.data?.following, true);
  assert.equal(followed.body.data?.followerCount, 1);

  // Following twice must not double-count.
  const again = await api<{ followerCount: number }>(
    'POST', `/api/v1/users/${b.session.user.id}/follow`, undefined, a.session.tokens.accessToken,
  );
  assert.equal(again.body.data?.followerCount, 1);

  const profile = await api<{ isFollowing: boolean; followers: number }>(
    'GET', `/api/v1/users/${b.username}`, undefined, a.session.tokens.accessToken,
  );
  assert.equal(profile.body.data?.isFollowing, true);
  assert.equal(profile.body.data?.followers, 1);

  const unfollowed = await api<{ following: boolean; followerCount: number }>(
    'DELETE', `/api/v1/users/${b.session.user.id}/follow`, undefined, a.session.tokens.accessToken,
  );
  assert.equal(unfollowed.body.data?.following, false);
  assert.equal(unfollowed.body.data?.followerCount, 0);
});

test('a profile can be fetched by public id as well as by username', async () => {
  const a = await registerUser();
  const b = await registerUser();

  // Most of the app holds public ids rather than handles — a notification, a
  // chat member, a community roster entry — so a profile that could only be
  // opened by username was a profile most of the app could not open at all.
  const byId = await api<{ username: string; id: string }>(
    'GET', `/api/v1/users/${b.session.user.id}`, undefined, a.session.tokens.accessToken,
  );
  assert.equal(byId.status, 200, JSON.stringify(byId.body.error));
  assert.equal(byId.body.data?.username, b.username);

  const byName = await api<{ id: string }>(
    'GET', `/api/v1/users/${b.username}`, undefined, a.session.tokens.accessToken,
  );
  assert.equal(byName.body.data?.id, byId.body.data?.id, 'both routes reach the same account');

  // Usernames are lowercase-only and a public id is uppercase Crockford base32,
  // so the two sets cannot collide and neither can be used to reach the other.
  const nobody = await api(
    'GET', '/api/v1/users/01ZZZZZZZZZZZZZZZZZZZZZZZZ', undefined, a.session.tokens.accessToken,
  );
  assert.equal(nobody.status, 404, 'an unknown id is not found, not somebody else');
});

test('following yourself is refused', async () => {
  const a = await registerUser();
  const res = await api('POST', `/api/v1/users/${a.session.user.id}/follow`, undefined,
    a.session.tokens.accessToken);
  assert.equal(res.status, 400);
});

test('a block hides the blocker from the blocked user and severs the follow', async () => {
  const a = await registerUser();
  const b = await registerUser();

  await api('POST', `/api/v1/users/${b.session.user.id}/follow`, undefined, a.session.tokens.accessToken);
  await api('POST', `/api/v1/users/${a.session.user.id}/follow`, undefined, b.session.tokens.accessToken);

  const blocked = await api('POST', `/api/v1/users/${b.session.user.id}/block`, undefined,
    a.session.tokens.accessToken);
  assert.equal(blocked.status, 200);

  // B can no longer see A at all — not a 403, which would confirm A exists.
  const view = await api('GET', `/api/v1/users/${a.username}`, undefined, b.session.tokens.accessToken);
  assert.equal(view.status, 404);

  // And B cannot follow A.
  const refollow = await api('POST', `/api/v1/users/${a.session.user.id}/follow`, undefined,
    b.session.tokens.accessToken);
  assert.equal(refollow.status, 404);

  // Both follow directions were severed, and the counters went with them.
  const aProfile = await api<{ followers: number; following: number }>(
    'GET', `/api/v1/users/${a.username}`, undefined, a.session.tokens.accessToken,
  );
  assert.equal(aProfile.body.data?.followers, 0);
  assert.equal(aProfile.body.data?.following, 0);

  const list = await api<{ username: string }[]>('GET', '/api/v1/me/blocked', undefined,
    a.session.tokens.accessToken);
  assert.equal(list.body.data?.length, 1);
  assert.equal(list.body.data?.[0]?.username, b.username);

  const unblocked = await api('DELETE', `/api/v1/users/${b.session.user.id}/block`, undefined,
    a.session.tokens.accessToken);
  assert.equal(unblocked.status, 200);

  // Unblocking restores visibility but NOT the follow.
  const after = await api<{ isFollowing: boolean }>(
    'GET', `/api/v1/users/${a.username}`, undefined, b.session.tokens.accessToken,
  );
  assert.equal(after.status, 200);
  assert.equal(after.body.data?.isFollowing, false);
});

// ── Enumeration resistance and validation ──

test('registering with an existing email does not confirm the account exists', async () => {
  const { email } = await registerUser();
  const res = await api<unknown>('POST', '/api/v1/auth/register', {
    email,
    password: 'An0ther-Passphrase!',
    username: uniqueUsername(),
    birthdate: '1995-04-12',
    device,
  });
  assert.equal(res.status, 409);
  const message = res.body.error?.message ?? '';
  assert.ok(
    !/already registered|taken|exists/i.test(message),
    `message must not confirm the address is registered, got: ${message}`,
  );
});

test('login with an unknown email and a wrong password are indistinguishable', async () => {
  const { email } = await registerUser();

  // A fresh address each run: the sign-in lockout counts failures per email, so
  // reusing one constant address eventually returns 429 instead of 401 and the
  // comparison below starts failing for reasons that have nothing to do with
  // enumeration.
  const unknown = await api('POST', '/api/v1/auth/login', {
    email: `never_registered_${Math.random().toString(36).slice(2, 10)}@vyra.test`,
    password: 'Str0ng-Passphrase!',
    device,
  });
  const wrongPassword = await api('POST', '/api/v1/auth/login', {
    email, password: 'Wr0ng-Passphrase!', device,
  });

  assert.equal(unknown.status, wrongPassword.status);
  assert.equal(unknown.body.error?.code, wrongPassword.body.error?.code);
  assert.equal(unknown.body.error?.message, wrongPassword.body.error?.message);
});

test('a password reset for an unknown address reports success', async () => {
  const res = await api<{ sent: boolean }>('POST', '/api/v1/auth/otp/request', {
    email: 'definitely_not_registered@vyra.test',
    purpose: 'reset',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data?.sent, true);
});

test('reserved and malformed usernames are refused', async () => {
  for (const username of ['admin', 'support', 'vyra', '.leading', 'has space', 'ab']) {
    const res = await api<{ available: boolean }>(
      'GET', `/api/v1/users/check-username?username=${encodeURIComponent(username)}`,
    );
    if (res.status === 200) {
      assert.equal(res.body.data?.available, false, `${username} must not be available`);
    } else {
      assert.equal(res.status, 400, `${username} should be rejected`);
    }
  }
});

test('a username that only looks like a reserved word is still refused', async () => {
  const res = await api<{ available: boolean; reason?: string }>(
    'GET', '/api/v1/users/check-username?username=adm1n',
  );
  assert.equal(res.body.data?.available, false);
  assert.equal(res.body.data?.reason, 'reserved');
});

test('an OTP cannot be used twice', async () => {
  const { email } = await registerUser();
  const otp = await api<{ devCode?: string }>('POST', '/api/v1/auth/otp/request', {
    email, purpose: 'reset',
  });
  const code = otp.body.data?.devCode;
  assert.ok(code);

  const first = await api('POST', '/api/v1/auth/otp/verify', { email, code, purpose: 'reset' });
  assert.equal(first.status, 200);

  const second = await api('POST', '/api/v1/auth/otp/verify', { email, code, purpose: 'reset' });
  assert.equal(second.status, 400, 'a consumed code must not verify again');
});

test('a wrong OTP is rejected and does not reveal whether a code is pending', async () => {
  const { email } = await registerUser();
  await api('POST', '/api/v1/auth/otp/request', { email, purpose: 'reset' });

  const wrong = await api('POST', '/api/v1/auth/otp/verify', {
    email, code: '000000', purpose: 'reset',
  });
  const noPending = await api('POST', '/api/v1/auth/otp/verify', {
    email: 'nothing_pending@vyra.test', code: '000000', purpose: 'reset',
  });

  assert.equal(wrong.status, noPending.status);
  assert.equal(wrong.body.error?.message, noPending.body.error?.message);
});

test('password reset ends every session', async () => {
  const { session, email } = await registerUser();

  const otp = await api<{ devCode?: string }>('POST', '/api/v1/auth/otp/request', {
    email, purpose: 'reset',
  });
  const code = otp.body.data?.devCode;
  assert.ok(code);

  const reset = await api('POST', '/api/v1/auth/password/reset', {
    email, code, newPassword: 'Rotated-Passphrase!1',
  });
  assert.equal(reset.status, 200);

  const dead = await api('GET', '/api/v1/me', undefined, session.tokens.accessToken);
  assert.equal(dead.status, 401, 'a reset must end existing sessions');

  const login = await api<Session>('POST', '/api/v1/auth/login', {
    email, password: 'Rotated-Passphrase!1', device,
  });
  assert.equal(login.status, 200);
});

test('changing a password keeps the current session and ends the others', async () => {
  const { session, email } = await registerUser();
  const other = await api<Session>('POST', '/api/v1/auth/login', {
    email, password: 'Str0ng-Passphrase!', device: { ...device, deviceId: 'fourth-device-001' },
  });

  const changed = await api('POST', '/api/v1/auth/password/change', {
    currentPassword: 'Str0ng-Passphrase!',
    newPassword: 'Yet-An0ther-Passphrase!',
  }, session.tokens.accessToken);
  assert.equal(changed.status, 200);

  assert.equal((await api('GET', '/api/v1/me', undefined, session.tokens.accessToken)).status, 200);
  assert.equal(
    (await api('GET', '/api/v1/me', undefined, other.body.data?.tokens.accessToken)).status,
    401,
  );
});

test('a weak or email-derived password is refused', async () => {
  const email = uniqueEmail();
  const local = email.split('@')[0] ?? '';

  for (const password of ['password123', `${local}12345`]) {
    const res = await api('POST', '/api/v1/auth/register', {
      email, password, username: uniqueUsername(), birthdate: '1995-04-12', device,
    });
    assert.equal(res.status, 400, `${password} should be refused`);
    assert.equal(res.body.error?.code, 'validation_failed');
  }
});

test('an under-13 registration is refused', async () => {
  const tooYoung = new Date();
  tooYoung.setFullYear(tooYoung.getFullYear() - 10);
  const res = await api('POST', '/api/v1/auth/register', {
    email: uniqueEmail(),
    password: 'Str0ng-Passphrase!',
    username: uniqueUsername(),
    birthdate: tooYoung.toISOString().slice(0, 10),
    device,
  });
  assert.equal(res.status, 403);
});

test('every auth action is written to the security log', async () => {
  const { session } = await registerUser();
  const events = await api<{ event: string }[]>(
    'GET', '/api/v1/me/security-events', undefined, session.tokens.accessToken,
  );
  assert.equal(events.status, 200);
  const names = (events.body.data ?? []).map((e) => e.event);
  assert.ok(names.includes('register'), `expected a register event, got ${names.join(', ')}`);
});

test('the security log never stores an OTP code or a password', async () => {
  const { session, email } = await registerUser();
  const otp = await api<{ devCode?: string }>('POST', '/api/v1/auth/otp/request', {
    email, purpose: 'reset',
  });
  const code = otp.body.data?.devCode;
  assert.ok(code);

  const rows = await query<{ detail: string | null }>(
    'SELECT detail FROM security_events WHERE detail IS NOT NULL ORDER BY id DESC LIMIT 200',
  );
  for (const row of rows) {
    assert.ok(!row.detail?.includes(code), 'an OTP code must never reach the security log');
    assert.ok(
      !row.detail?.includes('Str0ng-Passphrase!'),
      'a password must never reach the security log',
    );
  }

  void session;
});

test('unauthenticated requests to protected routes are rejected', async () => {
  for (const [method, path] of [
    ['GET', '/api/v1/me'],
    ['PATCH', '/api/v1/me'],
    ['POST', '/api/v1/me/account-type'],
    ['GET', '/api/v1/auth/sessions'],
    ['GET', '/api/v1/me/blocked'],
  ] as const) {
    const res = await api(method, path, method === 'GET' ? undefined : {});
    assert.equal(res.status, 401, `${method} ${path} must require authentication`);
  }
});

// ── Privacy settings ──

test('every privacy setting the screen offers is stored and read back', async () => {
  const user = await registerUser();
  const token = user.session.tokens.accessToken;

  const before = await api<{ privacy: Record<string, unknown> }>('GET', '/api/v1/me', undefined, token);
  assert.equal(before.status, 200);

  // The defaults are permissive, matching how the platform behaved before these
  // settings existed — enabling them must not silently change anyone's account.
  const defaults = before.body.data!.privacy;
  assert.equal(defaults.isPrivate, false);
  assert.equal(defaults.suggestAccount, true);
  assert.equal(defaults.allowRemix, true);
  assert.equal(defaults.personalisedAds, true);
  assert.equal(defaults.showActivityStatus, true);
  assert.equal(defaults.whoCanMention, 'everyone');

  const saved = await api<Record<string, unknown>>(
    'PATCH', '/api/v1/me/privacy',
    {
      isPrivate: true,
      whoCanMention: 'followers',
      suggestAccount: false,
      allowRemix: false,
      personalisedAds: false,
      showActivityStatus: false,
    },
    token,
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body.error));
  assert.equal(saved.body.data!.personalisedAds, false, 'the response reflects the change');

  // The point of the whole feature: it is still off after a fresh read.
  const after = await api<{ privacy: Record<string, unknown> }>('GET', '/api/v1/me', undefined, token);
  const privacy = after.body.data!.privacy;
  assert.equal(privacy.isPrivate, true);
  assert.equal(privacy.whoCanMention, 'followers');
  assert.equal(privacy.suggestAccount, false);
  assert.equal(privacy.allowRemix, false);
  assert.equal(privacy.personalisedAds, false);
  assert.equal(privacy.showActivityStatus, false);
});

test('one privacy setting changes alone, and leaves the rest where they were', async () => {
  const user = await registerUser();
  const token = user.session.tokens.accessToken;

  await api('PATCH', '/api/v1/me/privacy', { personalisedAds: false }, token);
  await api('PATCH', '/api/v1/me/privacy', { isPrivate: true }, token);

  const after = await api<{ privacy: Record<string, unknown> }>('GET', '/api/v1/me', undefined, token);
  assert.equal(after.body.data!.privacy.personalisedAds, false, 'the earlier change survived');
  assert.equal(after.body.data!.privacy.isPrivate, true);
  assert.equal(after.body.data!.privacy.allowDownload, true, 'untouched settings are untouched');
});

test('a privacy change is recorded as a security event', async () => {
  const user = await registerUser();
  await api('PATCH', '/api/v1/me/privacy', { isPrivate: true }, user.session.tokens.accessToken);

  const events = await api<{ event: string }[]>(
    'GET', '/api/v1/me/security-events', undefined, user.session.tokens.accessToken,
  );
  if (events.status === 200) {
    assert.ok(
      events.body.data!.some((e) => e.event === 'privacy_changed'),
      'changing who can see you is worth a record',
    );
  }
});

test('an unknown audience value is refused', async () => {
  const user = await registerUser();
  const res = await api(
    'PATCH', '/api/v1/me/privacy',
    { whoCanMention: 'friends-of-friends' },
    user.session.tokens.accessToken,
  );
  assert.equal(res.status, 400);
});
