/**
 * Realtime hooks.
 *
 * `useRealtimeConnection` belongs at the app root: it owns the socket's
 * lifetime and ties it to the session. Everything else subscribes.
 */

import { useEffect, useState } from 'react';
import { SOCKET_EVENTS } from '../../../shared/contracts/routes';
import { useSession } from '../store/SessionState';
import {
  connectSocket,
  disconnectSocket,
  emit,
  getSocketStatus,
  onStatusChange,
  subscribe,
  type SocketStatus,
} from './socket';

/** Opens the connection while signed in, and closes it on sign-out. */
export function useRealtimeConnection(): SocketStatus {
  const { isSignedIn, backendStatus } = useSession();
  const [status, setStatus] = useState<SocketStatus>(getSocketStatus());

  useEffect(() => onStatusChange(setStatus), []);

  useEffect(() => {
    if (isSignedIn && backendStatus === 'live') {
      connectSocket();
      return;
    }
    // Signing out must drop the socket: leaving it open would keep delivering
    // one account's messages to a device that is now someone else's.
    disconnectSocket();
  }, [isSignedIn, backendStatus]);

  return status;
}

/** Subscribes to one socket event for the life of the component. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void): void {
  useEffect(() => subscribe<T>(event, handler), [event, handler]);
}

export interface TypingState {
  /** Public ids of people currently typing in this chat. */
  typing: string[];
  /** Tell the other side whether this device is typing. */
  setTyping: (isTyping: boolean) => void;
}

/** How long a typing indicator survives without a refresh. */
const TYPING_TTL_MS = 4000;

/**
 * Typing indicators for one chat.
 *
 * Each notice expires on its own timer. Without that, a sender who closes the
 * app mid-word leaves "typing…" on the other person's screen for ever, because
 * the "stopped" event never arrives.
 */
export function useTyping(chatId: string | null): TypingState {
  const [typing, setTypingUsers] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!chatId) return;

    const unsubscribe = subscribe<{ chatId: string; userId: string; isTyping: boolean }>(
      SOCKET_EVENTS.typing,
      (payload) => {
        if (payload.chatId !== chatId) return;
        setTypingUsers((prev) => {
          if (!payload.isTyping) {
            const { [payload.userId]: _removed, ...rest } = prev;
            return rest;
          }
          return { ...prev, [payload.userId]: Date.now() };
        });
      },
    );

    // One sweep rather than a timer per person.
    const sweep = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(
          Object.entries(prev).filter(([, at]) => now - at < TYPING_TTL_MS),
        );
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(sweep);
    };
  }, [chatId]);

  const setTyping = (isTyping: boolean) => {
    if (!chatId) return;
    emit(SOCKET_EVENTS.typing, { chatId, isTyping });
  };

  return { typing: Object.keys(typing), setTyping };
}

/** Joins a chat room the socket did not know about at connect time. */
export function useChatRoom(chatId: string | null): void {
  useEffect(() => {
    if (!chatId) return;
    emit(SOCKET_EVENTS.chatJoin, chatId);
    return () => emit(SOCKET_EVENTS.chatLeave, chatId);
  }, [chatId]);
}
