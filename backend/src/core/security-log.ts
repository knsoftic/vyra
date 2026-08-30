/**
 * Security event log.
 *
 * Records what happened to a user's account — sign-in, sign-out, refresh, token
 * reuse, password change, session revocation. The user can see their own
 * history, and an admin can see all of it.
 *
 * Two rules: it never throws (a logging failure must not fail the action that
 * succeeded), and it never records a secret. Codes, passwords and tokens are not
 * accepted by this API — only the fact that one was used.
 */

import type { Request } from 'express';
import { execute } from './db.ts';
import { logger } from './logger.ts';

export type SecurityEventName =
  | 'register'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'logout_all'
  | 'token_refresh'
  | 'token_reuse_detected'
  | 'otp_requested'
  | 'otp_verified'
  | 'otp_failed'
  | 'password_changed'
  | 'password_reset'
  | 'email_verified'
  | 'session_revoked'
  | 'account_type_changed'
  | 'username_changed'
  | 'privacy_changed'
  | 'user_blocked'
  | 'user_unblocked'
  // Trust and safety. Opening someone's identity document, and every change to
  // an account's standing, leaves a trace naming who did it.
  | 'verification_requested'
  | 'verification_document_viewed'
  | 'verification_decided'
  | 'verification_revoked'
  | 'moderation_action'
  | 'moderation_reverted';

export interface SecurityEventInput {
  userId?: number | null;
  event: SecurityEventName;
  outcome?: 'success' | 'failure' | 'blocked';
  detail?: string;
  sessionId?: number | null;
}

/** Packs an IP into VARBINARY(16); IPv4 as four bytes, IPv6 as its text form. */
export function packIp(req: Request): Buffer | null {
  const raw = req.ip;
  if (!raw) return null;
  const normalised = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  const parts = normalised.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
    return Buffer.from(parts.map(Number));
  }
  return Buffer.from(normalised, 'utf8').subarray(0, 16);
}

export async function recordSecurityEvent(
  req: Request | null,
  input: SecurityEventInput,
): Promise<void> {
  try {
    await execute(
      `INSERT INTO security_events (user_id, event, outcome, detail, session_id, ip, user_agent)
       VALUES (:userId, :event, :outcome, :detail, :sessionId, :ip, :userAgent)`,
      {
        userId: input.userId ?? null,
        event: input.event,
        outcome: input.outcome ?? 'success',
        detail: input.detail?.slice(0, 500) ?? null,
        sessionId: input.sessionId ?? null,
        ip: req ? packIp(req) : null,
        userAgent: req?.header('user-agent')?.slice(0, 255) ?? null,
      },
    );
  } catch (err) {
    logger.error({ err, event: input.event }, 'SECURITY LOG WRITE FAILED');
  }
}

/** Sign-in outcomes, kept separately because lockout counting reads this table. */
export async function recordLoginAttempt(
  req: Request,
  input: { email?: string | null; userId?: number | null; successful: boolean; reason?: string },
): Promise<void> {
  try {
    await execute(
      `INSERT INTO login_attempts (identifier, user_id, ip, successful, reason)
       VALUES (:email, :userId, :ip, :successful, :reason)`,
      {
        email: input.email ?? null,
        userId: input.userId ?? null,
        ip: packIp(req),
        successful: input.successful ? 1 : 0,
        reason: input.reason?.slice(0, 80) ?? null,
      },
    );
  } catch (err) {
    logger.error({ err }, 'login attempt log write failed');
  }
}
