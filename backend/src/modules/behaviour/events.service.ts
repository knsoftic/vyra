/**
 * Event ingestion.
 *
 * Events arrive in batches, because a phone that sends one HTTP request per
 * scroll would flatten its own battery. Each event carries a client-generated
 * dedupe key and the timestamp it happened at.
 *
 * **Exactly-once** comes from `(dedupe_key, created_at)` being unique and
 * `created_at` being the *client's* timestamp rather than arrival time. A retry
 * therefore carries an identical pair and is rejected by the index. Using
 * arrival time would let the same event in twice under retry — which is exactly
 * what an unreliable mobile connection produces.
 *
 * A duplicate is not an error. It means the client retried something that had
 * already landed, which is the system working as intended, so it is counted and
 * reported rather than failed.
 */

import { createHash } from 'node:crypto';
import { execute, query, queryOne } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import { interpretWatch, watchEventsFor, countsAsView } from './watch.ts';
import { inspectPayload, sanitiseQuery } from './privacy.ts';
import {
  ALL_EVENTS,
  type BehaviourEvent,
  type EventBatchResult,
  type EventInput,
} from '../../../../shared/contracts/behaviour.ts';

const VALID_EVENTS = new Set<string>(ALL_EVENTS);

/** An event timestamped further than this from now is not trustworthy. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_BATCH = 200;

const WATCH_EVENT_SET = new Set([
  'watch_2s', 'watch_5s', 'watch_10s', 'watch_20s', 'watch_30s',
  'completion', 'rewatch', 'quick_skip', 'video_start',
]);

/** Normalises a client key to the fixed width the unique index expects. */
const normaliseDedupeKey = (key: string): string =>
  createHash('md5').update(key).digest('hex');

interface Resolved {
  videoId: number | null;
  creatorId: number | null;
  categoryId: number | null;
  hashtagId: number | null;
}

/**
 * Resolves public ids to internal row ids.
 *
 * Unknown ids resolve to null rather than failing the event: a video deleted
 * between being watched and the event arriving is normal, and losing the whole
 * batch over it would be worse than losing one association.
 */
async function resolveIds(input: EventInput): Promise<Resolved> {
  const out: Resolved = { videoId: null, creatorId: null, categoryId: null, hashtagId: null };

  if (input.videoId) {
    const video = await queryOne<{ id: number; user_id: number; category_id: number | null }>(
      'SELECT id, user_id, category_id FROM videos WHERE public_id = :publicId',
      { publicId: input.videoId },
    );
    if (video) {
      out.videoId = video.id;
      out.creatorId = video.user_id;
      // The category comes from the video, not the client. Without this an
      // event about a video contributes nothing to the interest profile, which
      // is the entire point of collecting it.
      out.categoryId = video.category_id;
    }
  }

  // An explicit creator id wins over the one inferred from the video.
  if (input.creatorId) {
    const creator = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: input.creatorId },
    );
    if (creator) out.creatorId = creator.id;
  }

  if (input.categoryId) {
    const category = await queryOne<{ id: number }>(
      'SELECT id FROM categories WHERE id = :id',
      { id: Number(input.categoryId) },
    );
    if (category) out.categoryId = category.id;
  }

  if (input.hashtagId) {
    const hashtag = await queryOne<{ id: number }>('SELECT id FROM hashtags WHERE id = :id', {
      id: Number(input.hashtagId),
    });
    if (hashtag) out.hashtagId = hashtag.id;
  }

  return out;
}

/** Validates one event's shape, timing and privacy. */
function validate(input: EventInput): string | null {
  if (!VALID_EVENTS.has(input.event)) return `Unknown event type "${input.event}".`;
  if (!input.dedupeKey || input.dedupeKey.length > 128) return 'A valid dedupeKey is required.';

  const occurred = new Date(input.occurredAt).getTime();
  if (!Number.isFinite(occurred)) return 'occurredAt must be a valid timestamp.';

  const skew = Math.abs(Date.now() - occurred);
  if (skew > MAX_CLOCK_SKEW_MS) {
    // Accepting an event dated next year would corrupt every time-decayed
    // profile it touches.
    return 'occurredAt is too far from the current time to be trusted.';
  }

  const verdict = inspectPayload(input as unknown as Record<string, unknown>);
  if (!verdict.ok) {
    return `Payload contains fields that must never be sent: ${verdict.forbidden.join(', ')}.`;
  }

  return null;
}

