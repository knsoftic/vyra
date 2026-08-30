/**
 * Realtime gateway.
 *
 * Socket.IO shares the HTTP server. Every connection authenticates with the same
 * access token as the REST API — an unauthenticated socket is disconnected
 * rather than left idle, so presence and delivery counts stay honest.
 *
 * Each user joins a private room named for their id, which is how a message,
 * notification or wallet update reaches every device that user has open.
 */

import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from './core/config.ts';
import { logger } from './core/logger.ts';
import { keys } from './core/redis.ts';
import { cache } from './core/cache.ts';
import { SOCKET_EVENTS } from '../../shared/contracts/routes.ts';
import { chatRoomsFor, requireMembership } from './modules/chat/chat.service.ts';
import type { AccessTokenClaims } from './middleware/auth.ts';

export interface SocketUser {
  userId: number;
  sessionId: string;
}

type AuthedSocket = Socket & { user: SocketUser };

export const userRoom = (userId: number) => `user:${userId}`;
export const streamRoom = (streamId: string) => `live:${streamId}`;
export const chatRoom = (chatId: string) => `chat:${chatId}`;

let io: SocketServer | null = null;


/**
 * Tells this user's conversations that they came online or went offline.
 *
 * Presence is only broadcast into rooms the user is already a member of, so it
 * reaches the people they talk to and nobody else. Someone who has blocked them
 * shares no room with them, and so is never told.
 */
async function broadcastPresence(userId: number, online: boolean): Promise<void> {
  try {
    const rooms = await chatRoomsFor(userId);
    for (const room of rooms) {
      io?.to(chatRoom(room)).emit(SOCKET_EVENTS.presence, {
        userId: String(userId),
        online,
        at: new Date().toISOString(),
      });
    }
  } catch {
    // Presence is a nicety; failing to announce it is not worth an error path.
  }
}

export function createSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: config.CORS_ORIGINS, credentials: true },
    // Long enough to survive a tunnel change, short enough that presence is not
    // stale for minutes after someone closes the app.
    pingTimeout: 20000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth as { token?: string } | undefined)?.token ??
      socket.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) return next(new Error('unauthenticated'));

    try {
      const claims = jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenClaims;
      (socket as AuthedSocket).user = { userId: claims.uid, sessionId: claims.sid };
      next();
    } catch {
      next(new Error('token_invalid'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket as AuthedSocket;
    void socket.join(userRoom(user.userId));
    void cache.sadd(keys.onlineUsers(), user.userId);

    logger.debug({ userId: user.userId, socketId: socket.id }, 'socket connected');
    socket.emit(SOCKET_EVENTS.connected, { userId: user.userId });

    /**
     * Join every conversation this user belongs to.
     *
     * Rooms are joined from the database, never from a room name the client
     * asks for. A client-named room would let anyone type a chat id and listen
     * to a conversation they are not in — the socket layer has no other
     * authorisation check, so this is the whole of it.
     */
    void chatRoomsFor(user.userId)
      .then((rooms) => {
        for (const room of rooms) void socket.join(chatRoom(room));
      })
      .catch(() => undefined);

    // Announce presence to the people who have a conversation open with them.
    void broadcastPresence(user.userId, true);

    /**
     * Typing indicators.
     *
     * Never stored: a typing state that outlives the socket is worse than none,
     * and there is nothing to learn from it later. Membership is re-checked on
     * every emit rather than trusted from the join, because someone removed from
     * a group keeps their socket until they reconnect.
     */
    socket.on(SOCKET_EVENTS.typing, (payload: unknown) => {
      const chatId = (payload as { chatId?: string } | undefined)?.chatId;
      const isTyping = (payload as { isTyping?: boolean } | undefined)?.isTyping ?? true;
      if (typeof chatId !== 'string') return;

      void requireMembership(user.userId, chatId)
        .then(() => {
          socket.to(chatRoom(chatId)).emit(SOCKET_EVENTS.typing, {
            chatId,
            userId: String(user.userId),
            isTyping,
          });
        })
        .catch(() => undefined);
    });

    // A chat created while this socket was open is not in the joined set yet.
    socket.on(SOCKET_EVENTS.chatJoin, (chatId: unknown) => {
      if (typeof chatId !== 'string') return;
      void requireMembership(user.userId, chatId)
        .then(() => socket.join(chatRoom(chatId)))
        .catch(() => undefined);
    });

    socket.on(SOCKET_EVENTS.chatLeave, (chatId: unknown) => {
      if (typeof chatId !== 'string') return;
      void socket.leave(chatRoom(chatId));
    });

    socket.on(SOCKET_EVENTS.liveJoin, (streamId: string) => {
      if (typeof streamId !== 'string') return;
      void socket.join(streamRoom(streamId));
      void cache.sadd(keys.liveViewers(streamId), user.userId);
    });

    socket.on(SOCKET_EVENTS.liveLeave, (streamId: string) => {
      if (typeof streamId !== 'string') return;
      void socket.leave(streamRoom(streamId));
      void cache.srem(keys.liveViewers(streamId), user.userId);
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ userId: user.userId, reason }, 'socket disconnected');
      // Only clear presence when this was the user's last open socket.
      void io?.in(userRoom(user.userId))
        .fetchSockets()
        .then((remaining) => {
          if (remaining.length === 0) {
            void cache.srem(keys.onlineUsers(), user.userId);
            void broadcastPresence(user.userId, false);
          }
        })
        .catch(() => undefined);
    });
  });

  return io;
}

/** Pushes an event to every device a user has open. No-op before the server starts. */
export function emitToUser(userId: number, event: string, payload: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}

export function emitToStream(streamId: string, payload: unknown): void {
  io?.to(streamRoom(streamId)).emit(SOCKET_EVENTS.liveEvent, payload);
}

export function emitToChat(chatId: string, event: string, payload: unknown): void {
  io?.to(chatRoom(chatId)).emit(event, payload);
}

export const getIo = (): SocketServer | null => io;
