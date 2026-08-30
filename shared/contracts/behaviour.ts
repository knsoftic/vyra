/**
 * Behaviour event contract.
 *
 * This file defines the *complete* set of things the platform observes. That is
 * deliberate and load-bearing: ADR-008 says audience intelligence comes from
 * first-party in-app behaviour only, and the way to make that true rather than
 * aspirational is to enumerate what may be collected and reject everything else.
 *
 * `EVENT_FIELDS` below is an allowlist. The server writes only these fields, so
 * a client that sends a sensitive attribute — deliberately or by accident —
 * cannot get it stored. Adding a field here is a visible, reviewable change.
 *
 * What is never collected, and cannot be added without changing ADR-008:
 * microphone audio outside recording, contact lists, third-party advertising
 * identifiers, browsing outside the app, or any sensitive personal
 * characteristic (health, beliefs, ethnicity, sexuality, politics).
 */

/** Exposure — the video was shown. */
export const EXPOSURE_EVENTS = ['impression', 'video_start'] as const;

/** Watch progress. Thresholds are recorded, not just a single duration. */
export const WATCH_EVENTS = [
  'watch_2s',
  'watch_5s',
  'watch_10s',
  'watch_20s',
  'watch_30s',
  'completion',
  'rewatch',
] as const;

/** Rejection — weighted more heavily than the absence of a positive. */
export const REJECTION_EVENTS = [
  'quick_skip',
  'not_interested',
  'hide_creator',
  'report',
] as const;

export const ENGAGEMENT_EVENTS = ['like', 'comment', 'share', 'save'] as const;

export const GRAPH_EVENTS = ['follow', 'unfollow', 'profile_visit'] as const;

export const NAVIGATION_EVENTS = ['search', 'category_view', 'hashtag_click'] as const;

export const ALL_EVENTS = [
  ...EXPOSURE_EVENTS,
  ...WATCH_EVENTS,
  ...REJECTION_EVENTS,
  ...ENGAGEMENT_EVENTS,
  ...GRAPH_EVENTS,
  ...NAVIGATION_EVENTS,
] as const;

export type BehaviourEvent = (typeof ALL_EVENTS)[number];

export type FeedSource =
  | 'for_you'
  | 'following'
  | 'trending'
  | 'category'
  | 'search'
  | 'profile'
  | 'promoted'
  | 'sound'
  | 'hashtag';

export type DeviceTier = 'low' | 'mid' | 'high';

/**
 * The allowlist. Every field the server will persist, and nothing else.
 *
 * `deviceTier` is a coarse performance bucket used to tune playback and preload
 * behaviour. It is not a proxy for wealth and is never a ranking or targeting
 * feature.
 */
export const EVENT_FIELDS = [
  'event',
  'dedupeKey',
  'occurredAt',
  'sessionId',
  'videoId',
  'creatorId',
  'categoryId',
  'hashtagId',
  'feedSource',
  'watchMs',
  'videoMs',
  'appVersion',
  'deviceTier',
  'rank',
  'query',
] as const;

export type EventField = (typeof EVENT_FIELDS)[number];

/**
 * Fields that must never appear in an event, checked explicitly.
 *
 * A rejected payload is a bug worth surfacing loudly rather than quietly
 * dropping — if a client is sending these, something upstream needs fixing.
 */
export const FORBIDDEN_EVENT_FIELDS = [
  'email',
  'phone',
  'password',
  'address',
  'location',
  'latitude',
  'longitude',
  'gps',
  'contacts',
  'contactList',
  'advertisingId',
  'idfa',
  'gaid',
  'imei',
  'macAddress',
  'ip',
  'ipAddress',
  'audio',
  'microphone',
  'transcript',
  'ethnicity',
  'race',
  'religion',
  'politics',
  'sexuality',
  'health',
  'medical',
  'income',
  'gender',
  'age',
  'birthdate',
] as const;

export interface EventInput {
  event: BehaviourEvent;
  /** Client-generated, stable per logical event. Retries reuse it. */
  dedupeKey: string;
  /**
   * When the event happened on the device, not when it arrived.
   * Retries must carry the original value or deduplication cannot work.
   */
  occurredAt: string;
  sessionId?: string;
  videoId?: string;
  creatorId?: string;
  categoryId?: string;
  hashtagId?: string;
  feedSource?: FeedSource;
  /** Foreground playing time, excluding pauses and buffering. */
  watchMs?: number;
  videoMs?: number;
  appVersion?: string;
  deviceTier?: DeviceTier;
  /** Position in the feed when shown. */
  rank?: number;
  /** Search text. Retained for relevance only. */
  query?: string;
}

export interface EventBatch {
  events: EventInput[];
}

export interface EventBatchResult {
  accepted: number;
  /** Already seen. Not an error — it means a retry worked as intended. */
  duplicates: number;
  rejected: { dedupeKey: string; reason: string }[];
}

// ── Derived profiles ──

/** A weighted interest map, e.g. { technology: 0.9, gaming: 0.8 }. */
export type InterestWeights = Record<string, number>;

export type InterestHorizon = 'short' | 'long';

export interface InterestProfile {
  horizon: InterestHorizon;
  weights: InterestWeights;
  updatedAt: string;
}

export interface UserInterests {
  short: InterestWeights;
  long: InterestWeights;
  /** The two horizons blended, which is what ranking consumes. */
  combined: InterestWeights;
}

export interface SegmentMembership {
  slug: string;
  name: string;
  weight: number;
  lastReinforcedAt?: string;
}

export interface CreatorAffinity {
  creatorId: string;
  score: number;
  lastSignalAt?: string;
}

/** The distribution order a new video follows (PHASE_06). */
export const PRIORITY_AUDIENCE_ORDER = [
  'followers',
  'previous_likers',
  'previous_commenters',
  'previous_sharers',
  'previous_savers',
  'profile_visitors',
  'repeat_viewers',
  'long_watch_viewers',
] as const;

export type PriorityAudienceTier = (typeof PRIORITY_AUDIENCE_ORDER)[number];

export interface PriorityAudience {
  tier: PriorityAudienceTier;
  userIds: string[];
}