/**
 * Ingests a batch.
 *
 * Each event is inserted independently so one bad event cannot lose the rest —
 * a batch is a transport convenience, not a transaction.
 */
export async function ingest(userId: number, events: EventInput[]): Promise<EventBatchResult> {
  if (events.length === 0) return { accepted: 0, duplicates: 0, rejected: [] };
  if (events.length > MAX_BATCH) {
    throw new AppError('bad_request', `A batch may contain at most ${MAX_BATCH} events.`);
  }

  const result: EventBatchResult = { accepted: 0, duplicates: 0, rejected: [] };

  for (const input of events) {
    const problem = validate(input);
    if (problem) {
      result.rejected.push({ dedupeKey: input.dedupeKey ?? '(none)', reason: problem });
      if (problem.startsWith('Payload contains fields')) {
        // Worth surfacing: a client is trying to send something it should not.
        logger.warn({ userId, event: input.event, problem }, 'event payload rejected on privacy grounds');
      }
      continue;
    }

    try {
      const ids = await resolveIds(input);
      const occurredAt = new Date(input.occurredAt);
      const dedupeKey = normaliseDedupeKey(input.dedupeKey);

      const written = WATCH_EVENT_SET.has(input.event)
        ? await insertWatch(userId, input, ids, occurredAt, dedupeKey)
        : await insertGeneric(userId, input, ids, occurredAt, dedupeKey);

      if (written) result.accepted += 1;
      else result.duplicates += 1;
    } catch (err) {
      logger.error({ err, userId, event: input.event }, 'event ingestion failed');
      result.rejected.push({ dedupeKey: input.dedupeKey, reason: 'Could not be stored.' });
    }
  }

  if (result.accepted > 0) await queueRebuild(userId);
  return result;
}

/** Returns false when the row already existed. */
async function insertGeneric(
  userId: number,
  input: EventInput,
  ids: Resolved,
  occurredAt: Date,
  dedupeKey: string,
): Promise<boolean> {
  const detail: Record<string, unknown> = {};
  if (input.rank !== undefined) detail.rank = input.rank;
  if (input.query) detail.query = sanitiseQuery(input.query);

  const result = await execute(
    `INSERT IGNORE INTO behaviour_events
       (user_id, event, video_id, creator_id, category_id, hashtag_id, session_id,
        feed_source, detail, app_version, device_tier, dedupe_key, created_at)
     VALUES (:userId, :event, :videoId, :creatorId, :categoryId, :hashtagId, :sessionId,
             :feedSource, :detail, :appVersion, :deviceTier, :dedupeKey, :createdAt)`,
    {
      userId,
      event: input.event,
      videoId: ids.videoId,
      creatorId: ids.creatorId,
      categoryId: ids.categoryId,
      hashtagId: ids.hashtagId,
      sessionId: input.sessionId ?? null,
      feedSource: input.feedSource ?? null,
      detail: Object.keys(detail).length > 0 ? JSON.stringify(detail) : null,
      appVersion: input.appVersion ?? null,
      deviceTier: input.deviceTier ?? null,
      dedupeKey,
      createdAt: occurredAt,
    },
  );

  if (result.affectedRows > 0) {
    await recordNegativeSignal(userId, input, ids, occurredAt);
  }
  return result.affectedRows > 0;
}

/**
 * Watch events go to their own table, with the ADR-009 interpretation attached.
 *
 * The client sends raw milliseconds; what those milliseconds *mean* is decided
 * here, so the rule can change without an app release and cannot be inflated by
 * a modified client.
 */
