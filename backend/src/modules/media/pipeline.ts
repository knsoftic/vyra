/**
 * The processing pipeline.
 *
 * probe → render → transcode → package → thumbnails → audio → quality → publish
 *
 * Every stage is recorded in `processing_stages`, and that is what makes the
 * pipeline resumable. A worker killed halfway through leaves its stages in a
 * known state; the next worker skips everything already `complete` and picks up
 * from the first that is not. No stage is ever repeated, so nothing is
 * duplicated, and the original upload is never touched, so nothing is lost.
 *
 * Claiming a stage is an atomic conditional UPDATE, so two workers racing on the
 * same video cannot both run the same stage.
 */

import { execute, query, queryOne } from '../../core/db.ts';
import { logger } from '../../core/logger.ts';

export const STAGES = [
  'probe',
  'render',
  'transcode',
  'package',
  'thumbnails',
  'audio',
  'quality',
  'publish',
] as const;

export type Stage = (typeof STAGES)[number];
export type StageStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

/** Give up on a stage after this many attempts. */
export const MAX_STAGE_ATTEMPTS = 3;

interface StageRow {
  id: number;
  video_id: number;
  stage: Stage;
  status: StageStatus;
  attempts: number;
  output: string | null;
  error: string | null;
}

/** Creates the stage rows for a video. Safe to call repeatedly. */
export async function initStages(videoId: number): Promise<void> {
  for (const stage of STAGES) {
    await execute(
      `INSERT INTO processing_stages (video_id, stage, status)
       VALUES (:videoId, :stage, 'pending')
       ON DUPLICATE KEY UPDATE video_id = video_id`,
      { videoId, stage },
    );
  }
}

export async function getStages(videoId: number): Promise<StageRow[]> {
  return query<StageRow>(
    'SELECT * FROM processing_stages WHERE video_id = :videoId ORDER BY id',
    { videoId },
  );
}

/** The first stage still to run, or null when the pipeline is finished. */
export async function nextStage(videoId: number): Promise<Stage | null> {
  const rows = await getStages(videoId);
  const byStage = new Map(rows.map((r) => [r.stage, r]));

  for (const stage of STAGES) {
    const row = byStage.get(stage);
    if (!row) return stage;
    if (row.status === 'complete' || row.status === 'skipped') continue;
    // A failed stage that has exhausted its attempts stops the pipeline rather
    // than being retried forever.
    if (row.status === 'failed' && row.attempts >= MAX_STAGE_ATTEMPTS) return null;
    return stage;
  }
  return null;
}

/**
 * Claims a stage for this worker.
 *
 * Returns false when another worker already holds it, or when it is finished.
 * The conditional UPDATE is the lock — `status` moving out of pending/failed can
 * only happen once.
 */
export async function claimStage(videoId: number, stage: Stage): Promise<boolean> {
  const result = await execute(
    `UPDATE processing_stages
        SET status = 'running', attempts = attempts + 1, started_at = NOW(3), error = NULL
      WHERE video_id = :videoId AND stage = :stage
        AND status IN ('pending', 'failed')
        AND attempts < :maxAttempts`,
    { videoId, stage, maxAttempts: MAX_STAGE_ATTEMPTS },
  );
  return result.affectedRows === 1;
}

export async function completeStage(
  videoId: number,
  stage: Stage,
  output?: unknown,
): Promise<void> {
  await execute(
    `UPDATE processing_stages
        SET status = 'complete', finished_at = NOW(3), output = :output, error = NULL
      WHERE video_id = :videoId AND stage = :stage`,
    { videoId, stage, output: output === undefined ? null : JSON.stringify(output) },
  );
}

export async function skipStage(videoId: number, stage: Stage, reason: string): Promise<void> {
  await execute(
    `UPDATE processing_stages
        SET status = 'skipped', finished_at = NOW(3), error = :reason
      WHERE video_id = :videoId AND stage = :stage`,
    { videoId, stage, reason: reason.slice(0, 1000) },
  );
}

/**
 * Returns a stage to the queue without consuming an attempt.
 *
 * Waiting on something external — a render job that has not finished yet — is
 * not a failed attempt. Treating it as one means a stage that is merely slow
 * exhausts its retries and the video stalls forever even though nothing went
 * wrong. The attempt counter is rolled back so only genuine failures count
 * toward the limit.
 */
