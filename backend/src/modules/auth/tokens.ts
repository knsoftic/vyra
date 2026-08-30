/**
 * Session and refresh-token handling.
 *
 * Refresh tokens rotate: every refresh invalidates the token that was presented
 * and issues a new one. A rotation chain shares a `family_id`.
 *
 * That gives us theft detection. If a refresh token that has already been
 * rotated is presented again, either the legitimate client replayed it or an
 * attacker stole it — and we cannot tell which. So the whole family is revoked
 * and every device on that chain must sign in again. Losing a session is a small
 * cost; leaving a stolen token live is not.
 *
 * Tokens are stored only as SHA-256 hashes. A database leak yields no usable
 * refresh token.
 */

import { createHash } from 'node:crypto';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { ulid } from 'ulid';
import { config } from '../../core/config.ts';
import { execute, query, queryOne, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import { packIp, recordSecurityEvent } from '../../core/security-log.ts';
import { signAccessToken } from '../../middleware/auth.ts';
import type { AuthTokens, DeviceInfo } from '../../../../shared/contracts/user.ts';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Access token lifetime in seconds, derived from the configured TTL string. */
function accessTtlSeconds(): number {
  const raw = config.JWT_ACCESS_TTL;
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return value * multiplier;
}

function refreshExpiryDate(): Date {
  const raw = config.JWT_REFRESH_TTL;
  const match = /^(\d+)([smhd])$/.exec(raw);
  const days = match && match[2] === 'd' ? Number(match[1]) : 30;
  return new Date(Date.now() + days * 86400_000);
}

interface SessionRow {
  id: number;
  user_id: number;
  device_id: number | null;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

/** Upserts the device record and returns its id. */
export async function registerDevice(userId: number, device: DeviceInfo): Promise<number> {
  await execute(
    `INSERT INTO user_devices (user_id, device_id, platform, push_token, app_version, last_seen_at)
     VALUES (:userId, :deviceId, :platform, :pushToken, :appVersion, NOW(3))
     ON DUPLICATE KEY UPDATE
       platform = VALUES(platform),
       push_token = COALESCE(VALUES(push_token), push_token),
       app_version = VALUES(app_version),
       last_seen_at = NOW(3),
       deleted_at = NULL`,
    {
      userId,
      deviceId: device.deviceId,
      platform: device.platform,
      pushToken: device.pushToken ?? null,
      appVersion: device.appVersion ?? null,
    },
  );

  const row = await queryOne<{ id: number }>(
    'SELECT id FROM user_devices WHERE user_id = :userId AND device_id = :deviceId',
    { userId, deviceId: device.deviceId },
  );
  if (!row) throw new AppError('internal_error', 'Device could not be registered.');
  return row.id;
}

/** Creates a brand new session family. Used at sign-in and registration. */
export async function issueSession(
  req: Request,
  userId: number,
  userPublicId: string,
  device: DeviceInfo,
): Promise<AuthTokens & { sessionId: number }> {
  const deviceRowId = await registerDevice(userId, device);
  const familyId = ulid();
  return mintTokens(req, { userId, userPublicId, familyId, deviceRowId });
}

async function mintTokens(
  req: Request,
  opts: { userId: number; userPublicId: string; familyId: string; deviceRowId: number | null },
): Promise<AuthTokens & { sessionId: number }> {
  const expiresAt = refreshExpiryDate();

  // The refresh token carries a random `jti` rather than the session row id.
  // Embedding the row id would mean inserting the row first to learn it, then
  // updating the hash afterwards — and `refresh_token_hash` is UNIQUE, so the
  // placeholder that first insert needs collides on the second session ever
  // created. Lookup is by hash anyway, so the row id was never needed here.
  const refreshToken = jwt.sign(
    { sub: opts.userPublicId, fam: opts.familyId, jti: ulid() },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_TTL as jwt.SignOptions['expiresIn'] },
  );

  const inserted = await execute(
    `INSERT INTO user_sessions
       (user_id, device_id, family_id, refresh_token_hash, ip, user_agent, expires_at)
     VALUES (:userId, :deviceId, :familyId, :hash, :ip, :userAgent, :expiresAt)`,
    {
      userId: opts.userId,
      deviceId: opts.deviceRowId,
      familyId: opts.familyId,
      hash: hashToken(refreshToken),
      ip: packIp(req),
      userAgent: req.header('user-agent')?.slice(0, 255) ?? null,
      expiresAt,
    },
  );

  const sessionId = inserted.insertId;

  // The access token *does* carry the session id, which is what lets a revoked
  // session be rejected on the very next request.
  const accessToken = signAccessToken({
    sub: opts.userPublicId,
    uid: opts.userId,
    sid: String(sessionId),
  });

  return { accessToken, refreshToken, expiresIn: accessTtlSeconds(), sessionId };
}

/**
 * Exchanges a refresh token for a new pair.
 *
 * Presenting an already-rotated token revokes the entire family — see the note
 * at the top of this file.
 */
export async function rotateSession(
  req: Request,
  refreshToken: string,
): Promise<AuthTokens & { sessionId: number; userId: number }> {
  let claims: { sub: string; fam: string; jti: string };
  try {
    claims = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET) as typeof claims;
  } catch {
    throw new AppError('token_invalid', 'Please sign in again.');
  }

  const hash = hashToken(refreshToken);

  // Resolve the row id WITHOUT a lock first.
  //
  // `SELECT ... WHERE refresh_token_hash = ? FOR UPDATE` that matches nothing
  // makes InnoDB take a gap lock on the unique index, which blocks every
  // concurrent INSERT into user_sessions until the transaction ends. Unknown and
  // expired tokens are the common case, so locking on a miss would let ordinary
  // junk traffic stall sign-ins. Looking up first means the lock below is always
  // a single-row primary-key lock with no gap.
  const found = await queryOne<{ id: number }>(
    'SELECT id FROM user_sessions WHERE refresh_token_hash = :hash',
    { hash },
  );
  if (!found) throw new AppError('token_invalid', 'Please sign in again.');

  type ReuseSignal = { reuse: { userId: number; familyId: string; sessionId: number } };
  type Rotated = AuthTokens & { sessionId: number; userId: number };

  const outcome = await transaction<ReuseSignal | Rotated>(async (tx) => {
    const rows = await query<SessionRow>(
      `SELECT id, user_id, device_id, family_id, expires_at, revoked_at, revoked_reason
         FROM user_sessions WHERE id = :id FOR UPDATE`,
      { id: found.id },
      tx,
    );
    const session = rows[0];

    if (!session) {
      throw new AppError('token_invalid', 'Please sign in again.');
    }

    if (session.revoked_at) {
      // Reuse of an already-rotated token. The revocation must NOT happen here:
      // throwing from inside the transaction rolls it back, so the family would
      // stay live — exactly the opposite of what this defence is for. Report it
      // to the caller instead, which commits, and revoke outside.
      return { reuse: { userId: session.user_id, familyId: session.family_id, sessionId: session.id } };
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
      throw new AppError('token_expired', 'Your session has expired. Please sign in again.');
    }

    const user = await queryOne<{ public_id: string; status: string }>(
      'SELECT public_id, status FROM users WHERE id = :id AND deleted_at IS NULL',
      { id: session.user_id },
      tx,
    );
    if (!user) throw new AppError('token_invalid', 'Please sign in again.');
    if (user.status === 'banned') throw new AppError('account_banned', 'This account has been banned.');
    if (user.status === 'suspended') {
      throw new AppError('account_suspended', 'This account is currently suspended.');
    }

    await execute(
      `UPDATE user_sessions SET revoked_at = NOW(3), revoked_reason = 'rotated' WHERE id = :id`,
      { id: session.id },
      tx,
    );

    const tokens = await mintTokens(req, {
      userId: session.user_id,
      userPublicId: user.public_id,
      familyId: session.family_id,
      deviceRowId: session.device_id,
    });

    return { ...tokens, userId: session.user_id };
  });

  if ('reuse' in outcome) {
    const { userId, familyId, sessionId } = outcome.reuse;
    // Now that the read transaction has committed, revoke the whole chain.
    await execute(
      `UPDATE user_sessions
          SET revoked_at = NOW(3), revoked_reason = 'token_reuse_detected'
        WHERE family_id = :familyId AND revoked_at IS NULL`,
      { familyId },
    );
    logger.warn({ userId, familyId }, 'refresh token reuse detected — session family revoked');
    await recordSecurityEvent(req, {
      userId,
      event: 'token_reuse_detected',
      outcome: 'blocked',
      detail: 'A refresh token was presented after it had already been rotated.',
      sessionId,
    });
    throw new AppError(
      'token_invalid',
      'Your session was ended for security. Please sign in again.',
    );
  }

  return outcome;
}

/** Ends one session. Used by logout and by "sign out this device". */
export async function revokeSession(
  sessionId: number,
  userId: number,
  reason = 'logout',
): Promise<void> {
  await execute(
    `UPDATE user_sessions
        SET revoked_at = NOW(3), revoked_reason = :reason
      WHERE id = :id AND user_id = :userId AND revoked_at IS NULL`,
    { id: sessionId, userId, reason },
  );
}

/** Ends every session for a user. Used by logout-all and by a password change. */
export async function revokeAllSessions(
  userId: number,
  reason = 'logout_all',
  exceptSessionId?: number,
): Promise<number> {
  const result = await execute(
    `UPDATE user_sessions
        SET revoked_at = NOW(3), revoked_reason = :reason
      WHERE user_id = :userId AND revoked_at IS NULL
        ${exceptSessionId ? 'AND id <> :exceptId' : ''}`,
    exceptSessionId
      ? { userId, reason, exceptId: exceptSessionId }
      : { userId, reason },
  );
  return result.affectedRows;
}

/** True when the session backing an access token is still live. */
export async function isSessionActive(sessionId: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM user_sessions WHERE id = :id AND revoked_at IS NULL AND expires_at > NOW(3)',
    { id: sessionId },
  );
  return row !== undefined;
}
