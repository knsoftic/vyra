/**
 * Admin audit trail.
 *
 * Every state-changing admin action is recorded with who did it, what changed
 * and why. The table is append-only and there is no delete path anywhere in the
 * codebase — an audit log a bad actor can edit is not an audit log.
 */

import type { Request } from 'express';
import { execute } from '../core/db.ts';
import { logger } from '../core/logger.ts';
import { currentAdmin } from './rbac.ts';

export interface AuditEntry {
  module: string;
  action: string;
  targetType?: string;
  targetId?: string | number;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
}

function clientIp(req: Request): Buffer | null {
  const raw = req.ip;
  if (!raw) return null;
  // Stored as VARBINARY so both IPv4 and IPv6 fit without a text column.
  const normalised = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  const parts = normalised.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    return Buffer.from(parts.map(Number));
  }
  return Buffer.from(normalised, 'utf8').subarray(0, 16);
}

/**
 * Writes one audit row. Deliberately never throws: a failure to log must not
 * roll back an action the admin already performed. It is logged loudly instead.
 */
export async function audit(req: Request, entry: AuditEntry): Promise<void> {
  const admin = currentAdmin(req);
  try {
    await execute(
      `INSERT INTO audit_logs
         (admin_id, admin_name, role_slug, module, action, target_type, target_id,
          old_value, new_value, reason, ip, user_agent)
       VALUES
         (:adminId, :adminName, :roleSlug, :module, :action, :targetType, :targetId,
          :oldValue, :newValue, :reason, :ip, :userAgent)`,
      {
        adminId: admin.adminId ?? null,
        adminName: admin.adminName ?? 'system',
        roleSlug: admin.roleSlug ?? null,
        module: entry.module,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId !== undefined ? String(entry.targetId) : null,
        oldValue: entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
        newValue: entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
        reason: entry.reason ?? null,
        ip: clientIp(req),
        userAgent: req.header('user-agent')?.slice(0, 255) ?? null,
      },
    );
  } catch (err) {
    logger.error({ err, entry }, 'AUDIT WRITE FAILED');
  }
}
