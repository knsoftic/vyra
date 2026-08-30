/**
 * Render worker.
 *
 * Claims queued render jobs and runs FFmpeg. Deliberate choices:
 *
 * **Claiming is atomic.** The job is moved to `rendering` with a conditional
 * UPDATE, so two workers cannot pick up the same job. Anything else would render
 * a video twice and bill the work twice.
 *
 * **FFmpeg is spawned without a shell.** Arguments go across as an array, so
 * nothing in an edit list can be interpreted as a command.
 *
 * **A missing FFmpeg is reported, not swallowed.** If the binary is absent the
 * job fails with a clear message and the video is marked failed, rather than
 * sitting in `processing` forever while the user waits for something that will
 * never happen.
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execute, query, queryOne } from '../core/db.ts';
import { logger } from '../core/logger.ts';
import { buildKey, localFilePath } from '../core/storage.ts';
import { buildRenderPlan } from '../modules/creative/render.ts';
import type { EditDecisionList } from '../../../shared/contracts/creative.ts';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const MAX_ATTEMPTS = 3;
/** A render that has not finished in this long is assumed stuck. */
const RENDER_TIMEOUT_MS = 15 * 60 * 1000;

interface JobRow {
  id: number;
  public_id: string;
  user_id: number;
  video_id: number | null;
  edit_list: string;
  attempts: number;
}

let ffmpegAvailable: boolean | null = null;

/** Checks once whether FFmpeg can be run at all. */
export async function checkFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  ffmpegAvailable = await new Promise<boolean>((resolve) => {
    const proc = spawn(FFMPEG, ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
  if (!ffmpegAvailable) {
    logger.warn(
      { ffmpeg: FFMPEG },
      'FFmpeg is not available — renders will be queued but cannot complete',
    );
  }
  return ffmpegAvailable;
}

/**
 * Takes the oldest queued job, if any. The conditional UPDATE is the lock: only
 * one worker can move a given row out of `queued`.
 */
async function claimJob(): Promise<JobRow | null> {
  const candidate = await queryOne<JobRow>(
    `SELECT id, public_id, user_id, video_id, edit_list, attempts
       FROM render_jobs
      WHERE status = 'queued' AND attempts < :maxAttempts
      ORDER BY created_at
      LIMIT 1`,
    { maxAttempts: MAX_ATTEMPTS },
  );
  if (!candidate) return null;

  const claimed = await execute(
    `UPDATE render_jobs
        SET status = 'rendering', started_at = NOW(3), attempts = attempts + 1
      WHERE id = :id AND status = 'queued'`,
    { id: candidate.id },
  );
  // Another worker got there first.
  if (claimed.affectedRows === 0) return null;

  if (candidate.video_id) {
    await execute("UPDATE videos SET render_status = 'rendering' WHERE id = :id", {
      id: candidate.video_id,
    });
  }
  return candidate;
}

/** Parses FFmpeg's `-progress` output into a percentage. */
function parseProgress(chunk: string, durationMs: number): number | null {
  const match = /out_time_ms=(\d+)/.exec(chunk);
  if (!match || durationMs <= 0) return null;
  // FFmpeg reports microseconds here despite the name.
  const doneMs = Number(match[1]) / 1000;
  return Math.max(0, Math.min(99, Math.round((doneMs / durationMs) * 100)));
}

async function runFfmpeg(
  args: string[],
  durationMs: number,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Render exceeded ${RENDER_TIMEOUT_MS / 60000} minutes and was stopped.`));
    }, RENDER_TIMEOUT_MS);

    proc.stdout.on('data', (buf: Buffer) => {
      const percent = parseProgress(buf.toString(), durationMs);
      if (percent !== null) onProgress(percent);
    });

    // Keep only the tail: a full FFmpeg log can be megabytes.
    proc.stderr.on('data', (buf: Buffer) => {
      stderr = (stderr + buf.toString()).slice(-4000);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}.`));
    });
  });
}

async function failJob(job: JobRow, message: string): Promise<void> {
  const permanent = job.attempts + 1 >= MAX_ATTEMPTS;
  await execute(
    `UPDATE render_jobs
        SET status = :status, error = :error, finished_at = NOW(3), progress = 0
      WHERE id = :id`,
    {
      id: job.id,
      // Below the attempt limit the job returns to the queue for another try.
      status: permanent ? 'failed' : 'queued',
      error: message.slice(0, 1000),
    },
  );

  if (permanent && job.video_id) {
    await execute(
      "UPDATE videos SET render_status = 'failed', status = 'failed' WHERE id = :id",
      { id: job.video_id },
    );
  }
  logger.error({ jobId: job.public_id, permanent, message }, 'render job failed');
}