async function insertWatch(
  userId: number,
  input: EventInput,
  ids: Resolved,
  occurredAt: Date,
  dedupeKey: string,
): Promise<boolean> {
  const signal = interpretWatch({
    watchMs: input.watchMs ?? 0,
    videoMs: input.videoMs ?? 0,
  });

  const result = await execute(
    `INSERT IGNORE INTO watch_events
       (user_id, video_id, creator_id, session_id, feed_source, watch_ms, video_ms,
        completion_rate, reached_2s, reached_20s, reached_30s, completed, rewatched,
        quick_skip, dedupe_key, created_at)
     VALUES (:userId, :videoId, :creatorId, :sessionId, :feedSource, :watchMs, :videoMs,
             :completionRate, :reached2s, :reached20s, :reached30s, :completed, :rewatched,
             :quickSkip, :dedupeKey, :createdAt)`,
    {
      userId,
      videoId: ids.videoId,
      creatorId: ids.creatorId,
      sessionId: input.sessionId ?? null,
      feedSource: input.feedSource ?? 'for_you',
      watchMs: Math.round(signal.watchMs),
      videoMs: Math.round(signal.videoMs),
      completionRate: signal.completionRate,
      reached2s: signal.reached2s ? 1 : 0,
      reached20s: signal.reached20s ? 1 : 0,
      reached30s: signal.reached30s ? 1 : 0,
      completed: signal.completed ? 1 : 0,
      rewatched: signal.rewatched ? 1 : 0,
      quickSkip: signal.quickSkip ? 1 : 0,
      dedupeKey,
      createdAt: occurredAt,
    },
  );

  if (result.affectedRows === 0) return false;

  if (signal.quickSkip && ids.videoId) {
    await recordNegativeSignal(userId, { ...input, event: 'quick_skip' }, ids, occurredAt);
  }
  if (countsAsView(signal) && ids.videoId) {
    await execute('UPDATE videos SET view_count = view_count + 1 WHERE id = :id', {
      id: ids.videoId,
    }).catch(() => undefined);
  }
  return true;
}

const NEGATIVE_EVENTS = new Set(['not_interested', 'hide_creator', 'quick_skip', 'unfollow', 'report']);

/**
 * Mirrors rejections into `negative_signals`.
 *
 * They live in their own table because they are read on a different path —
 * candidate suppression, not profile weighting — and because a rejection must
 * never be silently lost among a million watch rows.
 */
async function recordNegativeSignal(
  userId: number,
  input: EventInput,
  ids: Resolved,
  occurredAt: Date,
): Promise<void> {
  if (!NEGATIVE_EVENTS.has(input.event)) return;
  await execute(
    `INSERT INTO negative_signals (user_id, video_id, creator_id, category_id, kind, created_at)
     VALUES (:userId, :videoId, :creatorId, :categoryId, :kind, :createdAt)`,
    {
      userId,
      videoId: ids.videoId,
      creatorId: ids.creatorId,
      categoryId: ids.categoryId,
      kind: input.event,
      createdAt: occurredAt,
    },
  ).catch((err: unknown) => logger.warn({ err, userId }, 'negative signal not recorded'));
}

/** Marks the user's derived profiles as needing a rebuild. */
export async function queueRebuild(userId: number, reason = 'signal'): Promise<void> {
  await execute(
    `INSERT INTO profile_rebuild_queue (user_id, reason, queued_at, processed_at)
     VALUES (:userId, :reason, NOW(3), NULL)
     ON DUPLICATE KEY UPDATE queued_at = NOW(3), processed_at = NULL, reason = VALUES(reason)`,
    { userId, reason },
  ).catch((err: unknown) => logger.warn({ err, userId }, 'could not queue profile rebuild'));
}

/** Users whose profiles are stale, oldest first. */
export async function pendingRebuilds(limit = 50): Promise<number[]> {
  const rows = await query<{ user_id: number }>(
    `SELECT user_id FROM profile_rebuild_queue
      WHERE processed_at IS NULL
      ORDER BY queued_at
      LIMIT :limit`,
    { limit },
  );
  return rows.map((r) => Number(r.user_id));
}

export async function markRebuilt(userId: number): Promise<void> {
  await execute(
    'UPDATE profile_rebuild_queue SET processed_at = NOW(3) WHERE user_id = :userId',
    { userId },
  );
}

export { watchEventsFor };
export type { BehaviourEvent };
