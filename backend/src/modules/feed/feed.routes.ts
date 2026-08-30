/**
 * Feed and ranking-admin routes.
 *
 * The admin half matters as much as the feed itself: PHASE_07 exit criterion 5
 * requires that changing a weight changes the feed without a deploy and writes
 * an audit record. Both halves of that are enforced here — the write drops the
 * cache so the change is immediate, and it is refused if the audit cannot be
 * attributed.
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { queryOne } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { requireAdmin, requirePermission, currentAdmin } from '../../middleware/rbac.ts';
import { audit } from '../../middleware/audit.ts';
import { buildFeed, hydrateFeed } from './feed.service.ts';
import { listWeights, setWeight, seedWeights } from './weights.ts';
import { mlStatus } from './ml-client.ts';
import * as distribution from './distribution.ts';

export const feedRouter: Router = Router();

const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  sessionId: z.string().max(26).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
});

feedRouter.get(
  '/feed',
  requireAuth,
  limits.read,
  validate({ query: feedQuerySchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const q = valid<{ query: typeof feedQuerySchema }>(req).query;

    const result = await buildFeed(authed.userId, {
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.sessionId ? { sessionId: q.sessionId } : {}),
      ...(q.categoryId !== undefined ? { categoryId: q.categoryId } : {}),
    });

    const videos = await hydrateFeed(result.items);

    res.json(
      ok({
        items: videos,
        sessionId: result.sessionId,
        // Which ranker served this. Useful in the client only for diagnostics,
        // and honest about degraded service rather than hiding it.
        ranker: result.ranker,
      }),
    );
  }),
);

/**
 * The same feed with its full reasoning attached.
 *
 * Admin-only. "Why is this video ranked here" needs a real answer, and the
 * per-stage timings are what make a latency regression diagnosable.
 */
feedRouter.get(
  '/admin/feed/explain',
  requireAuth,
  requireAdmin,
  requirePermission('recommendation', 'view'),
  validate({ query: feedQuerySchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const q = valid<{ query: typeof feedQuerySchema }>(req).query;
    const result = await buildFeed(authed.userId, {
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
    res.json(ok(result));
  }),
);

// ── Ranking weights ──

feedRouter.get(
  '/admin/ranking/weights',
  requireAuth,
  requireAdmin,
  requirePermission('recommendation', 'view'),
  asyncHandler(async (_req, res) => {
    res.json(ok(await listWeights()));
  }),
);

const setWeightSchema = z.object({
  value: z.number(),
  reason: z.string().min(1).max(500),
});

/**
 * Changes one ranking weight.
 *
 * The reason is required, not optional. A ranking change alters what millions of
 * people see; six months later "who changed this and why" has to have an answer,
 * and an audit row with an empty reason does not provide one.
 */
feedRouter.patch(
  '/admin/ranking/weights/:key',
  requireAuth,
  requireAdmin,
  requirePermission('recommendation', 'update'),
  validate({ body: setWeightSchema }),
  asyncHandler(async (req: Request, res) => {
    const body = valid<{ body: typeof setWeightSchema }>(req).body;
    const key = String(req.params.key);
    const admin = currentAdmin(req);

    const { previous, next } = await setWeight(key, body.value, admin.adminId ?? null);

    await audit(req, {
      module: 'recommendation',
      action: 'weight_changed',
      targetType: 'ranking_weight',
      targetId: key,
      oldValue: { value: previous },
      newValue: { value: next },
      reason: body.reason,
    });

    res.json(ok({ key, previous, value: next }));
  }),
);

feedRouter.post(
  '/admin/ranking/weights/seed',
  requireAuth,
  requireAdmin,
  requirePermission('recommendation', 'update'),
  asyncHandler(async (req: Request, res) => {
    const written = await seedWeights(false);
    await audit(req, {
      module: 'recommendation',
      action: 'weights_seeded',
      newValue: { written },
      reason: 'Seeded missing ranking weights.',
    });
    res.json(ok({ written }));
  }),
);

/** Ranker health, including whether the ML service is currently reachable. */
feedRouter.get(
  '/admin/ranking/status',
  requireAuth,
  requireAdmin,
  requirePermission('recommendation', 'view'),
  asyncHandler(async (_req, res) => {
    res.json(ok({ ml: mlStatus(), thresholds: distribution.LEVEL_THRESHOLDS }));
  }),
);

// ── Progressive distribution ──

/** A creator's own view of how far their video has travelled. */
feedRouter.get(
  '/videos/:id/distribution',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const video = await queryOne<{ id: number; user_id: number; distribution_level: number }>(
      'SELECT id, user_id, distribution_level FROM videos WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: String(req.params.id) },
    );
    if (!video || video.user_id !== authed.userId) {
      throw new AppError('not_found', 'Video not found.');
    }

    const level = Number(video.distribution_level ?? 1);
    const threshold = distribution.LEVEL_THRESHOLDS.find((t) => t.level === level);

    res.json(
      ok({
        level,
        label: threshold?.label ?? 'Test audience',
        history: await distribution.history(video.id),
      }),
    );
  }),
);

const evaluateSchema = z.object({ reason: z.string().min(1).max(500) });

feedRouter.post(
  '/admin/videos/:id/evaluate-distribution',
  requireAuth,
  requireAdmin,
  requirePermission('videos', 'update'),
  validate({ body: evaluateSchema }),
  asyncHandler(async (req: Request, res) => {
    const body = valid<{ body: typeof evaluateSchema }>(req).body;
    const video = await queryOne<{ id: number }>(
      'SELECT id FROM videos WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: String(req.params.id) },
    );
    if (!video) throw new AppError('not_found', 'Video not found.');

    const verdict = await distribution.evaluateAndApply(video.id);
    await audit(req, {
      module: 'videos',
      action: 'distribution_evaluated',
      targetType: 'video',
      targetId: String(req.params.id),
      newValue: { decision: verdict.decision, level: verdict.toLevel },
      reason: body.reason,
    });

    res.json(ok(verdict));
  }),
);
