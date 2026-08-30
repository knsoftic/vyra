/**
 * Profile, settings and social graph routes.
 *
 * Every mutation is scoped to the authenticated caller — the user id comes from
 * the token, never from the request body or path. That is what makes
 * object-level authorization automatic here rather than something each handler
 * has to remember.
 */

import { Router, type Request } from 'express';
import { query } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { optionalAuth, requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { recordSecurityEvent } from '../../core/security-log.ts';
import {
  businessProfileSchema,
  pageQuerySchema,
  privacySchema,
  reportSchema,
  switchAccountTypeSchema,
  updateProfileSchema,
  usernameQuerySchema,
} from '../auth/auth.schemas.ts';
import * as users from './users.service.ts';
import { checkUsername } from './username.ts';
import * as social from '../social/social.service.ts';
import type { SecurityEvent } from '../../../../shared/contracts/user.ts';

export const usersRouter: Router = Router();

// ── The caller's own account ──

usersRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    res.json(ok(await users.getPrivateUser(authed.userId)));
  }),
);

usersRouter.patch(
  '/me',
  requireAuth,
  limits.write,
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof updateProfileSchema }>(req).body;
    res.json(ok(await users.updateProfile(authed.userId, body)));
  }),
);

usersRouter.patch(
  '/me/privacy',
  requireAuth,
  limits.write,
  validate({ body: privacySchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof privacySchema }>(req).body;
    const privacy = await users.updatePrivacy(authed.userId, body);
    await recordSecurityEvent(req, {
      userId: authed.userId,
      event: 'privacy_changed',
      detail: Object.keys(body).join(', '),
    });
    res.json(ok(privacy));
  }),
);

usersRouter.post(
  '/me/account-type',
  requireAuth,
  limits.write,
  validate({ body: switchAccountTypeSchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof switchAccountTypeSchema }>(req).body;
    const user = await users.switchAccountType(authed.userId, body.category, body.type);
    await recordSecurityEvent(req, {
      userId: authed.userId,
      event: 'account_type_changed',
      detail: `${body.category}/${body.type}`,
    });
    res.json(ok(user));
  }),
);

usersRouter.patch(
  '/me/business',
  requireAuth,
  limits.write,
  validate({ body: businessProfileSchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof businessProfileSchema }>(req).body;
    res.json(ok(await users.updateBusinessProfile(authed.userId, body)));
  }),
);

/** The account activity list the user can see for themselves. */
usersRouter.get(
  '/me/security-events',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const rows = await query<{
      id: number;
      event: string;
      outcome: SecurityEvent['outcome'];
      detail: string | null;
      user_agent: string | null;
      created_at: Date;
    }>(
      `SELECT id, event, outcome, detail, user_agent, created_at
         FROM security_events
        WHERE user_id = :userId
        ORDER BY id DESC
        LIMIT 100`,
      { userId: authed.userId },
    );

    const events: SecurityEvent[] = rows.map((r) => ({
      id: String(r.id),
      event: r.event,
      outcome: r.outcome,
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.user_agent ? { device: r.user_agent } : {}),
      createdAt: new Date(r.created_at).toISOString(),
    }));
    res.json(ok(events));
  }),
);

usersRouter.get(
  '/me/blocked',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    res.json(ok(await social.listBlocked(authed.userId)));
  }),
);

// ── Username availability ──

usersRouter.get(
  '/users/check-username',
  optionalAuth,
  limits.read,
  validate({ query: usernameQuerySchema }),
  asyncHandler(async (req, res) => {
    const { username } = valid<{ query: typeof usernameQuerySchema }>(req).query;
    const viewerId = (req as Partial<AuthedRequest>).userId;
    res.json(ok(await checkUsername(username, viewerId)));
  }),
);

// ── Other people ──

usersRouter.get(
  '/users/:username',
  optionalAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const username = String(req.params.username ?? '');
    const viewerId = (req as Partial<AuthedRequest>).userId;
    res.json(ok(await users.getPublicUser(username, viewerId)));
  }),
);

/**
 * Resolves the `:id` path parameter (a public ULID) to an internal row id.
 * Express types a param as `string | string[]`, so a repeated parameter is
 * rejected rather than silently coerced.
 */
