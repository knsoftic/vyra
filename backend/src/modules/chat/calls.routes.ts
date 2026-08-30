/**
 * Call routes.
 *
 * The signalling endpoints relay an opaque payload to the other participants and
 * do nothing else with it. The server does not parse SDP or ICE, so it is never
 * a place where the shape of a call could be inspected.
 */

import { Router } from 'express';
import { ok } from '../../../../shared/contracts/http.ts';
import { SOCKET_EVENTS } from '../../../../shared/contracts/routes.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { emitToUser } from '../../socket.ts';
import * as calls from './calls.service.ts';
import { callSignalSchema, callStateSchema, startCallSchema } from './chat.schemas.ts';

export const callsRouter: Router = Router();

/**
 * Auth is attached per route, not with `router.use`.
 *
 * `router.use(requireAuth)` runs for every request that reaches the router, not
 * only the ones whose path it handles — so an unknown path anywhere under the
 * API prefix was answered with "Authentication required" instead of 404. It
 * also puts a security decision somewhere you cannot see it from the route.
 */

callsRouter.get(
  '/calls',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await calls.listCalls(userId)));
  }),
);

callsRouter.post(
  '/calls',
  requireAuth,
  limits.write,
  validate({ body: startCallSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof startCallSchema }>(req).body;

    // Sweep first: a call left ringing from a crashed session would otherwise
    // block this conversation from ever placing another.
    await calls.expireStaleRinging();

    const { call, calleeIds } = await calls.startCall(userId, body.chatId, body.kind);

    // Ringing is a per-user event: it has to reach every device the callee has
    // open, not only one with the conversation on screen.
    for (const id of calleeIds) emitToUser(id, SOCKET_EVENTS.callRinging, call);

    res.status(201).json(ok(call));
  }),
);

callsRouter.post(
  '/calls/:id/answer',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const callId = String(req.params.id);
    const others = await calls.otherParticipants(callId, userId);
    const call = await calls.answerCall(userId, callId);
    for (const id of others) emitToUser(id, SOCKET_EVENTS.callAnswer, call);
    res.json(ok(call));
  }),
);

callsRouter.post(
  '/calls/:id/decline',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const callId = String(req.params.id);
    const others = await calls.otherParticipants(callId, userId);
    const call = await calls.declineCall(userId, callId);
    for (const id of others) emitToUser(id, SOCKET_EVENTS.callEnd, call);
    res.json(ok(call));
  }),
);

callsRouter.post(
  '/calls/:id/end',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const callId = String(req.params.id);
    const others = await calls.otherParticipants(callId, userId);
    const call = await calls.endCall(userId, callId);
    for (const id of others) emitToUser(id, SOCKET_EVENTS.callEnd, call);
    res.json(ok(call));
  }),
);

callsRouter.post(
  '/calls/:id/state',
  requireAuth,
  limits.signals,
  validate({ body: callStateSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const callId = String(req.params.id);
    const body = valid<{ body: typeof callStateSchema }>(req).body;
    const others = await calls.otherParticipants(callId, userId);
    const state = await calls.setCallState(userId, callId, body);
    for (const id of others) {
      emitToUser(id, SOCKET_EVENTS.callState, { callId, userId: String(userId), ...state });
    }
    res.json(ok(state));
  }),
);

/**
 * WebRTC signalling.
 *
 * One route per signal type so the client's intent is explicit, but all three
 * do the same thing: check the sender is on the call, then hand the payload to
 * the other participants without looking at it.
 */
for (const [path, event] of [
  ['offer', SOCKET_EVENTS.callOffer],
  ['answer', SOCKET_EVENTS.callAnswer],
  ['ice', SOCKET_EVENTS.callIce],
] as const) {
  callsRouter.post(
    `/calls/:id/${path}`,
    requireAuth,
    limits.signals,
    validate({ body: callSignalSchema }),
    asyncHandler(async (req, res) => {
      const { userId } = req as AuthedRequest;
      const callId = String(req.params.id);
      const body = valid<{ body: typeof callSignalSchema }>(req).body;

      const others = await calls.otherParticipants(callId, userId);
      for (const id of others) {
        emitToUser(id, event, {
          callId,
          fromUserId: String(userId),
          payload: body.payload,
        });
      }

      res.json(ok({ relayed: others.length }));
    }),
  );
}
