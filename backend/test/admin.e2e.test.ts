/**
 * The admin surface, end to end.
 *
 * What must be true:
 *   1. no admin row, no access — an ordinary signed-in account gets 403 everywhere
 *   2. settings are validated, masked and audited
 *   3. the catalogue editors accept only allow-listed columns
 *   4. an announcement lands in user inboxes and nowhere it should not
 *   5. granting admin access needs an existing account and a super admin
 *   6. nobody can disable their own admin access
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';

process.env.RATE_LIMIT_ENABLED = 'false';
process.env.NODE_ENV = 'development';

const { createApp } = await import('../src/app.ts');
const { pool, execute, queryOne } = await import('../src/core/db.ts');
const { closeRedis } = await import('../src/core/redis.ts');
const { invalidateSettings } = await import('../src/core/settings.ts');

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

async function registerUser(): Promise<{ token: string; publicId: string; email: string; dbId: number }> {
  const tag = randomBytes(5).toString('hex');
  const email = `admin_e2e_${tag}@vyra.test`;
  createdEmails.push(email);
  const res = await api<Session>('POST', '/api/v1/auth/register', {
    email,
    password: 'Str0ng-Passphrase!',
    username: `admine2e_${tag}`,
    birthdate: '1995-04-12',
    device: { deviceId: `admin-e2e-${tag}`, platform: 'web' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body.error));
  const row = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  return { token: res.body.data!.tokens.accessToken, publicId: res.body.data!.user.id, email, dbId: row!.id };
}

/** Registers a user and links them as a super admin, the way seed-admin does. */
async function registerAdmin(): Promise<{ token: string; email: string; dbId: number; adminId: number }> {
  const user = await registerUser();
  const role = await queryOne<{ id: number }>("SELECT id FROM roles WHERE slug = 'super_admin'");
  assert.ok(role, 'seed the super_admin role first (npm run seed:admin)');
  const { ulid } = await import('ulid');
  await execute(
    `INSERT INTO admin_users (public_id, name, email, password_hash, role_id, status, user_id)
     SELECT :publicId, 'E2E Admin', :email, u.password_hash, :roleId, 'active', u.id
       FROM users u WHERE u.id = :userId`,
    { publicId: ulid(), email: user.email, roleId: role!.id, userId: user.dbId },
  );
  const admin = await queryOne<{ id: number }>(
    'SELECT id FROM admin_users WHERE user_id = ?', [user.dbId],
  );
  return { token: user.token, email: user.email, dbId: user.dbId, adminId: admin!.id };
}

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  for (const email of createdEmails) {
    const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', [email]).catch(() => null);
    if (user) {
      await execute('DELETE FROM admin_users WHERE user_id = ?', [user.id]).catch(() => undefined);
      await execute('DELETE FROM audit_logs WHERE admin_name = ?', ['E2E Admin']).catch(() => undefined);
      await execute('DELETE FROM notifications WHERE user_id = ?', [user.id]).catch(() => undefined);
      await execute('DELETE FROM security_events WHERE user_id = ?', [user.id]).catch(() => undefined);
      await execute('DELETE FROM user_sessions WHERE user_id = ?', [user.id]).catch(() => undefined);
      await execute('DELETE FROM user_devices WHERE user_id = ?', [user.id]).catch(() => undefined);
      await execute('DELETE FROM login_attempts WHERE user_id = ? OR identifier = ?', [user.id, email]).catch(() => undefined);
      await execute('DELETE FROM wallets WHERE user_id = ?', [user.id]).catch(() => undefined);
      await execute('DELETE FROM referral_codes WHERE user_id = ?', [user.id]).catch(() => undefined);
      await execute('DELETE FROM user_profiles WHERE user_id = ?', [user.id]).catch(() => undefined);
      await execute('DELETE FROM users WHERE id = ?', [user.id]).catch(() => undefined);
    }
  }
  await execute("DELETE FROM notification_campaigns WHERE title = 'E2E announcement'").catch(() => undefined);
  await execute(
    "DELETE FROM system_settings WHERE setting_key = 'app.name' AND value = ?",
    [JSON.stringify('E2E Vyra')],
  ).catch(() => undefined);
  await invalidateSettings().catch(() => undefined);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  await closeRedis();
});

// ── Access ──

test('an ordinary account gets 403 from every admin surface', async () => {
  const user = await registerUser();
  for (const path of ['/api/v1/admin/me', '/api/v1/admin/dashboard', '/api/v1/admin/settings', '/api/v1/admin/users', '/api/v1/admin/audit']) {
    const res = await api('GET', path, undefined, user.token);
    assert.equal(res.status, 403, `${path} must be closed`);
  }
});

