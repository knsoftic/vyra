/**
 * Progressive distribution.
 *
 * A new video does not go straight to everyone. It is shown to a small audience,
 * and only earns a wider one by performing:
 *
 *   L1  small test audience
 *   L2  similar audience
 *   L3  category audience
 *   L4  broad For You
 *   L5  trending candidate
 *
 * **Performance alone decides.** Not follower count, not account age, not
 * technical quality — a video from an account with eleven followers reaches L4 on
 * exactly the same numbers as one from an account with a million. That is what
 * makes the new-creator exploration budget worth anything: getting the initial
 * impressions is useless if the ladder above them is gated on status.
 *
 * A video can also be *demoted*. Something that performs at L2 and collapses at
 * L3 goes back down rather than continuing to consume broad distribution.
 *
 * The decision is a pure function of the metrics, so any promotion can be
 * explained and every threshold is admin-tunable.
 */

import { execute, query, queryOne } from '../../core/db.ts';
import { logger } from '../../core/logger.ts';
import { getSetting } from '../../core/settings.ts';
import {
  MIN_LEVEL,
  MAX_LEVEL,
  LEVEL_THRESHOLDS,
  computeRates,
  evaluate,
  type DistributionVerdict,
  type PerformanceMetrics,
} from './distribution-rules.ts';

/** Rolls up hourly stats into the running performance row. */
export async function refreshPerformance(videoId: number): Promise<PerformanceMetrics> {
  const row = await queryOne<{
    impressions: string; views: string; completions: string;
    quick_skips: string; engagements: string;
  }>(
    `SELECT
       COALESCE(SUM(impressions), 0) AS impressions,
       COALESCE(SUM(views), 0) AS views,
       COALESCE(SUM(completions), 0) AS completions,
       COALESCE(SUM(quick_skips), 0) AS quick_skips,
       COALESCE(SUM(likes + comments + shares + saves), 0) AS engagements
     FROM video_stats_hourly WHERE video_id = :videoId`,
    { videoId },
  );

  const metrics: PerformanceMetrics = {
    impressions: Number(row?.impressions ?? 0),
    views: Number(row?.views ?? 0),
    completions: Number(row?.completions ?? 0),
    quickSkips: Number(row?.quick_skips ?? 0),
    engagements: Number(row?.engagements ?? 0),
  };

  const rates = computeRates(metrics);

  await execute(
    `INSERT INTO video_performance
       (video_id, impressions, views, completions, quick_skips, engagements,
        completion_rate, engagement_rate, quick_skip_rate, evaluated_at)
     VALUES (:videoId, :impressions, :views, :completions, :quickSkips, :engagements,
             :completionRate, :engagementRate, :quickSkipRate, NOW(3))
     ON DUPLICATE KEY UPDATE
       impressions = VALUES(impressions), views = VALUES(views),
       completions = VALUES(completions), quick_skips = VALUES(quick_skips),
       engagements = VALUES(engagements), completion_rate = VALUES(completion_rate),
       engagement_rate = VALUES(engagement_rate), quick_skip_rate = VALUES(quick_skip_rate),
       evaluated_at = NOW(3)`,
    { videoId, ...metrics, ...rates },
  );

  return metrics;
}

/**
 * Evaluates one video and applies the verdict.
 *
 * Every move writes a `distribution_events` row carrying the numbers behind it,
 * so "why did my video stop being shown" is answerable months later.
 */
export async function evaluateAndApply(
  videoId: number,
): Promise<DistributionVerdict & { applied: boolean }> {
  const video = await queryOne<{ id: number; distribution_level: number; status: string }>(
    'SELECT id, distribution_level, status FROM videos WHERE id = :videoId AND deleted_at IS NULL',
    { videoId },
  );
  if (!video) {
    throw new Error(`Video ${videoId} not found.`);
  }

  const metrics = await refreshPerformance(videoId);
  const verdict = evaluate(video.distribution_level ?? MIN_LEVEL, metrics);

  if (verdict.decision === 'held') {
    return { ...verdict, applied: false };
  }

  await execute('UPDATE videos SET distribution_level = :level WHERE id = :videoId', {
    level: verdict.toLevel,
    videoId,
  });

  await execute(
    `INSERT INTO distribution_events
       (video_id, from_level, to_level, reason, impressions, views,
        completion_rate, engagement_rate, quick_skip_rate, detail)
     VALUES (:videoId, :from, :to, :reason, :impressions, :views,
             :completionRate, :engagementRate, :quickSkipRate, :detail)`,
    {
      videoId,
      from: verdict.fromLevel,
      to: verdict.toLevel,
      reason: verdict.decision,
      impressions: metrics.impressions,
      views: metrics.views,
      ...verdict.rates,
      detail: JSON.stringify({ explanation: verdict.reason, metrics }),
    },
  );

  logger.info(
    { videoId, from: verdict.fromLevel, to: verdict.toLevel, decision: verdict.decision },
    'distribution level changed',
  );

  return { ...verdict, applied: true };
}

/** Videos due for evaluation, least recently checked first. */
export async function dueForEvaluation(limit = 50): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT v.id
       FROM videos v
       LEFT JOIN video_performance p ON p.video_id = v.id
      WHERE v.status = 'published' AND v.deleted_at IS NULL
        AND (p.evaluated_at IS NULL OR p.evaluated_at < (NOW(3) - INTERVAL 1 HOUR))
      ORDER BY p.evaluated_at IS NOT NULL, p.evaluated_at
      LIMIT :limit`,
    { limit },
  );
  return rows.map((r) => Number(r.id));
}

/** The distribution history for one video, for the creator and for admin. */
export async function history(videoId: number, limit = 50) {
  const rows = await query<{
    from_level: number; to_level: number; reason: string;
    impressions: number; completion_rate: string; engagement_rate: string;
    quick_skip_rate: string; detail: string | null; created_at: Date;
  }>(
    `SELECT from_level, to_level, reason, impressions, completion_rate,
            engagement_rate, quick_skip_rate, detail, created_at
       FROM distribution_events
      WHERE video_id = :videoId
      ORDER BY created_at DESC
      LIMIT :limit`,
    { videoId, limit },
  );

  return rows.map((r) => ({
    fromLevel: Number(r.from_level),
    toLevel: Number(r.to_level),
    reason: r.reason,
    impressions: Number(r.impressions),
    completionRate: Number(r.completion_rate),
    engagementRate: Number(r.engagement_rate),
    quickSkipRate: Number(r.quick_skip_rate),
    explanation: (() => {
      try {
        return r.detail ? (JSON.parse(r.detail) as { explanation?: string }).explanation : undefined;
      } catch {
        return undefined;
      }
    })(),
    at: new Date(r.created_at).toISOString(),
  }));
}

/** Audience breadth for a level, used to size the candidate pool. */
export async function audienceForLevel(level: number): Promise<number> {
  const configured = await getSetting('feed.per_creator_cap').catch(() => null);
  void configured;
  const sizes: Record<number, number> = { 1: 100, 2: 1000, 3: 10_000, 4: 100_000, 5: 1_000_000 };
  return sizes[Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level))] ?? 100;
}

export {
  MIN_LEVEL,
  MAX_LEVEL,
  LEVEL_THRESHOLDS,
  computeRates,
  evaluate,
};
export type { DistributionVerdict, PerformanceMetrics };