export async function processJob(job: JobRow): Promise<void> {
  let edl: EditDecisionList;
  try {
    edl = JSON.parse(job.edit_list) as EditDecisionList;
  } catch {
    await failJob(job, 'The stored edit list could not be read.');
    return;
  }

  if (!(await checkFfmpeg())) {
    await failJob(
      job,
      'FFmpeg is not installed on the render host, so this video cannot be processed. ' +
        'Install FFmpeg and retry the job.',
    );
    return;
  }

  const outputKey = buildKey('render', 'mp4', String(job.user_id));
  const outputPath = localFilePath(outputKey);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const plan = buildRenderPlan(edl, outputPath);
  await execute('UPDATE render_jobs SET filter_graph = :graph WHERE id = :id', {
    id: job.id,
    graph: plan.filterGraph.slice(0, 65000),
  });

  try {
    let lastReported = 0;
    await runFfmpeg(plan.args, plan.durationMs, (percent) => {
      // Throttle writes: FFmpeg emits progress many times a second.
      if (percent - lastReported < 5) return;
      lastReported = percent;
      void execute('UPDATE render_jobs SET progress = :p WHERE id = :id', {
        p: percent,
        id: job.id,
      }).catch(() => undefined);
    });

    await execute(
      `UPDATE render_jobs
          SET status = 'complete', progress = 100, output_key = :key,
              finished_at = NOW(3), error = NULL
        WHERE id = :id`,
      { id: job.id, key: outputKey },
    );

    if (job.video_id) {
      // 'original' — the rendered master is what the transcode stage reads.
      // 'video' is not a member of this enum; before strict mode it was silently
      // written as an empty string, which made the asset invisible to
      // `sourceKeyFor` and stalled the pipeline with no error anywhere.
      await execute(
        `INSERT INTO video_assets (video_id, kind, storage_key, label)
         VALUES (:videoId, 'original', :key, 'render')`,
        { videoId: job.video_id, key: outputKey },
      );
      // Render completion is not publication. The processing pipeline still has
      // to transcode, package and score before the video is servable, and its
      // `publish` stage is what makes it visible. Publishing here would expose a
      // video that has no renditions and no HLS manifest.
      await execute(
        "UPDATE videos SET render_status = 'complete' WHERE id = :id",
        { id: job.video_id },
      );
    }

    logger.info({ jobId: job.public_id, outputKey }, 'render complete');
  } catch (err) {
    await failJob(job, err instanceof Error ? err.message : 'Render failed.');
  }
}

/** Processes queued jobs until the queue is empty. Returns how many it handled. */
export async function drainQueue(limit = 10): Promise<number> {
  let handled = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await claimJob();
    if (!job) break;
    await processJob(job);
    handled += 1;
  }
  return handled;
}

/**
 * Returns jobs stuck in `rendering` to the queue.
 *
 * A worker killed mid-render leaves its job claimed forever. Without this the
 * video would stay in `processing` with nothing working on it.
 */
export async function requeueStalledJobs(olderThanMinutes = 30): Promise<number> {
  const result = await execute(
    `UPDATE render_jobs
        SET status = 'queued', started_at = NULL
      WHERE status = 'rendering'
        AND started_at < (NOW(3) - INTERVAL :mins MINUTE)
        AND attempts < :maxAttempts`,
    { mins: olderThanMinutes, maxAttempts: MAX_ATTEMPTS },
  );
  if (result.affectedRows > 0) {
    logger.warn({ count: result.affectedRows }, 'requeued stalled render jobs');
  }
  return result.affectedRows;
}

export async function queueDepth(): Promise<{ queued: number; rendering: number; failed: number }> {
  const rows = await query<{ status: string; n: number }>(
    "SELECT status, COUNT(*) AS n FROM render_jobs WHERE status IN ('queued','rendering','failed') GROUP BY status",
  );
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return {
    queued: by.queued ?? 0,
    rendering: by.rendering ?? 0,
    failed: by.failed ?? 0,
  };
}