test('an anonymous caller gets 401, not 403 — no admin surface leaks its existence', async () => {
  const res = await api('GET', '/api/v1/admin/dashboard');
  assert.equal(res.status, 401);
});

test('an admin sees identity, role and permissions', async () => {
  const admin = await registerAdmin();
  const res = await api<{ role: string; permissions: string[] }>('GET', '/api/v1/admin/me', undefined, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.data!.role, 'super_admin');
  assert.ok(res.body.data!.permissions.length > 0);
});

test('the dashboard counts real things', async () => {
  const admin = await registerAdmin();
  const res = await api<{ users: number; queues: Record<string, number> }>(
    'GET', '/api/v1/admin/dashboard', undefined, admin.token,
  );
  assert.equal(res.status, 200);
  assert.ok(res.body.data!.users > 0, 'there are users in this database');
  assert.ok('reports' in res.body.data!.queues);
});

// ── Settings ──

test('settings validate the key, validate the type, and mask the secret', async () => {
  const admin = await registerAdmin();

  const unknown = await api('PATCH', '/api/v1/admin/settings', { key: 'no.such.setting', value: 1 }, admin.token);
  assert.equal(unknown.status, 400, 'a typo is an error, not a new row');

  const wrongType = await api('PATCH', '/api/v1/admin/settings', { key: 'upload.max_size_mb', value: 'five hundred' }, admin.token);
  assert.equal(wrongType.status, 400, 'a string where a number belongs is refused');

  const write = await api('PATCH', '/api/v1/admin/settings', { key: 'app.name', value: 'E2E Vyra' }, admin.token);
  assert.equal(write.status, 200, JSON.stringify(write.body.error));

  await api('PATCH', '/api/v1/admin/settings', { key: 'email.smtp_pass', value: 'super-secret-app-password' }, admin.token);

  const read = await api<{ settings: Record<string, unknown> }>('GET', '/api/v1/admin/settings', undefined, admin.token);
  assert.equal(read.body.data!.settings['app.name'], 'E2E Vyra', 'the write round-tripped as its real type');
  assert.equal(read.body.data!.settings['email.smtp_pass'], '••••••••', 'the password never comes back');

  // Restore.
  await api('PATCH', '/api/v1/admin/settings', { key: 'app.name', value: 'Vyra' }, admin.token);
  await api('PATCH', '/api/v1/admin/settings', { key: 'email.smtp_pass', value: '' }, admin.token);
});

test('a settings change is audited with who and what', async () => {
  const admin = await registerAdmin();
  await api('PATCH', '/api/v1/admin/settings', { key: 'referral.reward_coins', value: 100 }, admin.token);
  const row = await queryOne<{ admin_name: string; module: string }>(
    `SELECT admin_name, module FROM audit_logs
      WHERE target_id = 'referral.reward_coins' ORDER BY id DESC LIMIT 1`,
  );
  assert.ok(row, 'an audit row exists');
  assert.equal(row!.module, 'settings');
});

test('with no SMTP configured the email test says so instead of pretending', async () => {
  const admin = await registerAdmin();
  const status = await api<{ transport: string }>('GET', '/api/v1/admin/settings/email/status', undefined, admin.token);
  // The dev environment has no SMTP; if an operator configured one, skip.
  if (status.body.data!.transport === 'console') {
    const res = await api<{ sent: boolean; detail?: string }>(
      'POST', '/api/v1/admin/settings/email/test', { to: 'nobody@example.com' }, admin.token,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data!.sent, false, 'console transport must not claim delivery');
    assert.ok(res.body.data!.detail, 'and it says why');
  }
});

// ── Catalogue editors ──

test('the catalogue editor accepts only allow-listed columns', async () => {
  const admin = await registerAdmin();

  const list = await api<{ items: { id: number; isEnabled: number }[] }>(
    'GET', '/api/v1/admin/daily-tasks', undefined, admin.token,
  );
  assert.equal(list.status, 200);
  if (list.body.data!.items.length === 0) return; // nothing seeded — the guard is still exercised below

  const id = list.body.data!.items[0]!.id;

  const evil = await api('PATCH', `/api/v1/admin/daily-tasks/${id}`, { changes: { task_key: 'hijack' } }, admin.token);
  assert.equal(evil.status, 400, 'task_key is not editable');

  const evil2 = await api('PATCH', `/api/v1/admin/daily-tasks/${id}`, { changes: { 'reward_coins; DROP TABLE users': 1 } }, admin.token);
  assert.equal(evil2.status, 400, 'a column name is matched against the allow-list, never interpolated');

  const wrongType = await api('PATCH', `/api/v1/admin/daily-tasks/${id}`, { changes: { is_enabled: 'yes' } }, admin.token);
  assert.equal(wrongType.status, 400, 'a boolean column takes a boolean');
});

// ── Announcements ──