async function targetIdFrom(req: Request): Promise<number> {
  const publicId = req.params.id;
  if (typeof publicId !== 'string' || publicId.length === 0) {
    throw new AppError('not_found', 'Account not found.');
  }
  return users.resolveUserId(publicId);
}

for (const direction of ['followers', 'following'] as const) {
  usersRouter.get(
    `/users/:id/${direction}`,
    optionalAuth,
    limits.read,
    validate({ query: pageQuerySchema }),
    asyncHandler(async (req, res) => {
      const targetId = await targetIdFrom(req);
      const viewerId = (req as Partial<AuthedRequest>).userId;
      const { cursor, limit } = valid<{ query: typeof pageQuerySchema }>(req).query;
      const page = await users.listGraph(targetId, direction, viewerId, cursor, limit);
      res.json(ok(page.items, { hasMore: page.hasMore, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }));
    }),
  );
}

usersRouter.post(
  '/users/:id/follow',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const targetId = await targetIdFrom(req);
    res.json(ok(await social.follow(authed.userId, targetId)));
  }),
);

usersRouter.delete(
  '/users/:id/follow',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const targetId = await targetIdFrom(req);
    res.json(ok(await social.unfollow(authed.userId, targetId)));
  }),
);

usersRouter.post(
  '/users/:id/block',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const targetId = await targetIdFrom(req);
    const result = await social.block(authed.userId, targetId);
    await recordSecurityEvent(req, {
      userId: authed.userId,
      event: 'user_blocked',
      detail: `Blocked user ${req.params.id}.`,
    });
    res.json(ok(result));
  }),
);

usersRouter.delete(
  '/users/:id/block',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const targetId = await targetIdFrom(req);
    const result = await social.unblock(authed.userId, targetId);
    await recordSecurityEvent(req, {
      userId: authed.userId,
      event: 'user_unblocked',
      detail: `Unblocked user ${req.params.id}.`,
    });
    res.json(ok(result));
  }),
);

// ── Reports ──

/**
 * The reports the caller has filed.
 *
 * Someone who reports content is entitled to know what happened to it — that is
 * the difference between a report and a suggestion box. Only the caller's own
 * reports, and only the outcome, never who reviewed it.
 */
usersRouter.get(
  '/me/reports',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;

    const rows = await query<{
      public_id: string;
      target_type: string;
      reason: string;
      detail: string | null;
      status: string;
      created_at: Date;
      decided_at: Date | null;
    }>(
      `SELECT public_id, target_type, reason, detail, status, created_at, decided_at
         FROM reports
        WHERE reporter_id = :userId AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 50`,
      { userId: authed.userId },
    );

    // The stored statuses are the moderation queue's vocabulary; the client
    // speaks a user-facing one. Mapping here keeps the queue free to rename its
    // own states without changing what people are shown.
    const statusFor = (status: string): string => {
      switch (status) {
        case 'pending':
          return 'submitted';
        case 'reviewing':
          return 'reviewing';
        case 'actioned':
          return 'action_taken';
        default:
          return 'no_action';
      }
    };

    res.json(
      ok(
        rows.map((r) => ({
          id: r.public_id,
          targetType: r.target_type,
          reason: r.reason,
          detail: r.detail ?? undefined,
          status: statusFor(r.status),
          createdAt: new Date(r.created_at).toISOString(),
          ...(r.decided_at ? { decidedAt: new Date(r.decided_at).toISOString() } : {}),
        })),
      ),
    );
  }),
);


usersRouter.post(
  '/reports',
  requireAuth,
  limits.write,
  validate({ body: reportSchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof reportSchema }>(req).body;

    // Reports carry a public id; resolve it to the internal row the queue reads.
    const targetId =
      body.targetType === 'user' ? await users.resolveUserId(body.targetId) : Number(body.targetId);

    if (!Number.isFinite(targetId)) {
      throw new AppError('bad_request', 'Invalid report target.');
    }

    const result = await social.report(authed.userId, {
      targetType: body.targetType,
      targetId,
      reason: body.reason,
      ...(body.detail ? { detail: body.detail } : {}),
    });
    res.status(201).json(ok(result));
  }),
);
