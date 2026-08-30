/**
 * Stage 1 — candidate generation.
 *
 * Eleven pools run in parallel, each answering a different question: what are
 * they following, who do they like, what interests them, what is new, what is
 * everyone watching, and — deliberately — what would they never normally see.
 *
 * Retrieval is cheap and generous. Scoring is expensive and picky. So this stage
 * over-fetches on purpose: a video that is never retrieved can never be ranked,
 * and the commonest cause of a bad feed is not bad scoring but a candidate set
 * that never contained the right answer.
 *
 * Every pool is capped so no single one can dominate, and a failing pool returns
 * nothing rather than failing the feed. A feed missing one pool is degraded; a
 * feed that errors is broken.
 */

import { query } from '../../core/db.ts';
import { logger } from '../../core/logger.ts';
import type { Weights } from './weights.ts';

export interface CandidateRow {
  video_id: number;
  creator_id: number;
  category_id: number | null;
  published_at: Date | null;
  distribution_level: number;
  is_new_creator: number;
  quality: number | null;
  trending: number | null;
}

export interface Candidate {
  videoId: number;
  creatorId: number;
  categoryId: number | null;
  publishedAt: Date | null;
  distributionLevel: number;
  isNewCreator: boolean;
  quality: number;
  trending: number;
  /** Which pool found it first. Kept for explanation and diagnostics. */
  pool: string;
}

export type PoolName =
  | 'following'
  | 'creator_affinity'
  | 'interests'
  | 'similar_videos'
  | 'similar_users'
  | 'trending'
  | 'fresh'
  | 'new_creators'
  | 'discovery'
  | 'language'
  | 'category';

/**
 * Shared by every pool.
 *
 * The visibility rules live here rather than in each pool because forgetting one
 * in a single pool would leak private content into the feed through that route
 * alone — the kind of bug that is very hard to notice.
 */
const BASE_WHERE = `
  v.status = 'published'
  AND v.deleted_at IS NULL
  AND v.privacy = 'public'
  AND v.processing_status = 'complete'
  AND v.user_id <> :userId
  AND NOT EXISTS (
    SELECT 1 FROM blocks b
     WHERE b.deleted_at IS NULL
       AND ((b.blocker_id = :userId AND b.blocked_id = v.user_id)
         OR (b.blocker_id = v.user_id AND b.blocked_id = :userId)))
  AND NOT EXISTS (
    SELECT 1 FROM negative_signals ns
     WHERE ns.user_id = :userId
       AND ns.kind IN ('hide_creator', 'report')
       AND ns.creator_id = v.user_id)
`;

const SELECT_COLUMNS = `
  v.id AS video_id,
  v.user_id AS creator_id,
  v.category_id,
  v.published_at,
  v.distribution_level,
  (p.follower_count < 1000) AS is_new_creator,
  COALESCE(q.overall, 50) AS quality,
  COALESCE(v.is_trending, 0) AS trending
`;

const FROM_CLAUSE = `
  FROM videos v
  JOIN user_profiles p ON p.user_id = v.user_id
  LEFT JOIN video_quality_scores q ON q.video_id = v.id
`;

interface PoolContext {
  userId: number;
  limit: number;
  interestSlugs: string[];
  language: string;
  categoryId?: number | null;
}

type PoolQuery = (context: PoolContext) => { sql: string; params: Record<string, unknown> };

/**
 * Pool definitions.
 *
 * Each returns video ids only — the enrichment happens once, afterwards, rather
 * than eleven times.
 */
