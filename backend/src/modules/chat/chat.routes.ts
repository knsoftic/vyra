/**
 * Chat and group routes.
 *
 * Every route resolves membership before it does anything else, and the service
 * is the only place that decides. A route never checks a role itself — that is
 * how two routes end up disagreeing about who is an admin.
 *
 * Sends fan out over sockets after the write commits. A socket delivery that
 * fails is not an error the sender needs to see: the message is stored, and the
 * recipient's next fetch will find it.
 */

import { Router } from 'express';
import { ok } from '../../../../shared/contracts/http.ts';
import { SOCKET_EVENTS } from '../../../../shared/contracts/routes.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { emitToUser, emitToChat } from '../../socket.ts';
import * as chat from './chat.service.ts';
import {
  addMembersSchema,
  chatPageSchema,
  createGroupSchema,
  deleteMessageSchema,
  deliveredSchema,
  markReadSchema,
  muteSchema,
  openDirectSchema,
  sendMessageSchema,
  updateGroupSchema,
} from './chat.schemas.ts';

export const chatRouter: Router = Router();

/**
 * Auth is attached per route, not with `router.use`.
 *
 * `router.use(requireAuth)` runs for every request that reaches the router, not
 * only the ones whose path it handles — so an unknown path anywhere under the
 * API prefix was answered with "Authentication required" instead of 404. It
 * also puts a security decision somewhere you cannot see it from the route.
 */

// ── Conversations ──

chatRouter.get(
  '/chats',
  requireAuth,
  limits.read,
  validate({ query: chatPageSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const { cursor, limit } = valid<{ query: typeof chatPageSchema }>(req).query;
    const page = await chat.listChats(userId, cursor, limit);
    res.json(
      ok(page.items, {
        hasMore: page.hasMore,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }),
    );
  }),
);

/** Opens the conversation with one person, creating it the first time. */
chatRouter.post(
  '/chats/direct',
  requireAuth,
  limits.write,
  validate({ body: openDirectSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof openDirectSchema }>(req).body;
    res.json(ok(await chat.openDirectChat(userId, body.userId)));
  }),
);

chatRouter.post(
  '/chats/group',
  requireAuth,
  limits.write,
  validate({ body: createGroupSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof createGroupSchema }>(req).body;
    const created = await chat.createGroup(userId, body);

    // Everyone added learns about the group immediately rather than on next open.
    const membership = await chat.requireMembership(userId, created.id);
    const recipients = await chat.recipientsOf(membership.chatId, userId);
    for (const id of recipients) emitToUser(id, SOCKET_EVENTS.chatCreated, created);

    res.status(201).json(ok(created));
  }),
);

chatRouter.get(
  '/chats/:id',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await chat.getChat(userId, String(req.params.id))));
  }),
);

chatRouter.patch(
  '/chats/:id',
  requireAuth,
  limits.write,
  validate({ body: updateGroupSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof updateGroupSchema }>(req).body;
    const updated = await chat.updateGroup(userId, String(req.params.id), body);
    emitToChat(updated.id, SOCKET_EVENTS.chatUpdated, updated);
    res.json(ok(updated));
  }),
);

chatRouter.post(
  '/chats/:id/mute',
  requireAuth,
  limits.write,
  validate({ body: muteSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof muteSchema }>(req).body;
    res.json(ok(await chat.setMuted(userId, String(req.params.id), body.muted)));
  }),
);

// ── Members ──

chatRouter.post(
  '/chats/:id/members',
  requireAuth,
  limits.write,
  validate({ body: addMembersSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof addMembersSchema }>(req).body;
    const result = await chat.addMembers(userId, String(req.params.id), body.memberIds);
    const updated = await chat.getChat(userId, String(req.params.id));
    emitToChat(updated.id, SOCKET_EVENTS.chatUpdated, updated);
    res.json(ok(result));
  }),
);

chatRouter.delete(
  '/chats/:id/members/:userId',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const chatPublicId = String(req.params.id);
    const result = await chat.removeMember(userId, chatPublicId, String(req.params.userId));
    emitToChat(chatPublicId, SOCKET_EVENTS.chatUpdated, { id: chatPublicId });
    res.json(ok(result));
  }),
);

// ── Messages ──

chatRouter.get(
  '/chats/:id/messages',
  requireAuth,
  limits.read,
  validate({ query: chatPageSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const { cursor, limit } = valid<{ query: typeof chatPageSchema }>(req).query;
    const page = await chat.listMessages(userId, String(req.params.id), cursor, limit);
    res.json(
      ok(page.items, {
        hasMore: page.hasMore,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }),
    );
  }),
);

chatRouter.post(
  '/chats/:id/messages',
  requireAuth,
  limits.message,
  validate({ body: sendMessageSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof sendMessageSchema }>(req).body;
    const chatPublicId = String(req.params.id);

    const result = await chat.sendMessage(userId, chatPublicId, body);

    // A repeat of a send that already succeeded must not be delivered twice —
    // the recipient's device has it, and a second copy would be a new bubble.
    if (!result.duplicate) {
      emitToChat(chatPublicId, SOCKET_EVENTS.messageNew, result.message);
      // The chat room only reaches devices that have the conversation open; the
      // per-user room is what updates an inbox badge on a device that does not.
      for (const id of result.recipientIds) {
        emitToUser(id, SOCKET_EVENTS.messageNew, result.message);
      }
    }

    res.status(result.duplicate ? 200 : 201).json(ok(result.message));
  }),
);

chatRouter.post(
  '/chats/:id/read',
  requireAuth,
  limits.write,
  validate({ body: markReadSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof markReadSchema }>(req).body;
    const chatPublicId = String(req.params.id);

    const result = await chat.markRead(userId, chatPublicId, body.upToMessageId);

    // Senders in this conversation get their second tick.
    emitToChat(chatPublicId, SOCKET_EVENTS.messageRead, {
      chatId: chatPublicId,
      readerId: userId,
      upToMessageId: body.upToMessageId ?? null,
    });

    res.json(ok(result));
  }),
);

chatRouter.post(
  '/messages/delivered',
  requireAuth,
  limits.signals,
  validate({ body: deliveredSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof deliveredSchema }>(req).body;
    res.json(ok({ delivered: await chat.markDelivered(userId, body.messageIds) }));
  }),
);

chatRouter.delete(
  '/messages/:id',
  requireAuth,
  limits.write,
  validate({ query: deleteMessageSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const { forEveryone } = valid<{ query: typeof deleteMessageSchema }>(req).query;
    const result = await chat.deleteMessage(userId, String(req.params.id), forEveryone === true);

    if (result.forEveryone) {
      emitToChat(result.chatId, SOCKET_EVENTS.messageDeleted, {
        chatId: result.chatId,
        messageId: String(req.params.id),
      });
    }

    res.json(ok(result));
  }),
);
