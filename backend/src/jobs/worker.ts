/**
 * Background worker process.
 *
 * Runs separately from the API so a long render cannot starve request handling,
 * and so renders can be scaled independently of the web tier.
 *
 * Each pass: requeue anything a dead worker left claimed, drain the render
 * queue, then sweep abandoned uploads.
 */

import { config } from '../core/config.ts';
import { logger } from '../core/logger.ts';
import { closeDb } from '../core/db.ts';
import { closeRedis } from '../core/redis.ts';
import { ensureStorageReady } from '../core/storage.ts';
import { checkFfmpeg, drainQueue, requeueStalledJobs } from './render.worker.ts';
import { expireStaleSessions } from '../modules/upload/upload.service.ts';
import { pendingVideos, requeueStalledStages } from '../modules/media/pipeline.ts';
import { advance } from './pipeline.worker.ts';
import { pendingRebuilds, markRebuilt } from '../modules/behaviour/events.service.ts';
import { rebuildAll } from '../modules/behaviour/profiles.service.ts';
import { dueForEvaluation, evaluateAndApply } from '../modules/feed/distribution.ts';

const POLL_INTERVAL_MS = 5000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let running = true;
let lastSweep = 0;

async function tick(): Promise<void> {
  try {
    await requeueStalledJobs();
    await requeueStalledStages();

    const handled = await drainQueue(5);
    if (handled > 0) logger.info({ handled }, 'render jobs processed');

    // One stage per video per pass. Advancing a single stage at a time keeps the
    // worker interruptible: being killed between passes loses no work.
    const videos = await pendingVideos(5);
    for (const videoId of videos) {
      const stage = await advance(videoId);
      if (stage) logger.debug({ videoId, stage }, 'processing stage advanced');
    }

    // Derived profiles are rebuilt for users whose behaviour has changed. Doing
    // a bounded number per pass keeps one very active user from starving the
    // rest of the queue.
    const stale = await pendingRebuilds(20);
    for (const userId of stale) {
      try {
        await rebuildAll(userId);
        await markRebuilt(userId);
      } catch (err) {
        logger.error({ err, userId }, 'profile rebuild failed');
      }
    }
    if (stale.length > 0) logger.debug({ count: stale.length }, 'profiles rebuilt');

    // Progressive distribution: videos are re-evaluated on their numbers, and
    // promoted or demoted on performance alone.
    const videosToEvaluate = await dueForEvaluation(20);
    for (const videoId of videosToEvaluate) {
      try {
        const verdict = await evaluateAndApply(videoId);
        if (verdict.applied) {
          logger.info(
            { videoId, from: verdict.fromLevel, to: verdict.toLevel, decision: verdict.decision },
            'distribution level changed',
          );
        }
      } catch (err) {
        logger.error({ err, videoId }, 'distribution evaluation failed');
      }
    }

    if (Date.now() - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = Date.now();
      const expired = await expireStaleSessions();
      if (expired > 0) logger.info({ expired }, 'expired abandoned upload sessions');
    }
  } catch (err) {
    // One bad pass must not kill the worker; the next tick tries again.
    logger.error({ err }, 'worker tick failed');
  }
}

async function main(): Promise<void> {
  await ensureStorageReady();

  const hasFfmpeg = await checkFfmpeg();
  logger.info(
    { env: config.NODE_ENV, ffmpeg: hasFfmpeg },
    hasFfmpeg
      ? 'render worker started'
      : 'render worker started WITHOUT FFmpeg — jobs will fail until it is installed',
  );

  while (running) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function shutdown(signal: string): Promise<void> {
  if (!running) return;
  running = false;
  logger.info({ signal }, 'worker shutting down');
  // The in-flight tick finishes on its own; only the handles are closed here.
  await closeDb().catch(() => undefined);
  await closeRedis().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void main().catch((err: unknown) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
