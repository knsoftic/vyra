/** Live streaming contract. */

import type { PublicUser } from './user.ts';
import type { Gift } from './money.ts';

export type StreamState = 'scheduled' | 'live' | 'ended' | 'banned';

export interface LiveStream {
  id: string;
  host: PublicUser;
  title: string;
  cover?: string;
  state: StreamState;
  playbackUrl?: string;
  viewerCount: number;
  peakViewers: number;
  likeCount: number;
  giftCoins: number;
  categoryId?: string;
  startedAt?: string;
  endedAt?: string;
}

/** Returned to the host only. Contains the ingest secret. */
export interface StreamCredentials {
  streamId: string;
  ingestUrl: string;
  streamKey: string;
  expiresAt: string;
}

export interface StartStreamBody {
  title: string;
  categoryId?: string;
  coverKey?: string;
  allowComments?: boolean;
  allowGifts?: boolean;
}

export interface LiveComment {
  id: string;
  streamId: string;
  author: PublicUser;
  body: string;
  createdAt: string;
}

/** Realtime event pushed over the socket to every viewer. */
export type LiveEvent =
  | { type: 'viewer_count'; count: number }
  | { type: 'comment'; comment: LiveComment }
  | { type: 'gift'; gift: Gift; sender: PublicUser; quantity: number; coins: number }
  | { type: 'like'; count: number }
  | { type: 'host_left' }
  | { type: 'ended'; reason: string };
