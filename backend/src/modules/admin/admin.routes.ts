/**
 * The admin panel's own routes: identity, overview, settings, and the audit
 * trail every other admin route writes into.
 *
 * Access is the same two-step as everywhere else — a normal user session, then
 * the `admin_users` link resolved by `requireAdmin`. There is no separate admin
 * token to leak or forget to revoke: disabling the admin row, or the user
 * account, ends the access.
 */

import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { requireAdmin, type AdminRequest } from '../../middleware/rbac.ts';
import { AppError } from '../../core/errors.ts';
import { query, queryOne, execute } from '../../core/db.ts';
import { SETTING_DEFAULTS, getSettings, setSetting, type SettingKey } from '../../core/settings.ts';
import { verifyMailTransport, sendMail, resolveMailConfig } from '../../core/mailer.ts';
import { audit } from '../../middleware/audit.ts';
import * as admin from './admin.service.ts';

export const adminRouter: Router = Router();

/** Every route in this file is admin-only; said once. */
const guard: RequestHandler[] = [requireAuth, requireAdmin];

// ── Identity ──

adminRouter.get(
  '/admin/me',
  ...guard,
  limits.read,
  asyncHandler(async (req, res) => {
    const a = req as AdminRequest;
    res.json(
      ok({
        adminId: a.adminId,
        name: a.adminName,
        role: a.roleSlug,
        permissions: [...a.permissions],
      }),
    );
  }),
);

// ── Overview ──

adminRouter.get(
  '/admin/dashboard',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await admin.dashboard()));
  }),
);

adminRouter.get(
  '/admin/analytics',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await admin.analytics()));
  }),
);

adminRouter.get(
  '/admin/audit',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await admin.auditLog()));
  }),
);

adminRouter.get(
  '/admin/security',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    const [events, logins] = await Promise.all([
      query(
        `SELECT s.id, s.event, s.outcome, s.detail, s.created_at AS createdAt,
                u.username, INET6_NTOA(s.ip) AS ip
           FROM security_events s
           LEFT JOIN users u ON u.id = s.user_id
          ORDER BY s.id DESC LIMIT 100`,
      ),
      query(
        `SELECT id, email, outcome, device, INET6_NTOA(ip) AS ip, created_at AS createdAt
           FROM admin_login_attempts ORDER BY id DESC LIMIT 50`,
      ),
    ]);
    res.json(ok({ events, adminLogins: logins }));
  }),
);

// ── Settings ──

/**
 * Keys an operator may not read back once written.
 *
 * The value still *works* — the mailer reads it directly — but the API returns
 * only whether it is set. A password that can be read out of a settings screen
 * is a password in every reviewer's screen recording.
 */
const SECRET_KEYS = new Set<string>(['email.smtp_pass', 'sms.api_key', 'sms.api_secret']);

adminRouter.get(
  '/admin/settings',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    const all = await getSettings();
    const settings: Record<string, unknown> = {};
    for (const key of Object.keys(SETTING_DEFAULTS)) {
      settings[key] = SECRET_KEYS.has(key)
        ? String(all[key] ?? '').length > 0
          ? '••••••••'
          : ''
        : (all[key] ?? SETTING_DEFAULTS[key as SettingKey]);
    }
    res.json(ok({ settings }));
  }),
);

const settingSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.unknown(),
});

adminRouter.patch(
  '/admin/settings',
  ...guard,
  limits.write,
  validate({ body: settingSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof settingSchema }>(req).body;
    const key = body.key as SettingKey;

    // Only declared settings exist. A typo must be an error, not a new row that
    // nothing reads.
    if (!(key in SETTING_DEFAULTS)) {
      throw new AppError('validation_failed', `Unknown setting '${body.key}'.`);
    }

    // The value must be the same shape as its default — a string where a number
    // belongs would quietly break every consumer of the setting.
    const fallback = SETTING_DEFAULTS[key];
    const incoming = body.value;
    if (typeof fallback !== typeof incoming && !(typeof fallback === 'object')) {
      throw new AppError(
        'validation_failed',
        `'${body.key}' expects a ${typeof fallback}, got ${typeof incoming}.`,
      );
    }

    const before = (await getSettings())[key];
    await setSetting(key, incoming, (req as AdminRequest).adminId);

    await audit(req, {
      module: 'settings',
      action: 'update',
      targetType: 'setting',
      targetId: key,
      oldValue: SECRET_KEYS.has(key) ? '(hidden)' : before,
      newValue: SECRET_KEYS.has(key) ? '(hidden)' : incoming,
    });

    res.json(ok({ key, saved: true }));
  }),
);

// ── Email ──

adminRouter.get(
  '/admin/settings/email/status',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    const resolved = await resolveMailConfig();
    res.json(
      ok(
        resolved
          ? {
              transport: 'smtp',
              source: resolved.source,
              host: resolved.host,
              port: resolved.port,
              user: resolved.user,
              from: resolved.from,
            }
          : { transport: 'console' },
      ),
    );
  }),
);

const testMailSchema = z.object({ to: z.string().email() });

/**
 * Sends one real test message.
 *
 * Verify first, then send — so a wrong password reports "authentication
 * failed", not a queued message that dies later in the outbox where nobody is
 * watching for it.
 */
