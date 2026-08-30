/**
 * Authentication.
 *
 * Access tokens are short-lived and stateless; refresh tokens are stored so a
 * logout or a stolen-device revocation takes effect immediately rather than
 * waiting for expiry. A suspended or banned account is rejected here, before any
 * handler runs, so no route needs to remember to check.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../core/config.ts';
import { queryOne } from '../core/db.ts';
import { AppError } from '../core/errors.ts';

export interface AuthedRequest extends Request {
  userId: number;
  userPublicId: string;
  sessionId: string;
}

export interface AccessTokenClaims {
  sub: string;
  uid: number;
  sid: string;
}

interface UserStatusRow {
  id: number;
  public_id: string;
  status: 'active' | 'suspended' | 'banned' | 'frozen';
  session_live: number;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(claims: Pick<AccessTokenClaims, 'sub' | 'sid'>): string {
  return jwt.sign(claims, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_TTL as jwt.SignOptions['expiresIn'],
  });
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function verify(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      // Distinct from an invalid token: the client should refresh, not re-login.
      throw new AppError('token_expired', 'Your session has expired. Please sign in again.');
    }
    throw new AppError('token_invalid', 'Authentication token is not valid.');
  }
}

/**
 * Loads the user and, in the same round trip, checks that the session backing
 * this token is still live.
 *
 * Access tokens are short-lived but not instantly revocable on their own, so
 * "sign out this device" would otherwise keep working for up to the token TTL.
 * Joining the session row makes revocation take effect on the very next request
 * at the cost of nothing — this query was already being made.
 */
async function loadUser(claims: AccessTokenClaims): Promise<UserStatusRow> {
  const row = await queryOne<UserStatusRow>(
    `SELECT u.id, u.public_id, u.status,
            (s.id IS NOT NULL) AS session_live
       FROM users u
       LEFT JOIN user_sessions s
              ON s.id = :sessionId
             AND s.user_id = u.id
             AND s.revoked_at IS NULL
             AND s.expires_at > NOW(3)
      WHERE u.id = :userId AND u.deleted_at IS NULL`,
    { userId: claims.uid, sessionId: Number(claims.sid) },
  );
  if (!row) throw new AppError('token_invalid', 'Authentication token is not valid.');
  if (row.status === 'banned') {
    throw new AppError('account_banned', 'This account has been permanently banned.');
  }
  if (row.status === 'suspended') {
    throw new AppError('account_suspended', 'This account is currently suspended.');
  }
  if (Number(row.session_live) !== 1) {
    throw new AppError('token_invalid', 'This session has ended. Please sign in again.');
  }
  return row;
}

/** Rejects the request when there is no valid session. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  void (async () => {
    const token = readBearer(req);
    if (!token) throw new AppError('unauthenticated', 'Authentication required.');
    const claims = verify(token);
    const user = await loadUser(claims);
    const authed = req as AuthedRequest;
    authed.userId = user.id;
    authed.userPublicId = user.public_id;
    authed.sessionId = claims.sid;
  })()
    .then(() => next())
    .catch(next);
};

/**
 * Populates the session when a token is present but allows anonymous access.
 * Used by public reads that personalise when they can — the feed, a profile.
 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = readBearer(req);
  if (!token) return next();

  void (async () => {
    const claims = verify(token);
    const user = await loadUser(claims);
    const authed = req as AuthedRequest;
    authed.userId = user.id;
    authed.userPublicId = user.public_id;
    authed.sessionId = claims.sid;
  })()
    .then(() => next())
    // An expired or malformed token on an optional route degrades to anonymous
    // rather than failing the request.
    .catch(() => next());
};

export const currentUserId = (req: Request): number | undefined =>
  (req as Partial<AuthedRequest>).userId;

export function requireUserId(req: Request): number {
  const id = currentUserId(req);
  if (id === undefined) throw new AppError('unauthenticated', 'Authentication required.');
  return id;
}

export type { NextFunction, Response };
