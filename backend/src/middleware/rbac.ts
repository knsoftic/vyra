/**
 * Admin permissions.
 *
 * Permissions are (module, action) pairs stored per role, so the owner can build
 * a "Finance can approve withdrawals but not ban users" role in the panel
 * without a code change (ADR-015). Nothing is granted implicitly: a role holds
 * exactly the pairs written against it.
 */

import type { Request, RequestHandler } from 'express';
import { query, queryOne } from '../core/db.ts';
import { AppError } from '../core/errors.ts';

export type AdminAction = 'view' | 'create' | 'update' | 'delete' | 'approve' | 'export';

export interface AdminRequest extends Request {
  adminId: number;
  adminName: string;
  roleId: number;
  roleSlug: string;
  permissions: Set<string>;
}

interface AdminRow {
  id: number;
  name: string;
  role_id: number;
  role_slug: string;
  status: 'active' | 'disabled';
}

interface PermissionRow {
  module: string;
  action: string;
}

const permKey = (module: string, action: string) => `${module}:${action}`;

/** Loads the admin and their permission set onto the request. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  void (async () => {
    // The admin identity is established by the same JWT flow as users, then
    // resolved against admin_users here.
    const userId = (req as { userId?: number }).userId;
    if (userId === undefined) throw new AppError('unauthenticated', 'Admin sign-in required.');

    // Matched on the explicit link, not on `admin_users.id`. Those are separate
    // auto-increment sequences, so comparing them was coincidence — and a
    // coincidence that granted an unrelated user an admin's permissions.
    const admin = await queryOne<AdminRow>(
      `SELECT a.id, a.name, a.role_id, r.slug AS role_slug, a.status
         FROM admin_users a
         JOIN roles r ON r.id = a.role_id
        WHERE a.user_id = ? AND a.deleted_at IS NULL`,
      [userId],
    );
    if (!admin) throw new AppError('forbidden', 'This account has no admin access.');
    if (admin.status !== 'active') throw new AppError('forbidden', 'This admin account is disabled.');

    const perms = await query<PermissionRow>(
      'SELECT module, action FROM role_permissions WHERE role_id = ?',
      [admin.role_id],
    );

    const adminReq = req as AdminRequest;
    adminReq.adminId = admin.id;
    adminReq.adminName = admin.name;
    adminReq.roleId = admin.role_id;
    adminReq.roleSlug = admin.role_slug;
    adminReq.permissions = new Set(perms.map((p) => permKey(p.module, p.action)));
  })()
    .then(() => next())
    .catch(next);
};

/** Gates a route on one (module, action) pair. Mount after `requireAdmin`. */
export function requirePermission(module: string, action: AdminAction): RequestHandler {
  return (req, _res, next) => {
    const admin = req as Partial<AdminRequest>;
    if (!admin.permissions) {
      next(new AppError('forbidden', 'Admin context missing. requireAdmin must run first.'));
      return;
    }
    // The super-admin role is the one exception, and it is explicit.
    if (admin.roleSlug === 'super_admin') return next();

    if (!admin.permissions.has(permKey(module, action))) {
      next(
        new AppError(
          'insufficient_permission',
          `Your role cannot ${action} ${module.replace(/_/g, ' ')}.`,
        ),
      );
      return;
    }
    next();
  };
}

export const currentAdmin = (req: Request): Partial<AdminRequest> => req as Partial<AdminRequest>;
