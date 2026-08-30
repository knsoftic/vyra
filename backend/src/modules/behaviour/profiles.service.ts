/**
 * Derived profiles: interests, segments, creator affinity, audience.
 *
 * Everything here is rebuilt from the event log rather than incremented in
 * place. That costs more compute, but it means a profile can always be
 * explained by pointing at the events that produced it, and a bug in the
 * weighting can be fixed by recomputing rather than by trying to unwind
 * accumulated damage.
 *
 * Time decay is applied when reading events, so a profile naturally reflects
 * recent behaviour more strongly without any sweep job aging rows.
 */

import { execute, query, queryOne } from '../../core/db.ts';
import { logger } from '../../core/logger.ts';
import {
  applySignal,
  blendHorizons,
  decayFactor,
  HALF_LIFE_DAYS,
  normalise,
  prune,
  rejectedTopics,
  topTopics,
} from './interest.ts';
import type {
  InterestWeights,
  PriorityAudience,
  PriorityAudienceTier,
  SegmentMembership,
  UserInterests,
} from '../../../../shared/contracts/behaviour.ts';

/** How far back each horizon reads. */
const WINDOW_DAYS = { short: 14, long: 180 } as const;
/** Events considered per rebuild, newest first. */
const MAX_EVENTS = 5000;

interface SignalRow {
  event: string;
  category_id: number | null;
  creator_id: number | null;
  video_id: number | null;
  created_at: Date;
  strength: number | null;
}

const ageDays = (from: Date): number => (Date.now() - new Date(from).getTime()) / 86_400_000;

/**
 * Reads a user's recent signals from both event tables.
 *
 * Watch events carry their own strength (the ADR-009 interpretation); other
 * events are all-or-nothing, so they get a strength of 1.
 */
async function loadSignals(userId: number, windowDays: number): Promise<SignalRow[]> {
  const generic = await query<SignalRow>(
    `SELECT e.event, e.category_id, e.creator_id, e.video_id, e.created_at, NULL AS strength
       FROM behaviour_events e
      WHERE e.user_id = :userId
        AND e.created_at > (NOW(3) - INTERVAL :days DAY)
      ORDER BY e.created_at DESC
      LIMIT :limit`,
    { userId, days: windowDays, limit: MAX_EVENTS },
  );

  const watches = await query<SignalRow>(
    `SELECT
       CASE
         WHEN w.quick_skip = 1 THEN 'quick_skip'
         WHEN w.completed = 1 THEN 'completion'
         WHEN w.reached_30s = 1 THEN 'watch_30s'
         WHEN w.reached_20s = 1 THEN 'watch_20s'
         WHEN w.reached_2s = 1 THEN 'watch_5s'
         ELSE 'watch_2s'
       END AS event,
       v.category_id, w.creator_id, w.video_id, w.created_at,
       w.completion_rate AS strength
       FROM watch_events w
       LEFT JOIN videos v ON v.id = w.video_id
      WHERE w.user_id = :userId
        AND w.created_at > (NOW(3) - INTERVAL :days DAY)
      ORDER BY w.created_at DESC
      LIMIT :limit`,
    { userId, days: windowDays, limit: MAX_EVENTS },
  );

  return [...generic, ...watches];
}

/** Category id → slug, for naming topics readably. */
async function categorySlugs(): Promise<Map<number, string>> {
  const rows = await query<{ id: number; slug: string }>('SELECT id, slug FROM categories');
  return new Map(rows.map((r) => [Number(r.id), r.slug]));
}

/** Rebuilds one horizon from the event log. */
async function buildHorizon(
  userId: number,
  horizon: 'short' | 'long',
  slugs: Map<number, string>,
): Promise<InterestWeights> {
  const signals = await loadSignals(userId, WINDOW_DAYS[horizon]);
  let weights: InterestWeights = {};

  for (const signal of signals) {
    if (signal.category_id === null) continue;
    const topic = slugs.get(Number(signal.category_id));
    if (!topic) continue;

    // Older events count for less, which is what makes the short horizon react
    // and the long horizon remember.
    const decay = decayFactor(ageDays(signal.created_at), HALF_LIFE_DAYS[horizon]);
    const strength = (signal.strength === null ? 1 : Number(signal.strength)) * decay;
    weights = applySignal(weights, topic, signal.event, strength);
  }

  return prune(weights);
}