const POOLS: Record<PoolName, PoolQuery> = {
  following: ({ userId, limit }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
           JOIN follows f ON f.followee_id = v.user_id
                         AND f.follower_id = :userId AND f.deleted_at IS NULL
          WHERE ${BASE_WHERE}
          ORDER BY v.published_at DESC LIMIT :limit`,
    params: { userId, limit },
  }),

  creator_affinity: ({ userId, limit }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
           JOIN creator_affinity ca ON ca.creator_id = v.user_id
                                   AND ca.user_id = :userId AND ca.score > 0
          WHERE ${BASE_WHERE}
          ORDER BY ca.score DESC, v.published_at DESC LIMIT :limit`,
    params: { userId, limit },
  }),

  interests: ({ userId, limit, interestSlugs }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
           JOIN categories c ON c.id = v.category_id
          WHERE ${BASE_WHERE}
            AND c.slug IN (${interestSlugs.map((_, i) => `:slug${i}`).join(', ')})
          ORDER BY v.published_at DESC LIMIT :limit`,
    params: {
      userId,
      limit,
      ...Object.fromEntries(interestSlugs.map((slug, i) => [`slug${i}`, slug])),
    },
  }),

  // Videos enjoyed by people who enjoyed the same videas as this viewer.
  similar_users: ({ userId, limit }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
          WHERE ${BASE_WHERE}
            AND v.id IN (
              SELECT DISTINCT w2.video_id
                FROM watch_events w1
                JOIN watch_events w2 ON w2.video_id <> w1.video_id
                                    AND w2.user_id <> :userId
                                    AND w2.completed = 1
               WHERE w1.user_id = :userId AND w1.completed = 1
                 AND w1.created_at > (NOW(3) - INTERVAL 14 DAY)
                 AND w2.user_id IN (
                   SELECT w3.user_id FROM watch_events w3
                    WHERE w3.video_id = w1.video_id AND w3.completed = 1
                      AND w3.user_id <> :userId
                    LIMIT 50)
               LIMIT 200)
          LIMIT :limit`,
    params: { userId, limit },
  }),

  // Content-similarity neighbours. Until embeddings exist (Phase 7 v2+), this
  // approximates with same-category videos from creators the viewer has enjoyed.
  similar_videos: ({ userId, limit }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
          WHERE ${BASE_WHERE}
            AND v.category_id IN (
              SELECT DISTINCT v2.category_id FROM watch_events w
                JOIN videos v2 ON v2.id = w.video_id
               WHERE w.user_id = :userId AND w.completed = 1
                 AND w.created_at > (NOW(3) - INTERVAL 7 DAY)
                 AND v2.category_id IS NOT NULL
               LIMIT 20)
          ORDER BY v.published_at DESC LIMIT :limit`,
    params: { userId, limit },
  }),

  trending: ({ userId, limit }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
           LEFT JOIN video_performance vp ON vp.video_id = v.id
          WHERE ${BASE_WHERE}
            AND v.published_at > (NOW(3) - INTERVAL 7 DAY)
          ORDER BY COALESCE(vp.engagement_rate, 0) DESC, v.view_count DESC
          LIMIT :limit`,
    params: { userId, limit },
  }),

  fresh: ({ userId, limit }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
           LEFT JOIN video_performance vp ON vp.video_id = v.id
          WHERE ${BASE_WHERE}
            AND v.published_at > (NOW(3) - INTERVAL 48 HOUR)
            AND COALESCE(vp.impressions, 0) < 500
          ORDER BY v.published_at DESC LIMIT :limit`,
    params: { userId, limit },
  }),

  // The exploration budget (ADR-010). Retrieval alone does not guarantee these
  // reach the page — the re-ranker reserves the slots.
  new_creators: ({ userId, limit }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
          WHERE ${BASE_WHERE}
            AND p.follower_count < 1000
            AND v.published_at > (NOW(3) - INTERVAL 14 DAY)
          ORDER BY v.published_at DESC LIMIT :limit`,
    params: { userId, limit },
  }),

  // Deliberately outside the profile, so a feed cannot close in on itself.
  discovery: ({ userId, limit, interestSlugs }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
           LEFT JOIN categories c ON c.id = v.category_id
          WHERE ${BASE_WHERE}
            ${interestSlugs.length > 0
              ? `AND (c.slug IS NULL OR c.slug NOT IN (${interestSlugs.map((_, i) => `:dslug${i}`).join(', ')}))`
              : ''}
            AND v.published_at > (NOW(3) - INTERVAL 30 DAY)
          ORDER BY RAND() LIMIT :limit`,
    params: {
      userId,
      limit,
      ...Object.fromEntries(interestSlugs.map((slug, i) => [`dslug${i}`, slug])),
    },
  }),

  language: ({ userId, limit, language }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
           JOIN users u ON u.id = v.user_id
          WHERE ${BASE_WHERE}
            AND u.language = :language
          ORDER BY v.published_at DESC LIMIT :limit`,
    params: { userId, limit, language },
  }),

  category: ({ userId, limit, categoryId }) => ({
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
          WHERE ${BASE_WHERE}
            AND v.category_id = :categoryId
          ORDER BY v.published_at DESC LIMIT :limit`,
    params: { userId, limit, categoryId: categoryId ?? 0 },
  }),
};

function toCandidate(row: CandidateRow, pool: string): Candidate {
  return {
    videoId: Number(row.video_id),
    creatorId: Number(row.creator_id),
    categoryId: row.category_id === null ? null : Number(row.category_id),
    publishedAt: row.published_at,
    distributionLevel: Number(row.distribution_level ?? 1),
    isNewCreator: Number(row.is_new_creator) === 1,
    quality: Number(row.quality ?? 50) / 100,
    trending: Number(row.trending ?? 0),
    pool,
  };
}

export interface GenerationResult {
  candidates: Candidate[];
  /** How many each pool contributed after de-duplication. */
  poolCounts: Record<string, number>;
  /** Pools that failed. A degraded feed, not a broken one. */
  failedPools: string[];
}

/**
 * Runs every pool and merges the results.
 *
 * The first pool to find a video keeps it, and the order below is deliberate:
 * `following` before `discovery` means a video from someone you follow is
 * attributed to that relationship rather than to chance.
 */
export async function generateCandidates(
  userId: number,
  weights: Weights,
  options: {
    interestSlugs?: string[];
    language?: string;
    categoryId?: number | null;
  } = {},
): Promise<GenerationResult> {
  const poolSize = Math.max(50, Math.round(weights.r_candidate_pool ?? 800));
  const perPool = Math.max(10, Math.round(weights.r_per_pool_limit ?? 150));

  const context: PoolContext = {
    userId,
    limit: perPool,
    interestSlugs: (options.interestSlugs ?? []).slice(0, 20),
    language: options.language ?? 'en',
    ...(options.categoryId !== undefined ? { categoryId: options.categoryId } : {}),
  };

  const order: PoolName[] = [
    'following',
    'creator_affinity',
    'interests',
    'similar_videos',
    'similar_users',
    'trending',
    'fresh',
    'new_creators',
    'language',
    'category',
    'discovery',
  ];

  const runnable = order.filter((name) => {
    if (name === 'interests' && context.interestSlugs.length === 0) return false;
    if (name === 'category' && !context.categoryId) return false;
    return true;
  });

  const failedPools: string[] = [];

  const results = await Promise.all(
    runnable.map(async (name) => {
      try {
        const { sql, params } = POOLS[name](context);
        const rows = await query<CandidateRow>(sql, params);
        return { name, rows };
      } catch (err) {
        // One pool failing costs variety, not the feed.
        logger.warn({ err, pool: name, userId }, 'candidate pool failed');
        failedPools.push(name);
        return { name, rows: [] as CandidateRow[] };
      }
    }),
  );

  const byVideo = new Map<number, Candidate>();
  const poolCounts: Record<string, number> = {};

  for (const { name, rows } of results) {
    let kept = 0;
    for (const row of rows) {
      const videoId = Number(row.video_id);
      if (byVideo.has(videoId)) continue;
      byVideo.set(videoId, toCandidate(row, name));
      kept += 1;
      if (byVideo.size >= poolSize) break;
    }
    poolCounts[name] = kept;
    if (byVideo.size >= poolSize) break;
  }

  return { candidates: [...byVideo.values()], poolCounts, failedPools };
}

/** How many times this viewer has already been shown each of these videos. */
export async function seenCounts(
  userId: number,
  videoIds: number[],
): Promise<Map<number, number>> {
  if (videoIds.length === 0) return new Map();

  const rows = await query<{ video_id: number; seen_count: number }>(
    `SELECT video_id, seen_count FROM feed_seen
      WHERE user_id = :userId
        AND video_id IN (${videoIds.map((_, i) => `:v${i}`).join(', ')})`,
    { userId, ...Object.fromEntries(videoIds.map((id, i) => [`v${i}`, id])) },
  ).catch(() => [] as { video_id: number; seen_count: number }[]);

  return new Map(rows.map((r) => [Number(r.video_id), Number(r.seen_count)]));
}

/** Creator affinity scores for a set of creators. */
export async function affinityFor(
  userId: number,
  creatorIds: number[],
): Promise<Map<number, number>> {
  if (creatorIds.length === 0) return new Map();

  const rows = await query<{ creator_id: number; score: string }>(
    `SELECT creator_id, score FROM creator_affinity
      WHERE user_id = :userId
        AND creator_id IN (${creatorIds.map((_, i) => `:c${i}`).join(', ')})`,
    { userId, ...Object.fromEntries(creatorIds.map((id, i) => [`c${i}`, id])) },
  ).catch(() => [] as { creator_id: number; score: string }[]);

  return new Map(rows.map((r) => [Number(r.creator_id), Number(r.score)]));
}
