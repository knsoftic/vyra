/**
 * Authentication routes.
 *
 * Rate limits here are tighter than anywhere else in the API: these are the
 * endpoints an attacker hits in volume. `limits.auth` and `limits.otp` are keyed
 * by IP for anonymous calls, which is the only identity available before sign-in.
 */

import { Router } from 'express';
import { config } from '../../core/config.ts';
import { query } from '../../core/db.ts';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { recordSecurityEvent } from '../../core/security-log.ts';
import {
  changePasswordSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.schemas.ts';
import * as service from './auth.service.ts';
import { revokeSession } from './tokens.ts';
import type { SessionInfo } from '../../../../shared/contracts/user.ts';

export const authRouter: Router = Router();

authRouter.post(
  '/auth/register',
  limits.auth,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof registerSchema }>(req).body;
    const session = await service.register(req, body);
    res.status(201).json(ok(session));
  }),
);

authRouter.post(
  '/auth/login',
  limits.auth,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof loginSchema }>(req).body;
    const session = await service.login(req, body);
    res.json(ok(session));
  }),
);

authRouter.post(
  '/auth/refresh',
  limits.auth,
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    const { refreshToken } = valid<{ body: typeof refreshSchema }>(req).body;
    const tokens = await service.refresh(req, refreshToken);
    res.json(ok(tokens));
  }),
);

authRouter.post(
  '/auth/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    await service.logout(req, authed.userId, Number(authed.sessionId));
    res.json(ok({ loggedOut: true }));
  }),
);

authRouter.post(
  '/auth/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const result = await service.logoutAll(req, authed.userId);
    res.json(ok(result));
  }),
);

authRouter.post(
  '/auth/otp/request',
  limits.otp,
  validate({ body: otpRequestSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof otpRequestSchema }>(req).body;
    const result = await service.requestOtp(req, body.email, body.purpose, config.isProduction);
    res.json(ok(result));
  }),
);

authRouter.post(
  '/auth/otp/verify',
  limits.otp,
  validate({ body: otpVerifySchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof otpVerifySchema }>(req).body;
    const result = await service.confirmOtp(req, body.email, body.code, body.purpose);
    res.json(ok(result));
  }),
);

authRouter.post(
  '/auth/password/reset',
  limits.auth,
  validate({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof resetPasswordSchema }>(req).body;
    const result = await service.resetPassword(req, body);
    res.json(ok(result));
  }),
);

authRouter.post(
  '/auth/password/change',
  requireAuth,
  limits.auth,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof changePasswordSchema }>(req).body;
    const result = await service.changePassword(
      req,
      authed.userId,
      Number(authed.sessionId),
      body,
    );
    res.json(ok(result));
  }),
);

interface SessionRow {
  id: number;
  device_label: string | null;
  platform: string | null;
  user_agent: string | null;
  created_at: Date;
  last_seen_at: Date | null;
}

authRouter.get(
  '/auth/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const rows = await query<SessionRow>(
      `SELECT s.id, d.device_id AS device_label, d.platform, s.user_agent,
              s.created_at, d.last_seen_at
         FROM user_sessions s
         LEFT JOIN user_devices d ON d.id = s.device_id
        WHERE s.user_id = :userId AND s.revoked_at IS NULL AND s.expires_at > NOW(3)
        ORDER BY s.created_at DESC
        LIMIT 100`,
      { userId: authed.userId },
    );

    const sessions: SessionInfo[] = rows.map((r) => ({
      id: String(r.id),
      // The raw device identifier is not useful to a person; the user agent is.
      device: r.user_agent ?? r.device_label ?? 'Unknown device',
      platform: r.platform ?? 'unknown',
      isCurrent: String(r.id) === authed.sessionId,
      lastActiveAt: new Date(r.last_seen_at ?? r.created_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
    }));

    res.json(ok(sessions));
  }),
);

authRouter.delete(
  '/auth/sessions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId)) {
      res.status(400).json({
        ok: false,
        error: { code: 'bad_request', message: 'Invalid session id.' },
      });
      return;
    }

    // Scoped to the caller's own sessions, so one user cannot revoke another's.
    await revokeSession(sessionId, authed.userId, 'revoked_by_user');
    await recordSecurityEvent(req, {
      userId: authed.userId,
      event: 'session_revoked',
      detail: `Session ${sessionId} revoked by the account owner.`,
    });
    res.json(ok({ revoked: true }));
  }),
);