export async function deferStage(videoId: number, stage: Stage, reason: string): Promise<void> {
  await execute(
    `UPDATE processing_stages
        SET status = 'pending',
            attempts = GREATEST(CAST(attempts AS SIGNED) - 1, 0),
            started_at = NULL,
            error = :reason
      WHERE video_id = :videoId AND stage = :stage`,
    { videoId, stage, reason: reason.slice(0, 1000) },
  );
}

export async function failStage(videoId: number, stage: Stage, error: string): Promise<void> {
  await execute(
    `UPDATE processing_stages
        SET status = 'failed', finished_at = NOW(3), error = :error
      WHERE video_id = :videoId AND stage = :stage`,
    { videoId, stage, error: error.slice(0, 1000) },
  );
  logger.error({ videoId, stage, error }, 'processing stage failed');
}

/** Reads back what a completed stage produced. */
export async function stageOutput<T>(videoId: number, stage: Stage): Promise<T | null> {
  const row = await queryOne<StageRow>(
    'SELECT * FROM processing_stages WHERE video_id = :videoId AND stage = :stage',
    { videoId, stage },
  );
  if (!row?.output) return null;
  try {
    return JSON.parse(row.output) as T;
  } catch {
    return null;
  }
}

export interface PipelineProgress {
  total: number;
  complete: number;
  failed: number;
  running: number;
  percent: number;
  currentStage: Stage | null;
  stages: { stage: Stage; status: StageStatus; attempts: number; error: string | null }[];
}

export async function pipelineProgress(videoId: number): Promise<PipelineProgress> {
  const rows = await getStages(videoId);
  const complete = rows.filter((r) => r.status === 'complete' || r.status === 'skipped').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const running = rows.filter((r) => r.status === 'running').length;
  const current = rows.find((r) => r.status === 'running')?.stage ?? (await nextStage(videoId));

  return {
    total: STAGES.length,
    complete,
    failed,
    running,
    percent: Math.round((complete / STAGES.length) * 100),
    currentStage: current,
    stages: rows.map((r) => ({
      stage: r.stage,
      status: r.status,
      attempts: Number(r.attempts),
      error: r.error,
    })),
  };
}

/**
 * Returns stages a dead worker left `running` to the queue.
 *
 * Without this a killed worker's stage stays claimed forever and the video never
 * finishes. Attempts are not reset, so a stage that keeps killing workers still
 * hits its limit rather than looping indefinitely.
 */
export async function requeueStalledStages(olderThanMinutes = 30): Promise<number> {
  const result = await execute(
    `UPDATE processing_stages
        SET status = 'pending', started_at = NULL
      WHERE status = 'running'
        AND started_at < (NOW(3) - INTERVAL :mins MINUTE)
        AND attempts < :maxAttempts`,
    { mins: olderThanMinutes, maxAttempts: MAX_STAGE_ATTEMPTS },
  );
  if (result.affectedRows > 0) {
    logger.warn({ count: result.affectedRows }, 'requeued stalled processing stages');
  }
  return result.affectedRows;
}

/**
 * Resets a video's pipeline so it runs again.
 *
 * Used by the admin "reprocess" action. Stage rows are reset rather than
 * deleted, and the original upload is untouched — reprocessing must never risk
 * the source.
 */
export async function resetPipeline(videoId: number, stages?: Stage[]): Promise<void> {
  const target = stages ?? [...STAGES];
  await execute(
    `UPDATE processing_stages
        SET status = 'pending', attempts = 0, error = NULL,
            started_at = NULL, finished_at = NULL
      WHERE video_id = :videoId
        AND stage IN (${target.map((_, i) => `:s${i}`).join(', ')})`,
    { videoId, ...Object.fromEntries(target.map((s, i) => [`s${i}`, s])) },
  );
  await execute(
    "UPDATE videos SET processing_status = 'pending' WHERE id = :videoId",
    { videoId },
  );
  logger.info({ videoId, stages: target }, 'pipeline reset for reprocessing');
}

/** Videos with work outstanding, oldest first. */
export async function pendingVideos(limit = 10): Promise<number[]> {
  const rows = await query<{ video_id: number }>(
    `SELECT DISTINCT video_id FROM processing_stages
      WHERE status IN ('pending', 'failed') AND attempts < :maxAttempts
      ORDER BY video_id
      LIMIT :limit`,
    { maxAttempts: MAX_STAGE_ATTEMPTS, limit },
  );
  return rows.map((r) => Number(r.video_id));
}
