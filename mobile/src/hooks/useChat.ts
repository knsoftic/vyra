/**
 * Chat state.
 *
 * Two hooks: the inbox, and one conversation. Both keep a live socket feed and a
 * REST fetch in agreement, which is the whole difficulty — the same message can
 * arrive twice (once over the socket, once in a refetch) and must appear once.
 * Every merge here is keyed by message id for that reason.
 *
 * Sending is optimistic. The bubble appears immediately with `sending`, is
 * replaced by the server's copy when it lands, and is marked `failed` if it does
 * not — never silently dropped, because a message that vanishes is worse than
 * one that visibly failed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Chat,
  Message,
  MessageKind,
  SendMessageBody,
} from '../../../shared/contracts/messaging';
import { SOCKET_EVENTS } from '../../../shared/contracts/routes';
import { chats as chatsApi, ApiError } from '../api';
import { useSession } from '../store/SessionState';
import { subscribe, useChatRoom } from '../realtime';

/** Unique per logical send, and stable across retries of that send. */
function clientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ── Inbox ──

export interface InboxState {
  chats: Chat[];
  loading: boolean;
  live: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  totalUnread: number;
}

export function useInbox(): InboxState {
  const { backendStatus, isSignedIn } = useSession();
  const live = backendStatus === 'live' && isSignedIn;

  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!live) {
      setChats([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await chatsApi.list();
      setChats(page.items);
    } catch (err) {
      setError(err instanceof ApiError && !err.offline ? err.message : null);
    } finally {
      setLoading(false);
    }
  }, [live]);

  useEffect(() => {
    void load();
  }, [load]);

  // A message arriving anywhere moves that conversation to the top and bumps
  // its badge, without refetching the whole inbox.
  useEffect(() => {
    if (!live) return;
    return subscribe<Message>(SOCKET_EVENTS.messageNew, (message) => {
      setChats((prev) => {
        const index = prev.findIndex((c) => c.id === message.chatId);
        if (index === -1) {
          // A conversation this device has never seen — the list has to be
          // refetched to learn who is in it.
          void load();
          return prev;
        }
        const existing = prev[index]!;
        const updated: Chat = {
          ...existing,
          lastMessage: message,
          unreadCount: existing.unreadCount + 1,
          updatedAt: message.createdAt,
        };
        return [updated, ...prev.filter((_, i) => i !== index)];
      });
    });
  }, [live, load]);

  useEffect(() => {
    if (!live) return;
    return subscribe<Chat>(SOCKET_EVENTS.chatCreated, () => void load());
  }, [live, load]);

  return {
    chats,
    loading,
    live,
    error,
    refresh: load,
    totalUnread: chats.reduce((sum, c) => sum + c.unreadCount, 0),
  };
}

// ── One conversation ──

