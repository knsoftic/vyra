/**
 * Live streaming and gifting routes.
 *
 * Auth is attached per route rather than with `router.use`, which would answer
 * every unmatched path under the API prefix with 401 instead of 404.
 *
 * `POST /gifts` carries the `Idempotency-Key` requirement because it moves
 * money (ADR-020). Everything else here is either a read or an action whose
 * repeat is harmless.
 */

import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { SOCKET_EVENTS } from '../../../../shared/contracts/routes.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { idempotency } from '../../middleware/idempotency.ts';
import { requireAuth, optionalAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { requireAdmin } from '../../middleware/rbac.ts';
import { emitToStream, emitToUser } from '../../socket.ts';
import * as live from './live.service.ts';
import * as gifts from './gifts.service.ts';

export const liveRouter: Router = Router();

// ── Schemas ──

const startStreamSchema = z.object({
  title: z.string().trim().min(1).max(200),
  categoryId: z.string().trim().max(64).optional(),
  coverKey: z.string().trim().max(500).optional(),
  allowComments: z.boolean().optional(),
  allowGifts: z.boolean().optional(),
  allowGuests: z.boolean().optional(),
});

const commentSchema = z.object({
  body: z.string().trim().min(1).max(500),
});

const likeSchema = z.object({
  count: z.coerce.number().int().min(1).max(live.MAX_LIKES_PER_CALL).optional(),
});

const sendGiftSchema = z.object({
  giftId: z.string().trim().min(1).max(64),
  recipientId: z.string().trim().min(1).max(64),
  streamId: z.string().trim().max(64).optional(),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
});

const stopStreamSchema = z.object({
  reason: z.string().trim().min(3).max(200),
});

// ── Discovery ──

liveRouter.get(
  '/live',
  optionalAuth,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await live.listLive()));
  }),
);

liveRouter.get(
  '/live/mine',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await live.myStreams(userId)));
  }),
);

liveRouter.get(
  '/live/:id',
  optionalAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const viewerId = (req as Partial<AuthedRequest>).userId;
    res.json(ok(await live.getStream(String(req.params.id), viewerId)));
  }),
);

// ── Broadcasting ──

liveRouter.post(
  '/live',
  requireAuth,
  limits.write,
  validate({ body: startStreamSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof startStreamSchema }>(req).body;
    const started = await live.startStream(userId, body);
    // The credentials are in this response and nowhere else — the key is stored
    // hashed and cannot be read back.
    res.status(201).json(ok(started));
  }),
);

liveRouter.post(
  '/live/:id/end',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const streamId = String(req.params.id);
    const stream = await live.endStream(userId, streamId);
    emitToStream(streamId, { type: 'ended', reason: 'The host ended the stream.' });
    res.json(ok(stream));
  }),
);

liveRouter.get(
  '/live/:id/viewers',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await live.listViewers(String(req.params.id), userId)));
  }),
);

liveRouter.post(
  '/live/:id/viewers/:userId/ban',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const streamId = String(req.params.id);
    const result = await live.banViewer(streamId, userId, String(req.params.userId));
    res.json(ok(result));
  }),
);

// ── Watching ──

liveRouter.post(
  '/live/:id/join',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const streamId = String(req.params.id);
    const result = await live.joinStream(streamId, userId);
    emitToStream(streamId, { type: 'viewer_count', count: result.viewerCount });
    res.json(ok(result));
  }),
);

liveRouter.post(
  '/live/:id/leave',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const streamId = String(req.params.id);
    const result = await live.leaveStream(streamId, userId);
    emitToStream(streamId, { type: 'viewer_count', count: result.viewerCount });
    res.json(ok(result));
  }),
);

// ── Chat and likes ──

liveRouter.get(
  '/live/:id/comments',
  optionalAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    res.json(ok(await live.listComments(String(req.params.id))));
  }),
);

liveRouter.post(
  '/live/:id/comments',
  requireAuth,
  limits.message,
  validate({ body: commentSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const streamId = String(req.params.id);
    const body = valid<{ body: typeof commentSchema }>(req).body;
    const comment = await live.addComment(streamId, userId, body.body);
    emitToStream(streamId, { type: 'comment', comment });
    res.status(201).json(ok(comment));
  }),
);

liveRouter.post(
  '/live/:id/likes',
  requireAuth,
  limits.signals,
  validate({ body: likeSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const streamId = String(req.params.id);
    const body = valid<{ body: typeof likeSchema }>(req).body;
    const result = await live.addLikes(streamId, userId, body.count ?? 1);
    emitToStream(streamId, { type: 'like', count: result.likeCount });
    res.json(ok(result));
  }),
);

// ── Gifts ──

liveRouter.get(
  '/gifts',
  requireAuth,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await gifts.listGifts()));
  }),
);

/** Everything the gift-earnings screen needs, aggregated server-side. */
liveRouter.get(
  '/me/gift-earnings',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const days = Number(req.query.days ?? 28);
    res.json(ok(await gifts.giftEarnings(userId, Number.isFinite(days) ? days : 28)));
  }),
);

liveRouter.get(
  '/gifts/history',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await gifts.giftHistory(userId)));
  }),
);

/**
 * Sends a gift.
 *
 * `idempotent` runs before the handler and refuses a request with no key, so a
 * double-tap or a retried request cannot charge twice. The database carries the
 * same key as a backstop, which is what holds when the cache is unavailable.
 */
liveRouter.post(
  '/gifts',
  requireAuth,
  limits.money,
  // `durable` because `gift_transactions` carries the same key under a unique
  // index: the guarantee survives the cache being unavailable, so refusing the
  // request would protect against nothing (ADR-032).
  idempotency({ durable: true }),
  validate({ body: sendGiftSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof sendGiftSchema }>(req).body;
    const key = req.header('idempotency-key') ?? '';

    const result = await gifts.sendGift({
      senderId: userId,
      giftId: body.giftId,
      recipientPublicId: body.recipientId,
      quantity: body.quantity,
      idempotencyKey: key,
      ...(body.streamId ? { streamPublicId: body.streamId } : {}),
    });

    // A replay must not announce the gift a second time: the animation already
    // played and the creator was already told.
    if (!result.duplicate) {
      if (result.streamId && body.streamId) {
        emitToStream(body.streamId, {
          type: 'gift',
          gift: result.gift,
          quantity: result.quantity,
          coins: result.coinsSpent,
        });
      }
      emitToUser(result.recipientId, SOCKET_EVENTS.walletUpdated, {
        reason: 'gift_received',
        coins: result.coinsToCreator,
      });
    }

    res.status(result.duplicate ? 200 : 201).json(ok(result));
  }),
);

// ── Moderation ──

liveRouter.post(
  '/admin/live/:id/stop',
  requireAuth,
  requireAdmin,
  limits.write,
  validate({ body: stopStreamSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const streamId = String(req.params.id);
    const body = valid<{ body: typeof stopStreamSchema }>(req).body;

    const stream = await live.stopStreamAsAdmin(streamId, userId, body.reason);
    emitToStream(streamId, { type: 'ended', reason: body.reason });

    res.json(ok(stream));
  }),
);
