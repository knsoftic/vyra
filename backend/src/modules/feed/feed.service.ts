/**
 * The For You feed — the three stages joined up.
 *
 *   Stage 1  generate candidates from eleven pools (cheap, generous)
 *   Stage 2  score them, via the model or the rules fallback
 *   Stage 3  re-rank for diversity and apply the hard constraints
 *
 * Timing is recorded per stage. A feed that is slow is a feed people stop using,
 * and "the feed is slow" is not actionable — "retrieval took 210ms" is.
 */

import { execute, query, queryOne } from '../../core/db.ts';
import { logger } from '../../core/logger.ts';
import { storage } from '../../core/storage.ts';
import { getWeights } from './weights.ts';
import { generateCandidates, seenCounts, affinityFor } from './candidates.ts';
import {
  blend,
  chargeImpressions,
  eligibleCampaigns,
  promotedSlotCount,
} from '../promotion/delivery.service.ts';
import {
  freshnessFor,
  interestMatchFor,
  normaliseAffinity,
  rankCandidates,
  type CandidateFeatures,
} from './scoring.ts';
import { rerank, type RerankContext } from './rerank.ts';
import { scoreWithFallback } from './ml-client.ts';
import { getInterests, hiddenCreators } from '../behaviour/profiles.service.ts';

export interface FeedItem {
  videoId: string;
  creatorId: string;
  score: number;
  /** Which pool surfaced it — "because you follow", "trending", and so on. */
  reason: string;
  isNewCreator: boolean;
  impressionId: string;
  /**
   * True when this slot was paid for.
   *
   * Travels with the item all the way to the client, which labels it. Blending
   * paid placement into organic content without saying so is the thing the
   * whole delivery design refuses to do (ADR-035).
   */
  isPromoted?: boolean;
  /** Present only on a promoted item, so signals can be attributed to it. */
  campaignId?: string;
  ctaLabel?: string;
  destinationUrl?: string;
}

export interface FeedResult {
  items: FeedItem[];
  ranker: 'ml' | 'rules';
  modelVersion: string;
  fallbackReason?: string;
  sessionId: string;
  diagnostics: {
    timings: Record<string, number>;
    poolCounts: Record<string, number>;
    failedPools: string[];
    candidatesConsidered: number;
    newCreatorShare: number;
    removedByConstraint: Record<string, number>;
  };
}

/** Human-readable explanation per pool. Shown to users as "why am I seeing this". */
const POOL_REASONS: Record<string, string> = {
  following: 'From someone you follow',
  creator_affinity: 'From a creator you watch',
  interests: 'Matches your interests',
  similar_videos: 'Similar to what you have watched',
  similar_users: 'Popular with people like you',
  trending: 'Trending now',
  fresh: 'Recently posted',
  new_creators: 'From a new creator',
  discovery: 'Something different',
  language: 'In your language',
  category: 'From this category',
};

/**
 * Builds a page of the For You feed.
 *
 * Nothing here throws for a recoverable reason. A missing profile, an empty
 * pool, a dead model — each degrades to something servable, because an error
 * page is the one outcome a feed must never produce.
 */
