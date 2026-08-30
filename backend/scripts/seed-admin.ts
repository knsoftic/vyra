/**
 * Creates (or repairs) the super administrator.
 *
 * The platform cannot be operated without one — the preflight fails on an empty
 * `admin_users` table for exactly that reason — and creating one by hand means
 * hand-writing an argon2 hash, which nobody should be doing at 2am on launch
 * night.
 *
 * Additive and idempotent: it never deletes anything, and running it twice
 * updates the same account rather than creating a second. Credentials come from
 * the environment so they never land in shell history on a shared server:
 *
 *     ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long passphrase' npm run seed:admin
 *
 * With neither set it creates `admin@vyra.local` with a generated password that
 * is printed ONCE. Change it after first sign-in.
 *
 * The admin signs in through the same login as everyone else (the admin panel
 * uses `/auth/login`); what makes them an admin is the `admin_users` row linked
 * to their user account.
 */

import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { ulid } from 'ulid';
import { query, queryOne, execute, closeDb } from '../src/core/db.ts';
import { closeRedis } from '../src/core/redis.ts';

const email = (process.env.ADMIN_EMAIL ?? 'admin@vyra.local').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
const generated = !process.env.ADMIN_PASSWORD;

/** Every module the admin panel declares, so the role covers all of it. */
const MODULES = [
  'dashboard', 'analytics', 'health', 'users', 'verification', 'roles', 'videos', 'comments',
  'categories', 'hashtags', 'creative', 'music', 'live', 'communities', 'moderation', 'coins',
  'gifts', 'payments', 'ads', 'boost', 'monetization', 'tasks', 'rates', 'ai', 'notifications',
  'banners', 'support', 'flags', 'settings', 'regions', 'security', 'audit', 'payouts',
];
const ACTIONS = ['view', 'create', 'update', 'delete', 'approve', 'export'];

async function main(): Promise<void> {
  if (password.length < 10) {
    console.error('ADMIN_PASSWORD must be at least 10 characters.');
    process.exitCode = 1;
    return;
  }

  // ── The role ──
  let role = await queryOne<{ id: number }>(
    "SELECT id FROM roles WHERE slug = 'super_admin'",
  );
  if (!role) {
    await execute(
      "INSERT INTO roles (slug, name, is_system) VALUES ('super_admin', 'Super admin', 1)",
    );
    role = await queryOne<{ id: number }>("SELECT id FROM roles WHERE slug = 'super_admin'");
  }
  const roleId = role!.id;

  // Permission rows are informational for super_admin (rbac bypasses the check
  // for that slug) but keeping them complete means the roles screen tells the
  // truth about what the role can do.
  let permissionsAdded = 0;
  for (const module of MODULES) {
    for (const action of ACTIONS) {
      const result = await execute(
        `INSERT IGNORE INTO role_permissions (role_id, module, action) VALUES (:roleId, :module, :action)`,
        { roleId, module, action },
      );
      permissionsAdded += result.affectedRows;
    }
  }

  // ── The platform account the admin signs in with ──
  const hash = await argon2.hash(password, { type: argon2.argon2id });

  let user = await queryOne<{ id: number; public_id: string }>(
    'SELECT id, public_id FROM users WHERE email = :email AND deleted_at IS NULL',
    { email },
  );

  if (!user) {
    const publicId = ulid();
    // The username must be unique, lowercase, and not collide with a person.
    const username = `admin_${publicId.slice(-8).toLowerCase()}`;
    await execute(
      `INSERT INTO users (public_id, username, email, password_hash, account_category, account_type, status)
       VALUES (:publicId, :username, :email, :hash, 'individual', 'normal', 'active')`,
      { publicId, email, username, hash },
    );
    user = await queryOne<{ id: number; public_id: string }>(
      'SELECT id, public_id FROM users WHERE email = :email',
      { email },
    );
    await execute(
      `INSERT INTO user_profiles (user_id, display_name, bio) VALUES (:userId, 'Administrator', '')
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      { userId: user!.id },
    );
    await execute(
      'INSERT IGNORE INTO wallets (user_id) VALUES (:userId)',
      { userId: user!.id },
    );
  } else {
    // The account exists — reset its password only when one was explicitly
    // provided. A generated password must never silently replace a real one.
    if (!generated) {
      await execute('UPDATE users SET password_hash = :hash WHERE id = :id', { hash, id: user.id });
    }
  }

  // ── The admin link ──
  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM admin_users WHERE user_id = :userId AND deleted_at IS NULL',
    { userId: user!.id },
  );

  if (existing) {
    await execute(
      "UPDATE admin_users SET role_id = :roleId, status = 'active', password_hash = :hash WHERE id = :id",
      { roleId, hash, id: existing.id },
    );
  } else {
    await execute(
      `INSERT INTO admin_users (public_id, name, email, password_hash, role_id, status, user_id)
       VALUES (:publicId, 'Administrator', :email, :hash, :roleId, 'active', :userId)`,
      { publicId: ulid(), email, hash, roleId, userId: user!.id },
    );
  }

  console.log('\n  Super administrator ready.\n');
  console.log(`  Sign in at the admin panel with:`);
  console.log(`    Email:    ${email}`);
  if (generated) {
    console.log(`    Password: ${password}   <- generated, shown ONCE. Change it after signing in.`);
  } else {
    console.log('    Password: (the one you provided)');
  }
  console.log(`\n  Role permissions present for super_admin${permissionsAdded ? ` (+${permissionsAdded} added)` : ''}.\n`);
}

main()
  .catch((err: unknown) => {
    console.error('seed-admin failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    await closeRedis();
  });