export async function rebuildInterests(userId: number): Promise<UserInterests> {
  const slugs = await categorySlugs();
  const [short, long] = await Promise.all([
    buildHorizon(userId, 'short', slugs),
    buildHorizon(userId, 'long', slugs),
  ]);

  for (const [horizon, weights] of [['short', short], ['long', long]] as const) {
    await execute(
      `INSERT INTO user_interest_profiles (user_id, horizon, weights)
       VALUES (:userId, :horizon, :weights)
       ON DUPLICATE KEY UPDATE weights = VALUES(weights)`,
      { userId, horizon, weights: JSON.stringify(weights) },
    );
  }

  return { short, long, combined: blendHorizons(short, long) };
}

function parseWeights(raw: unknown): InterestWeights {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof parsed === 'object' && parsed !== null ? (parsed as InterestWeights) : {};
  } catch {
    return {};
  }
}

/** Reads the stored profile without rebuilding it. */
export async function getInterests(userId: number): Promise<UserInterests> {
  const rows = await query<{ horizon: 'short' | 'long'; weights: string }>(
    'SELECT horizon, weights FROM user_interest_profiles WHERE user_id = :userId',
    { userId },
  );

  const short = parseWeights(rows.find((r) => r.horizon === 'short')?.weights);
  const long = parseWeights(rows.find((r) => r.horizon === 'long')?.weights);
  return { short, long, combined: blendHorizons(short, long) };
}

// ── Segments ──

/**
 * Recomputes segment membership from the interest profile.
 *
 * Membership is a weight, not a flag, and it is rewritten every rebuild — so a
 * segment the user has stopped engaging with fades out on its own. Nobody is
 * permanently filed under a category they watched once.
 */
export async function rebuildSegments(userId: number): Promise<SegmentMembership[]> {
  const interests = await getInterests(userId);
  const segments = await query<{ id: number; slug: string; name: string }>(
    'SELECT id, slug, name FROM audience_segments WHERE is_enabled = 1',
  );

  const normalised = normalise(interests.combined);
  const memberships: SegmentMembership[] = [];

  for (const segment of segments) {
    const weight = normalised[segment.slug] ?? 0;

    if (weight <= 0.05) {
      // Below the floor the user is simply not in this segment any more. The row
      // is removed rather than kept at zero, so membership genuinely lapses.
      await execute(
        'DELETE FROM user_segments WHERE user_id = :userId AND segment_id = :segmentId',
        { userId, segmentId: segment.id },
      );
      continue;
    }

    await execute(
      `INSERT INTO user_segments (user_id, segment_id, weight, last_reinforced_at, signal_count)
       VALUES (:userId, :segmentId, :weight, NOW(3), 1)
       ON DUPLICATE KEY UPDATE
         weight = VALUES(weight),
         last_reinforced_at = NOW(3),
         signal_count = signal_count + 1`,
      { userId, segmentId: segment.id, weight: Math.round(weight * 10000) / 10000 },
    );

    memberships.push({ slug: segment.slug, name: segment.name, weight });
  }

  return memberships.sort((a, b) => b.weight - a.weight);
}

export async function getSegments(userId: number): Promise<SegmentMembership[]> {
  const rows = await query<{
    slug: string;
    name: string;
    weight: string;
    last_reinforced_at: Date | null;
  }>(
    `SELECT s.slug, s.name, us.weight, us.last_reinforced_at
       FROM user_segments us
       JOIN audience_segments s ON s.id = us.segment_id
      WHERE us.user_id = :userId AND s.is_enabled = 1
      ORDER BY us.weight DESC`,
    { userId },
  );

  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    weight: Number(r.weight),
    ...(r.last_reinforced_at
      ? { lastReinforcedAt: new Date(r.last_reinforced_at).toISOString() }
      : {}),
  }));
}

// ── Creator affinity ──

/**
 * Per (viewer, creator) affinity, time-decayed.
 *
 * Weighted toward deliberate acts. Following someone says far more than
 * watching one of their videos to the end, and a profile visit says more than a
 * passive impression.
 */
const AFFINITY_WEIGHTS: Record<string, number> = {
  follow: 5,
  save: 3,
  share: 3,
  comment: 2.5,
  like: 2,
  profile_visit: 1.5,
  rewatch: 2,
  completion: 1.5,
  watch_30s: 1,
  watch_20s: 0.8,
  unfollow: -4,
  hide_creator: -8,
  not_interested: -3,
  report: -10,
};

const AFFINITY_HALF_LIFE_DAYS = 45;