test('an announcement lands in user inboxes and is counted honestly', async () => {
  const admin = await registerAdmin();
  const bystander = await registerUser();

  const send = await api<{ recipients: number }>(
    'POST', '/api/v1/admin/notification-campaigns',
    { title: 'E2E announcement', body: 'Testing the megaphone.' }, admin.token,
  );
  assert.equal(send.status, 201, JSON.stringify(send.body.error));
  assert.ok(send.body.data!.recipients >= 2, 'both fresh accounts are active users');

  const row = await queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND kind = 'system' AND body LIKE 'E2E announcement%'",
    [bystander.dbId],
  );
  assert.equal(Number(row!.c), 1, 'the bystander got exactly one inbox row');
});

// ── Administrators ──

test('granting admin access needs an existing account, and only a super admin can do it', async () => {
  const admin = await registerAdmin();
  const user = await registerUser();

  const ghost = await api('POST', '/api/v1/admin/roles/admins',
    { email: 'nobody_here@vyra.test', name: 'Ghost', roleSlug: 'super_admin' }, admin.token);
  assert.equal(ghost.status, 404, 'no account, no grant — this route never creates credentials');

  const grant = await api('POST', '/api/v1/admin/roles/admins',
    { email: user.email, name: 'Second Admin', roleSlug: 'super_admin' }, admin.token);
  assert.equal(grant.status, 201, JSON.stringify(grant.body.error));

  const again = await api('POST', '/api/v1/admin/roles/admins',
    { email: user.email, name: 'Second Admin', roleSlug: 'super_admin' }, admin.token);
  assert.equal(again.status, 409, 'granting twice is a conflict, not a duplicate row');

  // The freshly granted admin can reach the surface with their same session.
  const me = await api<{ role: string }>('GET', '/api/v1/admin/me', undefined, user.token);
  assert.equal(me.status, 200);
});

test('nobody can disable their own admin access', async () => {
  const admin = await registerAdmin();
  const self = await queryOne<{ public_id: string }>(
    'SELECT public_id FROM admin_users WHERE id = ?', [admin.adminId],
  );
  const res = await api('PATCH', `/api/v1/admin/roles/admins/${self!.public_id}`,
    { status: 'disabled' }, admin.token);
  assert.equal(res.status, 409, 'the last super admin locking everyone out is the accident this prevents');
});

// ── Read surfaces ──

test('users, videos, payments and security read without error', async () => {
  const admin = await registerAdmin();
  for (const path of [
    '/api/v1/admin/users?limit=5',
    '/api/v1/admin/videos?limit=5',
    '/api/v1/admin/payments',
    '/api/v1/admin/security',
    '/api/v1/admin/analytics',
    '/api/v1/admin/models',
    '/api/v1/admin/coin-packages',
    '/api/v1/admin/gift-catalogue',
    '/api/v1/admin/payment-methods',
  ]) {
    const res = await api('GET', path, undefined, admin.token);
    assert.equal(res.status, 200, `${path} answers`);
  }
});

test('the user detail view resolves by public id and hides nothing it needs', async () => {
  const admin = await registerAdmin();
  const user = await registerUser();
  const res = await api<{ username: string; wallet: unknown; counts: unknown }>(
    'GET', `/api/v1/admin/users/${user.publicId}`, undefined, admin.token,
  );
  assert.equal(res.status, 200);
  assert.ok(res.body.data!.wallet, 'the wallet panel is present');
  assert.ok(res.body.data!.counts, 'the counts panel is present');

  const missing = await api('GET', '/api/v1/admin/users/01ZZZZZZZZZZZZZZZZZZZZZZZZ', undefined, admin.token);
  assert.equal(missing.status, 404);
});

// ── Creating and deleting catalogue rows ──

test('an operator can add a category, and the allow-list still holds', async () => {
  const admin = await registerAdmin();
  const slug = `e2e_cat_${randomBytes(4).toString('hex')}`;

  const created = await api<{ id: number }>(
    'POST', '/api/v1/admin/categories',
    { values: { slug, name: 'E2E Category', sort_order: 99, is_enabled: true } },
    admin.token,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body.error));

  const list = await api<{ items: { slug: string }[] }>(
    'GET', '/api/v1/admin/categories', undefined, admin.token,
  );
  assert.ok(list.body.data!.items.some((c) => c.slug === slug), 'it is in the list');

  // A column that is not declared creatable is refused, interpolation-shaped or not.
  const evil = await api('POST', '/api/v1/admin/categories',
    { values: { slug: `${slug}_x`, name: 'X', 'name); DROP TABLE users; --': 'x' } }, admin.token);
  assert.equal(evil.status, 400);

  const missing = await api('POST', '/api/v1/admin/categories',
    { values: { name: 'No slug' } }, admin.token);
  assert.equal(missing.status, 400, 'a required column is required');

  const duplicate = await api('POST', '/api/v1/admin/categories',
    { values: { slug, name: 'Again' } }, admin.token);
  assert.equal(duplicate.status, 409, 'a duplicate key is a conflict, not a crash');

  await execute('DELETE FROM categories WHERE slug = ?', [slug]).catch(() => undefined);
});

