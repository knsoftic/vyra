/**
 * Chat, community and call endpoints.
 *
 * Kept apart from `endpoints.ts` because messaging is a large enough surface
 * that mixing it in would make both harder to read. Same rules: thin wrappers,
 * types from the shared contract.
 */

import { api } from './client';
import type {
  Chat,
  Message,
  SendMessageBody,
  Community,
  CommunityMember,
  CommunityJoinRequest,
  CallRecord,
  CallKind,
} from '../../../shared/contracts/messaging';

export interface Paged<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string;
  /** Set when the server deliberately narrowed the list (ADR-014). */
  restricted?: boolean;
}

/** The envelope carries paging in `meta`; callers want it beside the items. */
async function paged<T>(path: string): Promise<Paged<T>> {
  const res = await api.get<T[]>(path);
  const meta = res.meta as
    | { hasMore?: boolean; nextCursor?: string; restricted?: boolean }
    | undefined;
  return {
    items: res.data,
    hasMore: meta?.hasMore ?? false,
    ...(meta?.nextCursor ? { nextCursor: meta.nextCursor } : {}),
    ...(meta?.restricted !== undefined ? { restricted: meta.restricted } : {}),
  };
}

export const chats = {
  list: (cursor?: string, limit = 30) =>
    paged<Chat>(`/chats?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),

  get: (chatId: string) => api.get<Chat>(`/chats/${chatId}`).then((r) => r.data),

  openDirect: (userId: string) =>
    api.post<Chat>('/chats/direct', { userId }).then((r) => r.data),

  createGroup: (input: { title: string; description?: string; memberIds: string[] }) =>
    api.post<Chat>('/chats/group', input).then((r) => r.data),

  update: (chatId: string, patch: { title?: string; description?: string; avatarKey?: string }) =>
    api.patch<Chat>(`/chats/${chatId}`, patch).then((r) => r.data),

  setMuted: (chatId: string, muted: boolean) =>
    api.post<{ isMuted: boolean }>(`/chats/${chatId}/mute`, { muted }).then((r) => r.data),

  addMembers: (chatId: string, memberIds: string[]) =>
    api.post<{ added: number }>(`/chats/${chatId}/members`, { memberIds }).then((r) => r.data),

  removeMember: (chatId: string, userId: string) =>
    api.delete<{ removed: true }>(`/chats/${chatId}/members/${userId}`).then((r) => r.data),

  messages: (chatId: string, cursor?: string, limit = 40) =>
    paged<Message>(
      `/chats/${chatId}/messages?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  send: (chatId: string, body: SendMessageBody) =>
    api.post<Message>(`/chats/${chatId}/messages`, body).then((r) => r.data),

  markRead: (chatId: string, upToMessageId?: string) =>
    api
      .post<{ read: number; unreadCount: number }>(`/chats/${chatId}/read`, {
        ...(upToMessageId ? { upToMessageId } : {}),
      })
      .then((r) => r.data),

  markDelivered: (messageIds: string[]) =>
    api.post<{ delivered: number }>('/messages/delivered', { messageIds }).then((r) => r.data),

  deleteMessage: (messageId: string, forEveryone = false) =>
    api
      .delete<{ deleted: true; forEveryone: boolean }>(
        `/messages/${messageId}${forEveryone ? '?forEveryone=true' : ''}`,
      )
      .then((r) => r.data),
};

export const communities = {
  list: (options: { mine?: boolean; q?: string; cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.mine) params.set('mine', 'true');
    if (options.q) params.set('q', options.q);
    if (options.cursor) params.set('cursor', options.cursor);
    params.set('limit', String(options.limit ?? 30));
    return paged<Community>(`/communities?${params.toString()}`);
  },

  get: (id: string) => api.get<Community>(`/communities/${id}`).then((r) => r.data),

  create: (input: {
    name: string;
    description?: string;
    isPrivate?: boolean;
    rules?: string[];
  }) => api.post<Community>('/communities', input).then((r) => r.data),

  update: (id: string, patch: Record<string, unknown>) =>
    api.patch<Community>(`/communities/${id}`, patch).then((r) => r.data),

  join: (id: string, message?: string) =>
    api
      .post<{ joined: boolean; pending: boolean; chatId?: string }>(`/communities/${id}/join`, {
        ...(message ? { message } : {}),
      })
      .then((r) => r.data),

  leave: (id: string) => api.post<{ left: true }>(`/communities/${id}/leave`).then((r) => r.data),

  /** `restricted` says whether this is the whole roster or only staff. */
  members: (id: string, cursor?: string) =>
    paged<CommunityMember>(
      `/communities/${id}/members${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  setRole: (id: string, userId: string, role: 'admin' | 'moderator' | 'member') =>
    api.patch<{ role: string }>(`/communities/${id}/members/${userId}`, { role }).then((r) => r.data),

  moderate: (id: string, userId: string, patch: { muted?: boolean; banned?: boolean }) =>
    api
      .post<{ isMuted: boolean; isBanned: boolean }>(
        `/communities/${id}/members/${userId}/moderate`,
        patch,
      )
      .then((r) => r.data),

  requests: (id: string) =>
    api.get<CommunityJoinRequest[]>(`/communities/${id}/requests`).then((r) => r.data),

  decideRequest: (id: string, requestId: string, approve: boolean) =>
    api
      .post<{ decided: true; approved: boolean }>(`/communities/${id}/requests/${requestId}`, {
        approve,
      })
      .then((r) => r.data),
};

export const calls = {
  history: () => api.get<CallRecord[]>('/calls').then((r) => r.data),

  start: (chatId: string, kind: CallKind) =>
    api.post<CallRecord>('/calls', { chatId, kind }).then((r) => r.data),

  answer: (callId: string) =>
    api.post<CallRecord>(`/calls/${callId}/answer`).then((r) => r.data),

  decline: (callId: string) =>
    api.post<CallRecord>(`/calls/${callId}/decline`).then((r) => r.data),

  end: (callId: string) => api.post<CallRecord>(`/calls/${callId}/end`).then((r) => r.data),

  setState: (callId: string, patch: { isMuted?: boolean; cameraOn?: boolean }) =>
    api
      .post<{ isMuted: boolean; cameraOn: boolean }>(`/calls/${callId}/state`, patch)
      .then((r) => r.data),

  /**
   * WebRTC signalling. The payload is whatever the peer connection produced —
   * the server relays it without looking at it, and so does this.
   */
  signal: (callId: string, type: 'offer' | 'answer' | 'ice', payload: unknown) =>
    api.post<{ relayed: number }>(`/calls/${callId}/${type}`, { payload }).then((r) => r.data),
};