export async function rebuildCreatorAffinity(userId: number): Promise<number> {
  const rows = await query<{ creator_id: number; event: string; created_at: Date }>(
    `SELECT creator_id, event, created_at FROM behaviour_events
      WHERE user_id = :userId AND creator_id IS NOT NULL
        AND created_at > (NOW(3) - INTERVAL 180 DAY)
      ORDER BY created_at DESC
      LIMIT :limit`,
    { userId, limit: MAX_EVENTS },
  );

  const watches = await query<{ creator_id: number; event: string; created_at: Date }>(
    `SELECT creator_id,
            CASE WHEN rewatched = 1 THEN 'rewatch'
                 WHEN completed = 1 THEN 'completion'
                 WHEN reached_30s = 1 THEN 'watch_30s'
                 WHEN reached_20s = 1 THEN 'watch_20s'
                 ELSE 'watch_2s' END AS event,
            created_at
       FROM watch_events
      WHERE user_id = :userId AND creator_id IS NOT NULL
        AND created_at > (NOW(3) - INTERVAL 180 DAY)
      ORDER BY created_at DESC
      LIMIT :limit`,
    { userId, limit: MAX_EVENTS },
  );

  const scores = new Map<number, { score: number; last: Date }>();
  for (const row of [...rows, ...watches]) {
    const base = AFFINITY_WEIGHTS[row.event];
    if (base === undefined) continue;

    const decay = decayFactor(ageDays(row.created_at), AFFINITY_HALF_LIFE_DAYS);
    const creatorId = Number(row.creator_id);
    const existing = scores.get(creatorId);
    const next = (existing?.score ?? 0) + base * decay;
    const last = existing && existing.last > row.created_at ? existing.last : row.created_at;
    scores.set(creatorId, { score: next, last });
  }

  for (const [creatorId, { score, last }] of scores) {
    // Bounded so the column cannot overflow and one obsessive week cannot
    // dominate the ranking forever.
    const bounded = Math.max(-99, Math.min(99, Math.round(score * 10000) / 10000));
    await execute(
      `INSERT INTO creator_affinity (user_id, creator_id, score, last_signal_at)
       VALUES (:userId, :creatorId, :score, :last)
       ON DUPLICATE KEY UPDATE score = VALUES(score), last_signal_at = VALUES(last_signal_at)`,
      { userId, creatorId, score: bounded, last },
    );
  }

  return scores.size;
}

export async function getCreatorAffinity(userId: number, limit = 50) {
  const rows = await query<{ public_id: string; score: string; last_signal_at: Date | null }>(
    `SELECT u.public_id, a.score, a.last_signal_at
       FROM creator_affinity a
       JOIN users u ON u.id = a.creator_id
      WHERE a.user_id = :userId
      ORDER BY a.score DESC
      LIMIT :limit`,
    { userId, limit },
  );
  return rows.map((r) => ({
    creatorId: r.public_id,
    score: Number(r.score),
    ...(r.last_signal_at ? { lastSignalAt: new Date(r.last_signal_at).toISOString() } : {}),
  }));
}

// ── Priority creator audience ──

/**
 * Who a new video should reach first.
 *
 * The order is the one PHASE_06 specifies: the people most likely to want it,
 * before anybody else. Each tier excludes users already in an earlier one, so a
 * follower who also liked something is contacted once, as a follower.
 *
 * Anyone who has blocked the creator, or been blocked by them, is excluded
 * throughout — distribution must respect the graph.
 */