adminRouter.post(
  '/admin/settings/email/test',
  ...guard,
  limits.write,
  validate({ body: testMailSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof testMailSchema }>(req).body;

    const verified = await verifyMailTransport();
    if (!verified.ok) {
      res.json(ok({ sent: false, detail: verified.detail ?? 'Transport not configured.' }));
      return;
    }

    const result = await sendMail({
      to: body.to,
      subject: 'Vyra email test',
      text:
        'This is a test message from the Vyra admin panel.\n\n' +
        'If you are reading it, SMTP delivery is configured correctly.',
    });

    await audit(req, {
      module: 'settings',
      action: 'email_test',
      targetType: 'email',
      targetId: body.to,
    });

    res.json(ok({ sent: result.transport === 'smtp', transport: result.transport }));
  }),
);

// ── Roles and administrators ──

adminRouter.get(
  '/admin/roles',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    const [roles, permissions, admins] = await Promise.all([
      query('SELECT id, slug, name, is_system AS isSystem FROM roles ORDER BY id'),
      query('SELECT role_id AS roleId, module, action FROM role_permissions ORDER BY role_id, module, action'),
      query(
        `SELECT a.public_id AS id, a.name, a.email, a.status, r.slug AS role,
                a.last_login_at AS lastLoginAt, a.created_at AS createdAt, u.username
           FROM admin_users a
           JOIN roles r ON r.id = a.role_id
           LEFT JOIN users u ON u.id = a.user_id
          WHERE a.deleted_at IS NULL
          ORDER BY a.id`,
      ),
    ]);
    res.json(ok({ roles, permissions, admins }));
  }),
);

const createAdminSchema = z.object({
  /** The email of an EXISTING platform account to grant admin access to. */
  email: z.string().email(),
  name: z.string().trim().min(2).max(120),
  roleSlug: z.string().trim().min(2).max(40),
});

/**
 * Grants admin access to an existing account.
 *
 * Deliberately not an invitation flow: the person must already have a platform
 * account with a password they chose, so this route never handles credentials.
 * Super-admin only — an admin who can mint admins is a super admin in fact, so
 * the permission model says so.
 */
adminRouter.post(
  '/admin/roles/admins',
  ...guard,
  limits.write,
  validate({ body: createAdminSchema }),
  asyncHandler(async (req, res) => {
    const a = req as AdminRequest;
    if (a.roleSlug !== 'super_admin') {
      throw new AppError('forbidden', 'Only a super admin can grant admin access.');
    }
    const body = valid<{ body: typeof createAdminSchema }>(req).body;
    const email = body.email.toLowerCase();

    const user = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE email = :email AND deleted_at IS NULL',
      { email },
    );
    if (!user) {
      throw new AppError('not_found', 'No platform account with that email. Ask them to register first.');
    }

    const role = await queryOne<{ id: number }>('SELECT id FROM roles WHERE slug = :slug', {
      slug: body.roleSlug,
    });
    if (!role) throw new AppError('not_found', 'No such role.');

    const existing = await queryOne<{ id: number }>(
      'SELECT id FROM admin_users WHERE user_id = :userId AND deleted_at IS NULL',
      { userId: user.id },
    );
    if (existing) throw new AppError('conflict', 'That account already has admin access.');

    const { ulid } = await import('ulid');
    await execute(
      `INSERT INTO admin_users (public_id, name, email, password_hash, role_id, status, user_id)
       SELECT :publicId, :name, :email, u.password_hash, :roleId, 'active', u.id
         FROM users u WHERE u.id = :userId`,
      { publicId: ulid(), name: body.name, email, roleId: role.id, userId: user.id },
    );

    await audit(req, {
      module: 'roles',
      action: 'grant_admin',
      targetType: 'admin',
      targetId: email,
      newValue: { role: body.roleSlug },
    });

    res.status(201).json(ok({ granted: true }));
  }),
);

const adminStatusSchema = z.object({ status: z.enum(['active', 'disabled']) });

adminRouter.patch(
  '/admin/roles/admins/:id',
  ...guard,
  limits.write,
  validate({ body: adminStatusSchema }),
  asyncHandler(async (req, res) => {
    const a = req as AdminRequest;
    if (a.roleSlug !== 'super_admin') {
      throw new AppError('forbidden', 'Only a super admin can change admin access.');
    }
    const body = valid<{ body: typeof adminStatusSchema }>(req).body;
    const publicId = String(req.params.id);

    const target = await queryOne<{ id: number; status: string }>(
      'SELECT id, status FROM admin_users WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId },
    );
    if (!target) throw new AppError('not_found', 'No such administrator.');

    // Nobody disables themselves: the last super admin locking everyone out is
    // exactly the accident this line exists to prevent.
    if (target.id === a.adminId) {
      throw new AppError('conflict', 'You cannot change your own admin access.');
    }

    await execute('UPDATE admin_users SET status = :status WHERE id = :id', {
      status: body.status,
      id: target.id,
    });

    await audit(req, {
      module: 'roles',
      action: body.status === 'active' ? 'enable_admin' : 'disable_admin',
      targetType: 'admin',
      targetId: publicId,
      oldValue: { status: target.status },
      newValue: { status: body.status },
    });

    res.json(ok({ status: body.status }));
  }),
);
