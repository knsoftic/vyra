/**
 * Likes, saves and comments — the routes.
 *
 * Deliberately thin. Every rule that matters (idempotency, counter accuracy,
 * blocks, the author's comment setting) lives in the service, so a second route
 * added later cannot accidentally skip one.
 *
 * All of these require a session. An anonymous viewer can watch; interacting is
 * something an account does, and a like from nobody is a number with no meaning
 * behind it.
 */

import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import * as engagement from './engagement.service.ts';

export const engagementRouter: Router = Router();

// ── Likes ──

engagementRouter.post(
  '/videos/:id/like',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await engagement.likeVideo(userId, String(req.params.id))));
  }),
);

engagementRouter.delete(
  '/videos/:id/like',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await engagement.unlikeVideo(userId, String(req.params.id))));
  }),
);

// ── Saves ──

engagementRouter.post(
  '/videos/:id/save',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await engagement.saveVideo(userId, String(req.params.id))));
  }),
);

engagementRouter.delete(
  '/videos/:id/save',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await engagement.unsaveVideo(userId, String(req.params.id))));
  }),
);

engagementRouter.get(
  '/me/saved',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await engagement.savedVideos(userId)));
  }),
);

/**
 * Which of a page of videos the viewer has liked or saved.
 *
 * The feed asks once for the whole page rather than once per card.
 */
const stateSchema = z.object({
  videoIds: z.array(z.string().max(32)).min(1).max(50),
});

engagementRouter.post(
  '/videos/engagement-state',
  requireAuth,
  limits.read,
  validate({ body: stateSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof stateSchema }>(req).body;
    res.json(ok(await engagement.viewerState(userId, body.videoIds)));
  }),
);

// ── Comments ──

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

engagementRouter.get(
  '/videos/:id/comments',
  requireAuth,
  limits.read,
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const q = valid<{ query: typeof listQuerySchema }>(req).query;
    res.json(ok(await engagement.listComments(String(req.params.id), userId, q.limit)));
  }),
);

const addSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  parentId: z.string().max(32).optional(),
});

engagementRouter.post(
  '/videos/:id/comments',
  requireAuth,
  limits.write,
  validate({ body: addSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const input = valid<{ body: typeof addSchema }>(req).body;
    res.status(201).json(
      ok(await engagement.addComment(userId, String(req.params.id), input.body, input.parentId)),
    );
  }),
);

engagementRouter.get(
  '/comments/:id/replies',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await engagement.listReplies(String(req.params.id), userId)));
  }),
);

engagementRouter.delete(
  '/comments/:id',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await engagement.deleteComment(userId, String(req.params.id))));
  }),
);

engagementRouter.post(
  '/comments/:id/like',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await engagement.likeComment(userId, String(req.params.id))));
  }),
);

engagementRouter.delete(
  '/comments/:id/like',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await engagement.unlikeComment(userId, String(req.params.id))));
  }),
);