export async function priorityAudience(
  creatorId: number,
  perTier = 500,
): Promise<PriorityAudience[]> {
  const seen = new Set<number>();
  const out: PriorityAudience[] = [];

  /**
   * Block exclusion, written against a named column.
   *
   * An earlier version referenced the SELECT alias here, which MariaDB rejects
   * in a WHERE clause — and because the failure was caught and logged, the tier
   * silently returned nobody. Taking the column name as a parameter makes the
   * query valid and the mistake impossible to repeat.
   */
  const notBlocked = (column: string) => `
    AND NOT EXISTS (
      SELECT 1 FROM blocks b
       WHERE b.deleted_at IS NULL
         AND ((b.blocker_id = ${column} AND b.blocked_id = :creatorId)
           OR (b.blocker_id = :creatorId AND b.blocked_id = ${column})))`;

  const engagementTier = (event: string, days: number) => `
    SELECT DISTINCT e.user_id AS candidate_id FROM behaviour_events e
     WHERE e.creator_id = :creatorId AND e.event = '${event}'
       AND e.created_at > (NOW(3) - INTERVAL ${days} DAY)
       ${notBlocked('e.user_id')}
     LIMIT :limit`;

  const tiers: { tier: PriorityAudienceTier; sql: string }[] = [
    {
      tier: 'followers',
      sql: `SELECT f.follower_id AS candidate_id FROM follows f
             WHERE f.followee_id = :creatorId AND f.deleted_at IS NULL
               ${notBlocked('f.follower_id')}
             ORDER BY f.created_at DESC LIMIT :limit`,
    },
    { tier: 'previous_likers', sql: engagementTier('like', 90) },
    { tier: 'previous_commenters', sql: engagementTier('comment', 90) },
    { tier: 'previous_sharers', sql: engagementTier('share', 90) },
    { tier: 'previous_savers', sql: engagementTier('save', 90) },
    { tier: 'profile_visitors', sql: engagementTier('profile_visit', 60) },
    {
      tier: 'repeat_viewers',
      sql: `SELECT w.user_id AS candidate_id FROM watch_events w
             WHERE w.creator_id = :creatorId
               AND w.created_at > (NOW(3) - INTERVAL 60 DAY)
               ${notBlocked('w.user_id')}
             GROUP BY w.user_id HAVING COUNT(*) >= 3
             LIMIT :limit`,
    },
    {
      tier: 'long_watch_viewers',
      sql: `SELECT DISTINCT w.user_id AS candidate_id FROM watch_events w
             WHERE w.creator_id = :creatorId
               AND (w.completed = 1 OR w.reached_30s = 1)
               AND w.created_at > (NOW(3) - INTERVAL 60 DAY)
               ${notBlocked('w.user_id')}
             LIMIT :limit`,
    },
  ];

  for (const { tier, sql } of tiers) {
    const rows = await query<{ candidate_id: number }>(sql, {
      creatorId,
      limit: perTier,
    }).catch((err: unknown) => {
      // Loud on purpose: a broken tier returning nobody looks exactly like a
      // creator with no audience, which is how the alias bug went unnoticed.
      logger.error({ err, tier, creatorId }, 'priority audience tier failed');
      throw err;
    });

    const userIds: number[] = [];
    for (const row of rows) {
      const id = Number(row.candidate_id);
      if (id === creatorId || seen.has(id)) continue;
      seen.add(id);
      userIds.push(id);
    }

    if (userIds.length > 0) {
      out.push({ tier, userIds: userIds.map(String) });
    }
  }

  return out;
}

// ── Orchestration ──

/** Rebuilds every derived profile for one user. */
export async function rebuildAll(userId: number): Promise<{
  interests: UserInterests;
  segments: SegmentMembership[];
  creators: number;
}> {
  const interests = await rebuildInterests(userId);
  const segments = await rebuildSegments(userId);
  const creators = await rebuildCreatorAffinity(userId);
  return { interests, segments, creators };
}

/** Topics this user has actively rejected, for candidate suppression. */
export async function suppressedTopics(userId: number): Promise<string[]> {
  const interests = await getInterests(userId);
  return rejectedTopics(interests.combined);
}

/** Creators this user has explicitly hidden. */
export async function hiddenCreators(userId: number): Promise<number[]> {
  const rows = await query<{ creator_id: number }>(
    `SELECT DISTINCT creator_id FROM negative_signals
      WHERE user_id = :userId AND creator_id IS NOT NULL
        AND kind IN ('hide_creator', 'report')`,
    { userId },
  );
  return rows.map((r) => Number(r.creator_id));
}

export { topTopics };

/** Rebuilds the audience profile for a video from who actually engaged with it. */
export async function rebuildVideoAudience(videoId: number): Promise<number> {
  const rows = await query<{ segment_id: number; n: number }>(
    `SELECT us.segment_id, COUNT(DISTINCT w.user_id) AS n
       FROM watch_events w
       JOIN user_segments us ON us.user_id = w.user_id
      WHERE w.video_id = :videoId
        AND (w.completed = 1 OR w.reached_20s = 1)
      GROUP BY us.segment_id`,
    { videoId },
  );

  const total = rows.reduce((sum, r) => sum + Number(r.n), 0);
  if (total === 0) return 0;

  for (const row of rows) {
    const weight = Math.round((Number(row.n) / total) * 10000) / 10000;
    await execute(
      `INSERT INTO video_audience_profiles (video_id, segment_id, weight, sample_size)
       VALUES (:videoId, :segmentId, :weight, :sample)
       ON DUPLICATE KEY UPDATE weight = VALUES(weight), sample_size = VALUES(sample_size)`,
      { videoId, segmentId: row.segment_id, weight, sample: Number(row.n) },
    );
  }

  return rows.length;
}

export async function getVideoAudience(videoId: number) {
  const rows = await query<{ slug: string; name: string; weight: string; sample_size: number }>(
    `SELECT s.slug, s.name, p.weight, p.sample_size
       FROM video_audience_profiles p
       JOIN audience_segments s ON s.id = p.segment_id
      WHERE p.video_id = :videoId
      ORDER BY p.weight DESC`,
    { videoId },
  );
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    weight: Number(r.weight),
    sampleSize: Number(r.sample_size),
  }));
}

export async function countUserEvents(userId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM behaviour_events WHERE user_id = :userId',
    { userId },
  );
  return Number(row?.n ?? 0);
}