export async function buildFeed(
  userId: number,
  options: { limit?: number; sessionId?: string; categoryId?: number | null } = {},
): Promise<FeedResult> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const sessionId = options.sessionId ?? `s_${Date.now().toString(36)}`;
  const timings: Record<string, number> = {};

  const mark = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
    const start = process.hrtime.bigint();
    const result = await work();
    timings[label] = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
    return result;
  };

  const weights = await mark('weights', () => getWeights());

  const [interests, hidden, viewer] = await mark('context', async () =>
    Promise.all([
      getInterests(userId).catch(() => ({ short: {}, long: {}, combined: {} })),
      hiddenCreators(userId).catch(() => [] as number[]),
      queryOne<{ language: string }>('SELECT language FROM users WHERE id = :id', { id: userId }),
    ]),
  );

  const interestSlugs = Object.entries(interests.combined)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([slug]) => slug);

  // Stage 1
  const generation = await mark('retrieval', () =>
    generateCandidates(userId, weights, {
      interestSlugs,
      language: viewer?.language ?? 'en',
      ...(options.categoryId !== undefined ? { categoryId: options.categoryId } : {}),
    }),
  );

  if (generation.candidates.length === 0) {
    return {
      items: [],
      ranker: 'rules',
      modelVersion: 'rules-v1',
      sessionId,
      diagnostics: {
        timings,
        poolCounts: generation.poolCounts,
        failedPools: generation.failedPools,
        candidatesConsidered: 0,
        newCreatorShare: 0,
        removedByConstraint: {},
      },
    };
  }

  const videoIds = generation.candidates.map((c) => c.videoId);
  const creatorIds = [...new Set(generation.candidates.map((c) => c.creatorId))];

  const [seen, affinities, categorySlugs] = await mark('enrichment', async () =>
    Promise.all([
      seenCounts(userId, videoIds),
      affinityFor(userId, creatorIds),
      query<{ id: number; slug: string }>('SELECT id, slug FROM categories'),
    ]),
  );

  const slugById = new Map(categorySlugs.map((c) => [Number(c.id), c.slug]));

  const features: CandidateFeatures[] = generation.candidates.map((candidate) => ({
    videoId: candidate.videoId,
    creatorId: candidate.creatorId,
    categoryId: candidate.categoryId,
    pool: candidate.pool,
    interestMatch: interestMatchFor(
      interests.combined,
      candidate.categoryId === null ? null : slugById.get(candidate.categoryId) ?? null,
    ),
    creatorAffinity: normaliseAffinity(affinities.get(candidate.creatorId) ?? 0),
    freshness: candidate.publishedAt ? freshnessFor(candidate.publishedAt) : 0.5,
    trending: candidate.trending,
    quality: candidate.quality,
    seenCount: seen.get(candidate.videoId) ?? 0,
    isNewCreator: candidate.isNewCreator,
    // Replaced in stage 2.
    predictions: {
      watch: 0.5, completion: 0.3, rewatch: 0.05, like: 0.05, comment: 0.01,
      share: 0.01, save: 0.02, follow: 0.01, profileVisit: 0.02,
      quickSkip: 0.2, notInterested: 0.01, hide: 0.005, report: 0.001,
    },
  }));

  // Stage 2
  const scoring = await mark('scoring', () => scoreWithFallback(userId, features));
  const scored = rankCandidates(scoring.candidates, weights, scoring.ranker);

  // Stage 3
  const context: RerankContext = {
    excludedCreators: new Set(hidden),
    recentCreators: [],
  };
  const reranked = await mark('rerank', async () => rerank(scored, limit, weights, context));

  const organic: FeedItem[] = reranked.items.map((item, index) => ({
    videoId: String(item.videoId),
    creatorId: String(item.creatorId),
    score: item.score,
    reason: POOL_REASONS[item.pool] ?? 'Recommended for you',
    isNewCreator: item.isNewCreator,
    impressionId: `${sessionId}_${item.videoId}_${index}`,
  }));

  /**
   * Promoted placements.
   *
   * Selected after ranking rather than inside it, so paid money can never move
   * an organic video's position — a campaign buys a slot of its own, it does
   * not outbid someone else's relevance. A failure here costs the page its
   * advertisements and nothing else.
   */
  const items = await mark('promotion', async () => {
    try {
      const slots = await promotedSlotCount(organic.length);
      if (slots <= 0) return organic;

      const already = new Set(organic.map((item) => item.videoId));
      const candidates = (await eligibleCampaigns({ userId }, slots * 2))
        // Never show a promoted copy of something already on the page.
        .filter((c) => !already.has(String(c.videoId)))
        .slice(0, slots);

      if (candidates.length === 0) return organic;

      const promoted: FeedItem[] = candidates.map((c, index) => ({
        videoId: String(c.videoId),
        creatorId: String(c.advertiserId),
        score: 0,
        reason: 'Promoted',
        isNewCreator: false,
        impressionId: `${sessionId}_ad_${c.campaignId}_${index}`,
        isPromoted: true,
        campaignId: c.campaignPublicId,
        ...(c.ctaLabel ? { ctaLabel: c.ctaLabel } : {}),
        ...(c.destinationUrl ? { destinationUrl: c.destinationUrl } : {}),
      }));

      // The page honours the size that was asked for. Promotion takes a slot;
      // it does not make the page longer than the client allocated for, which
      // would quietly break anything that pages by count.
      const blended = blend(organic.slice(0, Math.max(0, organic.length - promoted.length)), promoted);

      // Charged after the page is assembled, never before: an advertiser pays
      // for a delivery that happened.
      void chargeImpressions(
        candidates.map((c, index) => ({
          campaignId: c.campaignId,
          userId,
          impressionId: `${sessionId}_ad_${c.campaignId}_${index}`,
        })),
      ).catch((err: unknown) => logger.warn({ err, userId }, 'could not charge impressions'));

      return blended;
    } catch (err) {
      logger.warn({ err, userId }, 'promotion pass failed — serving the organic page');
      return organic;
    }
  });

  // Recorded after the response is composed so it never delays the feed.
  void recordDelivery(userId, sessionId, reranked.items, scoring.modelVersion).catch(
    (err: unknown) => logger.warn({ err, userId }, 'could not record feed delivery'),
  );

  return {
    items,
    ranker: scoring.ranker,
    modelVersion: scoring.modelVersion,
    ...(scoring.fallbackReason ? { fallbackReason: scoring.fallbackReason } : {}),
    sessionId,
    diagnostics: {
      timings,
      poolCounts: generation.poolCounts,
      failedPools: generation.failedPools,
      candidatesConsidered: reranked.diagnostics.considered,
      newCreatorShare: reranked.diagnostics.newCreatorShare,
      removedByConstraint: reranked.diagnostics.removedByConstraint,
    },
  };
}