export interface ConversationState {
  chat: Chat | null;
  messages: Message[];
  loading: boolean;
  live: boolean;
  error: string | null;
  hasMore: boolean;
  loadOlder: () => Promise<void>;
  send: (input: { kind: MessageKind; body?: string; replyToId?: string; mediaKey?: string; durationSec?: number }) => Promise<void>;
  retry: (message: Message) => Promise<void>;
  remove: (messageId: string, forEveryone: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useConversation(chatId: string | null): ConversationState {
  const { backendStatus, isSignedIn } = useSession();
  const live = backendStatus === 'live' && isSignedIn && chatId !== null;

  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  // The client ids of messages still in flight, so a socket echo of our own
  // send can be matched to the optimistic bubble instead of appended beside it.
  const pending = useRef(new Map<string, string>());

  useChatRoom(live ? chatId : null);

  /** Newest first from the server; the list renders inverted. */
  const load = useCallback(async () => {
    if (!live || !chatId) {
      setChat(null);
      setMessages([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [detail, page] = await Promise.all([
        chatsApi.get(chatId),
        chatsApi.messages(chatId),
      ]);
      setChat(detail);
      setMessages(page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);

      // Opening a conversation is reading it.
      const newest = page.items[0];
      await chatsApi.markRead(chatId, newest?.id).catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError && !err.offline ? err.message : null);
    } finally {
      setLoading(false);
    }
  }, [live, chatId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadOlder = useCallback(async () => {
    if (!live || !chatId || !cursor) return;
    try {
      const page = await chatsApi.messages(chatId, cursor);
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...page.items.filter((m) => !seen.has(m.id))];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      // Nothing to do: the older page stays unloaded and can be retried.
    }
  }, [live, chatId, cursor]);

  // Incoming messages.
  useEffect(() => {
    if (!live || !chatId) return;
    return subscribe<Message>(SOCKET_EVENTS.messageNew, (message) => {
      if (message.chatId !== chatId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [message, ...prev];
      });
      void chatsApi.markRead(chatId, message.id).catch(() => undefined);
      void chatsApi.markDelivered([message.id]).catch(() => undefined);
    });
  }, [live, chatId]);

  // Read receipts: the other side opened the conversation, so our ticks move.
  useEffect(() => {
    if (!live || !chatId) return;
    return subscribe<{ chatId: string; readerId: number }>(SOCKET_EVENTS.messageRead, (payload) => {
      if (payload.chatId !== chatId) return;
      setMessages((prev) =>
        prev.map((m) => (m.status === 'sent' || m.status === 'delivered' ? { ...m, status: 'seen' } : m)),
      );
    });
  }, [live, chatId]);

  useEffect(() => {
    if (!live || !chatId) return;
    return subscribe<{ chatId: string; messageId: string }>(
      SOCKET_EVENTS.messageDeleted,
      (payload) => {
        if (payload.chatId !== chatId) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.messageId
              ? { ...m, isDeleted: true, body: undefined, kind: 'system' as MessageKind }
              : m,
          ),
        );
      },
    );
  }, [live, chatId]);

  const deliver = useCallback(
    async (localId: string, payload: SendMessageBody) => {
      if (!chatId) return;
      try {
        const saved = await chatsApi.send(chatId, payload);
        pending.current.delete(localId);
        setMessages((prev) => {
          // The socket may have delivered the server's copy already.
          const withoutDuplicate = prev.filter((m) => m.id !== saved.id);
          return withoutDuplicate.map((m) => (m.id === localId ? saved : m));
        });
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) => (m.id === localId ? { ...m, status: 'failed' } : m)),
        );
        setError(err instanceof ApiError && !err.offline ? err.message : null);
      }
    },
    [chatId],
  );

  const send = useCallback<ConversationState['send']>(
    async (input) => {
      if (!chatId) return;

      const localId = `local-${clientId()}`;
      const key = clientId();
      pending.current.set(localId, key);

      const payload: SendMessageBody = {
        kind: input.kind,
        clientId: key,
        ...(input.body ? { body: input.body } : {}),
        ...(input.replyToId ? { replyToId: input.replyToId } : {}),
        ...(input.mediaKey ? { mediaKey: input.mediaKey } : {}),
        ...(input.durationSec ? { durationSec: input.durationSec } : {}),
      };

      // The bubble appears before the request, so typing never feels laggy.
      const optimistic: Message = {
        id: localId,
        chatId,
        senderId: 'me',
        kind: input.kind,
        status: 'sending',
        createdAt: new Date().toISOString(),
        ...(input.body ? { body: input.body } : {}),
      };
      setMessages((prev) => [optimistic, ...prev]);

      if (!live) {
        // No backend: the message stays local and says so rather than
        // pretending it was sent.
        setMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, status: 'failed' } : m)));
        return;
      }

      await deliver(localId, payload);
    },
    [chatId, live, deliver],
  );

  /**
   * Retries a failed send with its original client id, so the server treats it
   * as the same message rather than a second one.
   */
  const retry = useCallback<ConversationState['retry']>(
    async (message) => {
      if (!chatId || !live) return;
      const key = pending.current.get(message.id) ?? clientId();
      pending.current.set(message.id, key);

      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, status: 'sending' } : m)),
      );

      await deliver(message.id, {
        kind: message.kind,
        clientId: key,
        ...(message.body ? { body: message.body } : {}),
      });
    },
    [chatId, live, deliver],
  );

  const remove = useCallback<ConversationState['remove']>(
    async (messageId, forEveryone) => {
      if (!live) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        return;
      }
      try {
        await chatsApi.deleteMessage(messageId, forEveryone);
        setMessages((prev) =>
          forEveryone
            ? prev.map((m) =>
                m.id === messageId
                  ? { ...m, isDeleted: true, body: undefined, kind: 'system' as MessageKind }
                  : m,
              )
            : prev.filter((m) => m.id !== messageId),
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : null);
      }
    },
    [live],
  );

  return {
    chat,
    messages,
    loading,
    live,
    error,
    hasMore,
    loadOlder,
    send,
    retry,
    remove,
    refresh: load,
  };
}
