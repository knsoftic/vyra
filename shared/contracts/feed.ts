/**
 * Feed and signal contract.
 *
 * ADR-008 — first-party in-app signals only. Nothing here accepts data from
 * outside the app: no contact lists, no third-party ad identifiers, no
 * microphone. The fields below are the complete set of inputs to ranking.
 *
 * ADR-009 — watch thresholds scale with video length. A 10-second clip watched
 * to the end is not the same signal as a 3-minute one, so the client reports raw
 * milliseconds and the server derives completion; the client never decides what
 * counts as a "view".
 */

import type { Video } from './content.ts';

export type FeedKind = 'for_you' | 'following' | 'nearby' | 'category' | 'hashtag' | 'sound';

export interface FeedQuery {
  kind: FeedKind;
  /** Required when kind is category / hashtag / sound. */
  refId?: string;
  cursor?: string;
  limit?: number;
}

export interface FeedResponse {
  items: FeedItem[];
  nextCursor?: string;
  hasMore: boolean;
  /** Echoed back so the client can attribute later signals to this delivery. */
  sessionId: string;
}

export interface FeedItem {
  video: Video;
  /** Opaque; returned with every signal so ranking can close the loop. */
  impressionId: string;
  /**
   * Why this video was shown. Surfaced in the UI as "Because you watched…" and
   * used by the admin panel to explain any single ranking decision (PHASE_06).
   */
  reason: FeedReason;
}

export type FeedReasonKind =
  | 'interest_match'
  | 'creator_affinity'
  | 'following'
  | 'trending'
  | 'nearby'
  | 'fresh_creator'
  | 'promoted'
  | 'exploration';

export interface FeedReason {
  kind: FeedReasonKind;
  label: string;
  /** 0–1. Present for admin/debug surfaces, omitted for ordinary clients. */
  score?: number;
}

/**
 * A watch report. Sent on scroll-away, app background, and every 15s for long
 * plays so a killed app still yields data.
 */
export interface WatchSignal {
  impressionId: string;
  videoId: string;
  sessionId: string;
  /** Total foreground playing time, excluding pauses and buffering. */
  watchedMs: number;
  /** Video length, so the server can scale the threshold (ADR-009). */
  durationMs: number;
  /** Number of times the video restarted from the beginning. */
  loops: number;
  /** True if the user dragged the scrubber — a strong interest signal. */
  scrubbed: boolean;
  /** True when the user muted; weakly negative. */
  muted: boolean;
  /** Client-side timestamp, reconciled against server time on receipt. */
  occurredAt: string;
}

/** Explicit negatives. Weighted far more heavily than the absence of a positive. */
export type NegativeSignalKind =
  | 'not_interested'
  | 'hide_creator'
  | 'hide_sound'
  | 'hide_hashtag'
  | 'report'
  | 'fast_skip';

export interface NegativeSignal {
  impressionId?: string;
  videoId: string;
  kind: NegativeSignalKind;
  reason?: string;
  occurredAt: string;
}

/** Signals are batched — one request per flush, not one per event. */
export interface SignalBatchBody {
  watches?: WatchSignal[];
  negatives?: NegativeSignal[];
}

export interface SignalBatchResult {
  accepted: number;
  /** Rejected entries with a reason, so the client can drop them rather than retry forever. */
  rejected: { impressionId?: string; reason: string }[];
}

/**
 * Ranking configuration, admin-tunable at runtime (ADR-015). Exposed to the
 * admin panel only — never sent to the app.
 */
export interface RankingWeights {
  watchTime: number;
  completion: number;
  rewatch: number;
  like: number;
  comment: number;
  share: number;
  save: number;
  follow: number;
  profileVisit: number;
  negativeSkip: number;
  notInterested: number;
  freshness: number;
  quality: number;
  /**
   * Share of each feed reserved for creators without an established audience.
   * ADR-010 — defaults to 0.10 and is admin-configurable.
   */
  newCreatorExplorationRate: number;
  /** Hard ceiling on how much of one feed a single creator may occupy. */
  perCreatorCap: number;
}

export const DEFAULT_NEW_CREATOR_EXPLORATION_RATE = 0.1;