/**
 * Records what was shown.
 *
 * Two writes: `impressions` for analytics and experiment attribution, and
 * `feed_seen` so the same video is not served again tomorrow. Deliberately not
 * awaited by the caller — a slow analytics write must not slow the feed.
 */
async function recordDelivery(
  userId: number,
  sessionId: string,
  items: { videoId: number; score: number }[],
  modelVersion: string,
): Promise<void> {
  if (items.length === 0) return;

  for (const [index, item] of items.entries()) {
    await execute(
      `INSERT INTO impressions
         (user_id, video_id, session_id, feed_source, rank_position, predicted_score, model_version)
       VALUES (:userId, :videoId, :sessionId, 'for_you', :rank, :score, :modelVersion)`,
      {
        userId,
        videoId: item.videoId,
        sessionId: sessionId.slice(0, 26),
        rank: index,
        score: Math.min(9.999999, item.score / 100),
        modelVersion: modelVersion.slice(0, 20),
      },
    ).catch(() => undefined);

    await execute(
      `INSERT INTO feed_seen (user_id, video_id, seen_count)
       VALUES (:userId, :videoId, 1)
       ON DUPLICATE KEY UPDATE seen_count = seen_count + 1`,
      { userId, videoId: item.videoId },
    ).catch(() => undefined);

    await execute(
      `INSERT INTO video_stats_hourly (video_id, bucket_hour, impressions)
       VALUES (:videoId, DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00'), 1)
       ON DUPLICATE KEY UPDATE impressions = impressions + 1`,
      { videoId: item.videoId },
    ).catch(() => undefined);
  }
}

/** Signed playback URLs for a page of feed items. */
export async function hydrateFeed(items: FeedItem[]) {
  if (items.length === 0) return [];

  const ids = items.map((i) => Number(i.videoId));
  const rows = await query<{
    id: number; public_id: string; caption: string; duration_sec: string;
    hls_key: string | null; poster_key: string | null;
    username: string; display_name: string; avatar_url: string | null;
    like_count: number; comment_count: number; share_count: number; view_count: number;
  }>(
    `SELECT v.id, v.public_id, v.caption, v.duration_sec, v.hls_key, v.poster_key,
            u.username, p.display_name, p.avatar_url,
            v.like_count, v.comment_count, v.share_count, v.view_count
       FROM videos v
       JOIN users u ON u.id = v.user_id
       JOIN user_profiles p ON p.user_id = v.user_id
      WHERE v.id IN (${ids.map((_, i) => `:v${i}`).join(', ')})`,
    Object.fromEntries(ids.map((id, i) => [`v${i}`, id])),
  );

  const byId = new Map(rows.map((r) => [Number(r.id), r]));

  return items
    .map((item) => {
      const row = byId.get(Number(item.videoId));
      if (!row) return null;
      return {
        id: row.public_id,
        caption: row.caption,
        durationSec: Number(row.duration_sec),
        // Feed candidates are public by definition, so plain CDN URLs are correct
        // here and keep the edge cache useful.
        hlsUrl: row.hls_key ? storage.url(row.hls_key) : null,
        posterUrl: row.poster_key ? storage.url(row.poster_key) : null,
        author: {
          username: row.username,
          displayName: row.display_name,
          avatar: row.avatar_url,
        },
        stats: {
          views: Number(row.view_count),
          likes: Number(row.like_count),
          comments: Number(row.comment_count),
          shares: Number(row.share_count),
        },
        reason: item.reason,
        impressionId: item.impressionId,
        isNewCreator: item.isNewCreator,
        // Carried through so the client can label the slot. A promoted item
        // that reaches the app without this is indistinguishable from organic
        // content, which is exactly what must not happen (ADR-035).
        ...(item.isPromoted ? { isPromoted: true as const } : {}),
        ...(item.campaignId ? { campaignId: item.campaignId } : {}),
        ...(item.ctaLabel ? { ctaLabel: item.ctaLabel } : {}),
        ...(item.destinationUrl ? { destinationUrl: item.destinationUrl } : {}),
      };
    })
    .filter((v) => v !== null);
}
