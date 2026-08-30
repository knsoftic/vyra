/**
 * Verification, support and moderation routes.
 *
 * The split that matters here is between what an account may do about itself
 * and what staff may do about anyone. Every staff route sits behind
 * `requireAdmin`, and the two never share a handler — a single handler that
 * branches on role is how a permission check ends up on the wrong side of a
 * condition.
 */

import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { requireAdmin } from '../../middleware/rbac.ts';
import { recordSecurityEvent } from '../../core/security-log.ts';
import { queryOne } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import * as verification from './verification.service.ts';
import * as moderation from './moderation.service.ts';
import * as support from './support.service.ts';

export const trustRouter: Router = Router();

// ── Schemas ──

const verifySchema = z.object({
  tier: z.enum(['individual', 'creator', 'business']),
  documentKeys: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
});

const verifyDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'more_info']),
  note: z.string().trim().min(3).max(1000),
});

const revokeSchema = z.object({
  username: z.string().trim().min(1).max(30),
  reason: z.string().trim().min(3).max(500),
});

const ticketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  category: z.enum([
    'account',
    'payment',
    'coins',
    'video',
    'verification',
    'advertisement',
    'technical',
  ]),
  body: z.string().trim().min(10).max(5000),
});

const replySchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

const staffReplySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  /**
   * Explicit and required. The difference between writing to a user and
   * writing about them is not something to leave to a default.
   */
  internal: z.boolean(),
});

const ticketStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});

const decisionSchema = z.object({
  reportId: z.string().trim().max(64).optional(),
  targetType: z.enum(['user', 'video', 'comment', 'live', 'community', 'group', 'message']),
  targetId: z.string().trim().min(1).max(64),
  action: z.enum([
    'no_action',
    'warning',
    'content_removal',
    'restrict_distribution',
    'temporary_restriction',
    'suspension',
    'permanent_ban',
    'reinstate',
  ]),
  reason: z.string().trim().min(3).max(1000),
  durationHours: z.coerce.number().int().min(1).max(8760).optional(),
});

const revertSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const queueQuerySchema = z.object({
  status: z.string().trim().max(20).optional(),
  targetType: z.string().trim().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// ── Verification, for the applicant ──

trustRouter.get(
  '/me/verification',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await verification.myRequests(userId)));
  }),
);

trustRouter.post(
  '/me/verification',
  requireAuth,
  limits.write,
  validate({ body: verifySchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof verifySchema }>(req).body;
    const request = await verification.submitRequest(userId, body);

    await recordSecurityEvent(req, {
      userId,
      event: 'verification_requested',
      detail: `Requested ${body.tier} verification with ${body.documentKeys.length} document(s).`,
    });

    res.status(201).json(ok(request));
  }),
);

// ── Support, for the account holder ──

trustRouter.get(
  '/me/tickets',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await support.listTickets(userId)));
  }),
);

trustRouter.post(
  '/me/tickets',
  requireAuth,
  limits.write,
  validate({ body: ticketSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof ticketSchema }>(req).body;
    res.status(201).json(ok(await support.createTicket(userId, body)));
  }),
);

trustRouter.get(
  '/me/tickets/:id',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await support.getTicket(userId, String(req.params.id))));
  }),
);

trustRouter.post(
  '/me/tickets/:id/reply',
  requireAuth,
  limits.write,
  validate({ body: replySchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof replySchema }>(req).body;
    res.json(ok(await support.reply(userId, String(req.params.id), body.body)));
  }),
);

trustRouter.post(
  '/me/tickets/:id/close',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await support.closeTicket(userId, String(req.params.id))));
  }),
);

/** The outcome of a report the caller filed. The outcome only. */
trustRouter.get(
  '/me/reports/:id/outcome',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await moderation.reporterOutcome(userId, String(req.params.id))));
  }),
);

// ── Verification, for reviewers ──

trustRouter.get(
  '/admin/verification',
  requireAuth,
  requireAdmin,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await verification.reviewQueue()));
  }),
);

/**
 * A short-lived link to one identity document.
 *
 * The only route in the product that exposes one, and every use is written to
 * the security log against the subject's account.
 */
trustRouter.post(
  '/admin/verification/documents/:documentId/view',
  requireAuth,
  requireAdmin,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const documentId = Number(req.params.documentId);
    if (!Number.isInteger(documentId)) throw new AppError('bad_request', 'Invalid document.');
    res.json(ok(await verification.documentViewingLink(req, userId, documentId)));
  }),
);

trustRouter.post(
  '/admin/verification/:id',
  requireAuth,
  requireAdmin,
  limits.write,
  validate({ body: verifyDecisionSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof verifyDecisionSchema }>(req).body;
    const result = await verification.decide(
      userId,
      String(req.params.id),
      body.decision,
      body.note,
    );

    await recordSecurityEvent(req, {
      userId,
      event: 'verification_decided',
      detail: `Request ${String(req.params.id)} ${body.decision}.`,
    });

    res.json(ok(result));
  }),
);