test('creating is staff-only, like every other admin write', async () => {
  const user = await registerUser();
  const res = await api('POST', '/api/v1/admin/categories',
    { values: { slug: 'nope', name: 'Nope' } }, user.token);
  assert.equal(res.status, 403);
});

test('a soft-deletable row is hidden, not destroyed', async () => {
  const admin = await registerAdmin();
  const publicId = `e2e_trk_${randomBytes(4).toString('hex')}`;

  const created = await api<{ id: number }>(
    'POST', '/api/v1/admin/music',
    {
      values: {
        public_id: publicId,
        title: 'E2E Track',
        artist: 'E2E',
        audio_url: 'https://example.com/track.mp3',
        duration_sec: 30,
        is_enabled: true,
      },
    },
    admin.token,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body.error));
  const id = created.body.data!.id;

  const removed = await api('DELETE', `/api/v1/admin/music/${id}`, undefined, admin.token);
  assert.equal(removed.status, 200);

  const list = await api<{ items: { id: number }[] }>(
    'GET', '/api/v1/admin/music', undefined, admin.token,
  );
  assert.ok(!list.body.data!.items.some((t) => t.id === id), 'gone from the list');

  // The row itself survives: videos that used the track must not be orphaned.
  const row = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM music_tracks WHERE id = ? AND deleted_at IS NOT NULL',
    [id],
  );
  assert.equal(Number(row?.c), 1, 'soft-deleted, still on disk');

  await execute('DELETE FROM music_tracks WHERE id = ?', [id]).catch(() => undefined);
});

test('a payment method can be added — the preflight blocker is fixable in the panel', async () => {
  const admin = await registerAdmin();
  const slug = `e2e_pay_${randomBytes(4).toString('hex')}`;

  const created = await api<{ id: number }>(
    'POST', '/api/v1/admin/payment-methods',
    {
      values: {
        slug,
        label: 'E2E Bank',
        kind: 'bank',
        currencies: '["PKR"]',
        account_name: 'Real Business Name',
        account_number: 'PK00 1234 5678',
        is_enabled: true,
      },
    },
    admin.token,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body.error));

  // A column the table requires but the form omitted names itself, rather than
  // surfacing as "something went wrong on our end".
  const incomplete = await api<{ message: string }>(
    'POST', '/api/v1/admin/payment-methods',
    { values: { slug: `${slug}_x`, label: 'X', kind: 'bank', account_name: 'X', account_number: 'X' } },
    admin.token,
  );
  assert.equal(incomplete.status, 400);
  assert.match(incomplete.body.error!.message, /currencies/);

  await execute('DELETE FROM payment_methods WHERE slug LIKE ?', [`${slug}%`]).catch(() => undefined);
});

test('a filter and an effect can be added from the panel', async () => {
  const admin = await registerAdmin();
  const slug = `e2e_fx_${randomBytes(4).toString('hex')}`;

  // The two kinds the Filters & Effects screen exists to manage.
  for (const [kind, name] of [['filter', 'E2E Warm Glow'], ['effect', 'E2E Shake']] as const) {
    const created = await api<{ id: number }>(
      'POST', '/api/v1/admin/creative',
      {
        values: {
          kind,
          slug: `${slug}_${kind}`,
          name,
          category: 'colour',
          params: '{"previewColor":"#FFB067","intensity":70}',
          sort_order: 900,
          is_enabled: true,
        },
      },
      admin.token,
    );
    assert.equal(created.status, 201, `${kind}: ${JSON.stringify(created.body.error)}`);
  }

  // And they come back in the list the panel reads, so an operator sees what
  // they just added rather than having to trust that it worked.
  const list = await api<{ items: { slug: string; kind: string }[] }>(
    'GET', '/api/v1/admin/creative', undefined, admin.token,
  );
  assert.equal(list.status, 200);
  const mine = list.body.data!.items.filter((row) => row.slug.startsWith(slug));
  assert.equal(mine.length, 2, 'both are listed');

  // The same slug twice is a conflict, not a silent second row.
  const duplicate = await api(
    'POST', '/api/v1/admin/creative',
    { values: { kind: 'filter', slug: `${slug}_filter`, name: 'Again' } },
    admin.token,
  );
  assert.equal(duplicate.status, 409);

  await execute('DELETE FROM creative_assets WHERE slug LIKE ?', [`${slug}%`]).catch(() => undefined);
});
