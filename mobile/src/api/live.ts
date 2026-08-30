/**
 * Live streaming and gifting endpoints.
 *
 * `sendGift` is the only call in the app that moves money, so it is the only one
 * that generates and holds an idempotency key. The key is created once per
 * *intent* — one tap on "send" — and reused for every retry of that intent, which
 * is what makes a retry safe rather than a second charge.
 */

import { api } from './client';
import type {
  LiveStream,
  LiveComment,
  StreamCredentials,
  StartStreamBody,
} from '../../../shared/contracts/live';
import type { Gift, WalletBalances } from '../../../shared/contracts/money';

export interface StartedStream {
  stream: LiveStream;
  /** Returned once, here. The key cannot be fetched again. */
  credentials: StreamCredentials;
}

export interface SendGiftResult {
  id: string;
  gift: Gift;
  quantity: number;
  coinsSpent: number;
  coinsToCreator: number;
  platformSharePercent: number;
  senderBalance: number;
  clearsAt: string;
  duplicate: boolean;
}

export interface GiftHistoryEntry {
  id: string;
  gift: Gift;
  quantity: number;
  coinsSpent: number;
  coinsToCreator: number;
  direction: 'sent' | 'received';
  counterparty: { id: string; username: string; displayName: string; avatar: string | null };
  createdAt: string;
}

export const live = {
  list: () => api.get<LiveStream[]>('/live').then((r) => r.data),

  mine: () => api.get<LiveStream[]>('/live/mine').then((r) => r.data),

  get: (id: string) => api.get<LiveStream>(`/live/${id}`).then((r) => r.data),

  start: (body: StartStreamBody & { allowGuests?: boolean }) =>
    api.post<StartedStream>('/live', body).then((r) => r.data),

  end: (id: string) => api.post<LiveStream>(`/live/${id}/end`).then((r) => r.data),

  join: (id: string) =>
    api.post<{ stream: LiveStream; viewerCount: number }>(`/live/${id}/join`).then((r) => r.data),

  leave: (id: string) =>
    api.post<{ viewerCount: number }>(`/live/${id}/leave`).then((r) => r.data),

  viewers: (id: string) => api.get<unknown[]>(`/live/${id}/viewers`).then((r) => r.data),

  banViewer: (id: string, userId: string) =>
    api.post<{ banned: true }>(`/live/${id}/viewers/${userId}/ban`).then((r) => r.data),

  comments: (id: string) => api.get<LiveComment[]>(`/live/${id}/comments`).then((r) => r.data),

  comment: (id: string, body: string) =>
    api.post<LiveComment>(`/live/${id}/comments`, { body }).then((r) => r.data),

  like: (id: string, count = 1) =>
    api.post<{ likeCount: number; yours: number }>(`/live/${id}/likes`, { count }).then((r) => r.data),
};

export const gifts = {
  catalogue: () => api.get<Gift[]>('/gifts').then((r) => r.data),

  history: () => api.get<GiftHistoryEntry[]>('/gifts/history').then((r) => r.data),

  /**
   * Sends a gift.
   *
   * `idempotencyKey` is required by the server and must be stable across retries
   * of the same intent — pass the same key when retrying, a new one for a new
   * gift. Generating it inside this function would make every retry a fresh
   * charge, which is exactly the failure the header exists to prevent.
   */
  send: (
    input: {
      giftId: string;
      recipientId: string;
      streamId?: string;
      quantity?: number;
    },
    idempotencyKey: string,
  ) =>
    api
      .post<SendGiftResult>('/gifts', input, { headers: { 'idempotency-key': idempotencyKey } })
      .then((r) => r.data),
};

export const wallet = {
  balances: () => api.get<WalletBalances>('/me/wallet').then((r) => r.data),

  ledger: (options: { wallet?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.wallet) params.set('wallet', options.wallet);
    params.set('limit', String(options.limit ?? 50));
    return api
      .get<LedgerEntry[]>(`/me/wallet/ledger?${params.toString()}`)
      .then((r) => r.data);
  },
};

export interface LedgerEntry {
  id: string;
  wallet: string;
  type: string;
  description: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  status: string;
  createdAt: string;
}

/** Unique per gift-sending intent, and reused for every retry of that intent. */
export function giftKey(): string {
  return `gift-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