trustRouter.post(
  '/admin/verification/revoke',
  requireAuth,
  requireAdmin,
  limits.write,
  validate({ body: revokeSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof revokeSchema }>(req).body;
    const result = await verification.revokeBadge(userId, body.username, body.reason);

    await recordSecurityEvent(req, {
      userId,
      event: 'verification_revoked',
      detail: `Revoked the badge on @${body.username}: ${body.reason}`,
    });

    res.json(ok(result));
  }),
);

// ── Moderation ──

trustRouter.get(
  '/admin/reports',
  requireAuth,
  requireAdmin,
  limits.read,
  validate({ query: queueQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = valid<{ query: typeof queueQuerySchema }>(req).query;
    res.json(ok(await moderation.reportQueue(q)));
  }),
);

trustRouter.get(
  '/admin/reports/:targetType/:targetId/context',
  requireAuth,
  requireAdmin,
  limits.read,
  asyncHandler(async (req, res) => {
    const targetId = Number(req.params.targetId);
    if (!Number.isInteger(targetId)) throw new AppError('bad_request', 'Invalid target.');
    res.json(
      ok(
        await moderation.reportContext(
          String(req.params.targetType) as moderation.ReportTargetType,
          targetId,
        ),
      ),
    );
  }),
);

trustRouter.post(
  '/admin/moderation',
  requireAuth,
  requireAdmin,
  limits.write,
  validate({ body: decisionSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof decisionSchema }>(req).body;

    // Targets arrive as public ids from the queue; the service works in row
    // ids, so the translation happens once, here.
    const targetId = await resolveTarget(body.targetType, body.targetId);

    const result = await moderation.decide({
      adminUserId: userId,
      targetType: body.targetType,
      targetId,
      action: body.action,
      reason: body.reason,
      ...(body.reportId ? { reportPublicId: body.reportId } : {}),
      ...(body.durationHours ? { durationHours: body.durationHours } : {}),
    });

    await recordSecurityEvent(req, {
      userId,
      event: 'moderation_action',
      detail: `${body.action} on ${body.targetType} ${body.targetId}: ${result.enforced}`,
    });

    res.json(ok(result));
  }),
);

trustRouter.post(
  '/admin/moderation/:actionId/revert',
  requireAuth,
  requireAdmin,
  limits.write,
  validate({ body: revertSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof revertSchema }>(req).body;
    const actionId = Number(req.params.actionId);
    if (!Number.isInteger(actionId)) throw new AppError('bad_request', 'Invalid action.');

    const result = await moderation.revert(userId, actionId, body.reason);

    await recordSecurityEvent(req, {
      userId,
      event: 'moderation_reverted',
      detail: `Reverted action ${actionId}: ${result.restored}`,
    });

    res.json(ok(result));
  }),
);

/** Public id to row id, for the one place that needs the translation. */
async function resolveTarget(targetType: string, publicId: string): Promise<number> {
  const table =
    targetType === 'user'
      ? 'users'
      : targetType === 'video'
        ? 'videos'
        : targetType === 'live'
          ? 'live_streams'
          : targetType === 'community'
            ? 'communities'
            : null;

  if (!table) {
    // Comments and messages are addressed by numeric id already.
    const numeric = Number(publicId);
    if (!Number.isInteger(numeric)) {
      throw new AppError('bad_request', 'Invalid target.');
    }
    return numeric;
  }

  const row = await queryOne<{ id: number }>(
    `SELECT id FROM ${table} WHERE public_id = :publicId`,
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'That target was not found.');
  return row.id;
}

// ── Support, for staff ──

trustRouter.get(
  '/admin/tickets',
  requireAuth,
  requireAdmin,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await support.staffQueue()));
  }),
);

trustRouter.get(
  '/admin/tickets/:id',
  requireAuth,
  requireAdmin,
  limits.read,
  asyncHandler(async (req, res) => {
    res.json(ok(await support.staffGetTicket(String(req.params.id))));
  }),
);

trustRouter.post(
  '/admin/tickets/:id/reply',
  requireAuth,
  requireAdmin,
  limits.write,
  validate({ body: staffReplySchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof staffReplySchema }>(req).body;
    res.json(
      ok(await support.staffReply(userId, String(req.params.id), body.body, body.internal)),
    );
  }),
);

trustRouter.post(
  '/admin/tickets/:id/status',
  requireAuth,
  requireAdmin,
  limits.write,
  validate({ body: ticketStatusSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof ticketStatusSchema }>(req).body;
    res.json(
      ok(await support.staffSetStatus(userId, String(req.params.id), body.status, body.priority)),
    );
  }),
);
