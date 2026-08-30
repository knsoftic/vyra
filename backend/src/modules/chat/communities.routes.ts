/**
 * Community routes.
 *
 * The interesting one is `GET /communities/:id/members`. It returns a different
 * list depending on who is asking (ADR-014), and says so in `restricted` rather
 * than quietly returning four people and letting the client think that is the
 * whole community.
 */

import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import * as communities from './communities.service.ts';
import {
  chatPageSchema,
  createCommunitySchema,
  decideRequestSchema,
  joinCommunitySchema,
  memberModerationSchema,
  memberRoleSchema,
  updateCommunitySchema,
} from './chat.schemas.ts';

export const communitiesRouter: Router = Router();

/**
 * Auth is attached per route, not with `router.use`.
 *
 * `router.use(requireAuth)` runs for every request that reaches the router, not
 * only the ones whose path it handles — so an unknown path anywhere under the
 * API prefix was answered with "Authentication required" instead of 404. It
 * also puts a security decision somewhere you cannot see it from the route.
 */

const listQuerySchema = chatPageSchema.extend({
  mine: z.coerce.boolean().optional(),
  q: z.string().trim().min(1).max(80).optional(),
});

communitiesRouter.get(
  '/communities',
  requireAuth,
  limits.read,
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const { cursor, limit, mine, q } = valid<{ query: typeof listQuerySchema }>(req).query;
    const page = await communities.listCommunities(
      userId,
      { ...(mine ? { mine } : {}), ...(q ? { q } : {}) },
      cursor,
      limit,
    );
    res.json(
      ok(page.items, {
        hasMore: page.hasMore,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }),
    );
  }),
);

communitiesRouter.post(
  '/communities',
  requireAuth,
  limits.write,
  validate({ body: createCommunitySchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof createCommunitySchema }>(req).body;
    res.status(201).json(ok(await communities.createCommunity(userId, body)));
  }),
);

communitiesRouter.get(
  '/communities/:id',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await communities.getCommunity(String(req.params.id), userId)));
  }),
);

communitiesRouter.patch(
  '/communities/:id',
  requireAuth,
  limits.write,
  validate({ body: updateCommunitySchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof updateCommunitySchema }>(req).body;
    res.json(ok(await communities.updateCommunity(userId, String(req.params.id), body)));
  }),
);

// ── Membership ──

communitiesRouter.post(
  '/communities/:id/join',
  requireAuth,
  limits.write,
  validate({ body: joinCommunitySchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof joinCommunitySchema }>(req).body;
    res.json(ok(await communities.joinCommunity(userId, String(req.params.id), body.message)));
  }),
);

communitiesRouter.post(
  '/communities/:id/leave',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await communities.leaveCommunity(userId, String(req.params.id))));
  }),
);

/** Staff see the roster; everyone else sees the staff (ADR-014). */
communitiesRouter.get(
  '/communities/:id/members',
  requireAuth,
  limits.read,
  validate({ query: chatPageSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const { cursor, limit } = valid<{ query: typeof chatPageSchema }>(req).query;
    const page = await communities.listMembers(String(req.params.id), userId, cursor, limit);
    res.json(
      ok(page.items, {
        hasMore: page.hasMore,
        // Named so the client can label the list honestly rather than implying
        // the community has only these people in it.
        restricted: page.restricted,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }),
    );
  }),
);

communitiesRouter.patch(
  '/communities/:id/members/:userId',
  requireAuth,
  limits.write,
  validate({ body: memberRoleSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof memberRoleSchema }>(req).body;
    res.json(
      ok(
        await communities.setMemberRole(
          userId,
          String(req.params.id),
          String(req.params.userId),
          body.role,
        ),
      ),
    );
  }),
);

communitiesRouter.post(
  '/communities/:id/members/:userId/moderate',
  requireAuth,
  limits.write,
  validate({ body: memberModerationSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof memberModerationSchema }>(req).body;
    res.json(
      ok(
        await communities.moderateMember(
          userId,
          String(req.params.id),
          String(req.params.userId),
          body,
        ),
      ),
    );
  }),
);

// ── Join requests ──

communitiesRouter.get(
  '/communities/:id/requests',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await communities.listJoinRequests(String(req.params.id), userId)));
  }),
);

communitiesRouter.post(
  '/communities/:id/requests/:requestId',
  requireAuth,
  limits.write,
  validate({ body: decideRequestSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof decideRequestSchema }>(req).body;
    res.json(
      ok(
        await communities.decideJoinRequest(
          userId,
          String(req.params.id),
          String(req.params.requestId),
          body.approve,
        ),
      ),
    );
  }),
);
