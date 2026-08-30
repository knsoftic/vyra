/**
 * Behaviour routes.
 *
 * One ingestion endpoint, plus read-only views of what the platform has inferred.
 *
 * Those read endpoints exist deliberately. A user is entitled to see the profile
 * built from their behaviour, and being able to answer "why am I seeing this"
 * with real data — rather than a guess — is what keeps the recommendation
 * system debuggable once it is live.
 */

import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, currentUserId, type AuthedRequest } from '../../middleware/auth.ts';
import { AppError } from '../../core/errors.ts';
import { queryOne } from '../../core/db.ts';
import { logger } from '../../core/logger.ts';
import { inspectPayload } from './privacy.ts';
import { ALL_EVENTS } from '../../../../shared/contracts/behaviour.ts';
import * as events from './events.service.ts';
import * as profiles from './profiles.service.ts';

export const behaviourRouter: Router = Router();

const eventSchema = z.object({
  event: z.enum(ALL_EVENTS),
  dedupeKey: z.string().min(1).max(128),
  occurredAt: z.string().min(4),
  sessionId: z.string().max(26).optional(),
  videoId: z.string().max(32).optional(),
  creatorId: z.string().max(32).optional(),
  categoryId: z.string().max(32).optional(),
  hashtagId: z.string().max(32).optional(),
  feedSource: z.enum([
    'for_you', 'following', 'trending', 'category',
    'search', 'profile', 'promoted', 'sound', 'hashtag',
  ]).optional(),
  watchMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
  videoMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
  appVersion: z.string().max(20).optional(),
  deviceTier: z.enum(['low', 'mid', 'high']).optional(),
  rank: z.number().int().min(0).max(10000).optional(),
  query: z.string().max(200).optional(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(200),
});

/**
 * Screens the raw body for sensitive fields before validation strips them.
 *
 * Zod removes unknown keys, which protects the data — but it also means a client
 * sending `email` or `latitude` would be silently cleaned up and nobody would
 * ever find out. The allowlist is the protection; this is the alarm. It runs
 * first precisely because the parse would otherwise erase the evidence.
 */
const screenRawPayload: RequestHandler = (req, _res, next) => {
  const body = req.body as { events?: unknown } | undefined;
  if (!body || !Array.isArray(body.events)) return next();

  const offending = new Set<string>();
  for (const raw of body.events) {
    if (typeof raw !== 'object' || raw === null) continue;
    const verdict = inspectPayload(raw as Record<string, unknown>);
    for (const field of verdict.forbidden) offending.add(field);
  }

  if (offending.size > 0) {
    const fields = [...offending].join(', ');
    logger.warn(
      { userId: currentUserId(req), fields },
      'event batch rejected: payload carried fields that must never be sent',
    );
    next(
      new AppError(
        'validation_failed',
        `Events must never carry these fields: ${fields}.`,
        { details: { events: [`Remove: ${fields}.`] } },
      ),
    );
    return;
  }
  next();
};

behaviourRouter.post(
  '/events',
  requireAuth,
  limits.signals,
  screenRawPayload,
  validate({ body: batchSchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof batchSchema }>(req).body;
    const result = await events.ingest(authed.userId, body.events);
    res.json(ok(result));
  }),
);

/** The caller's own interest profile. */
behaviourRouter.get(
  '/me/interests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const interests = await profiles.getInterests(authed.userId);
    res.json(ok({
      ...interests,
      top: profiles.topTopics(interests.combined, 20),
    }));
  }),
);

behaviourRouter.get(
  '/me/segments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    res.json(ok(await profiles.getSegments(authed.userId)));
  }),
);

behaviourRouter.get(
  '/me/creator-affinity',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    res.json(ok(await profiles.getCreatorAffinity(authed.userId)));
  }),
);

/**
 * Rebuilds the caller's profiles immediately.
 *
 * Normally the worker does this on a schedule; this exists so the effect of a
 * signal can be observed straight away rather than waiting for a poll.
 */
behaviourRouter.post(
  '/me/interests/rebuild',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const result = await profiles.rebuildAll(authed.userId);
    await events.markRebuilt(authed.userId);
    res.json(ok({
      interests: result.interests,
      segments: result.segments,
      creatorsScored: result.creators,
    }));
  }),
);

/** Which audiences a video actually reached. Owner only. */
behaviourRouter.get(
  '/videos/:id/audience',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const video = await queryOne<{ id: number; user_id: number }>(
      'SELECT id, user_id FROM videos WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: String(req.params.id) },
    );
    if (!video || video.user_id !== authed.userId) {
      throw new AppError('not_found', 'Video not found.');
    }
    res.json(ok(await profiles.getVideoAudience(video.id)));
  }),
);
