/**
 * The realtime connection.
 *
 * One socket per app, not one per screen. A screen subscribes to the events it
 * cares about and unsubscribes on unmount; the connection itself outlives all of
 * them, because reconnecting on every navigation would mean missing exactly the
 * messages that arrive while you are moving between screens.
 *
 * Three things this has to get right:
 *
 * **The token can change.** Access tokens are short-lived and rotate. The socket
 * authenticates with the current one at connect time, and is reconnected when
 * the session changes rather than left holding a token the server will reject.
 *
 * **Nothing here decides what a user may see.** Rooms are joined server-side
 * from the database. This client asks to join a chat it just created; the server
 * checks membership before honouring it.
 *
 * **Being offline is normal.** No backend, no connection, no error — the app
 * works without realtime, it just stops being live.
 */

import { io, type Socket } from 'socket.io-client';
import { API_BASE, getAccessToken } from '../api';

/** The socket connects to the origin, not to the versioned API path. */
function socketOrigin(): string {
  try {
    return new URL(API_BASE).origin;
  } catch {
    return API_BASE.replace(/\/api\/v\d+\/?$/, '');
  }
}

let socket: Socket | null = null;
let currentToken: string | null = null;

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

let status: SocketStatus = 'idle';
const statusListeners = new Set<(s: SocketStatus) => void>();

function setStatus(next: SocketStatus): void {
  status = next;
  for (const listener of statusListeners) listener(next);
}

export function onStatusChange(listener: (s: SocketStatus) => void): () => void {
  statusListeners.add(listener);
  listener(status);
  return () => statusListeners.delete(listener);
}

export function getSocketStatus(): SocketStatus {
  return status;
}

/**
 * Opens the connection, or reuses the open one.
 *
 * Called whenever the session changes. If the token is the same as the one the
 * live socket is using, nothing happens — that is what makes it safe to call
 * from an effect.
 */
export function connectSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) {
    disconnectSocket();
    return null;
  }

  if (socket?.connected && currentToken === token) return socket;

  // A token change means the old socket is authenticated with a credential the
  // server may already have rotated away.
  if (socket && currentToken !== token) disconnectSocket();

  currentToken = token;
  setStatus('connecting');

  socket = io(socketOrigin(), {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    // Unbounded: the app should reconnect after an hour in a tunnel, not give up.
    reconnectionAttempts: Infinity,
    timeout: 8000,
  });

  socket.on('connect', () => setStatus('connected'));
  socket.on('disconnect', () => setStatus('disconnected'));
  socket.on('connect_error', () => setStatus('disconnected'));

  return socket;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  currentToken = null;
  setStatus('idle');
}

export function getSocket(): Socket | null {
  return socket;
}

/**
 * Subscribes to one event for as long as the caller wants it.
 *
 * Returns an unsubscribe function rather than requiring the caller to hold the
 * handler reference — a mismatched `off` is the usual way a chat screen ends up
 * with duplicate message handlers after a few navigations.
 */
export function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  const active = socket ?? connectSocket();
  if (!active) return () => undefined;

  active.on(event, handler as (...args: unknown[]) => void);
  return () => {
    active.off(event, handler as (...args: unknown[]) => void);
  };
}

/** Fire-and-forget emit. Silently does nothing when there is no connection. */
export function emit(event: string, payload?: unknown): void {
  socket?.emit(event, payload);
}
