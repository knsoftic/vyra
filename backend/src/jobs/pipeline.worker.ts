/**
 * Pipeline runner.
 *
 * Executes one stage at a time and records the outcome before moving on, so the
 * process can be killed at any point without losing or duplicating work. Each
 * stage reads what earlier stages recorded rather than recomputing it.
 *
 * Stages that need FFmpeg are skipped with a reason when it is unavailable,
 * rather than failing the whole video. That distinction matters: "we could not
 * transcode because the host has no FFmpeg" is an operational problem to fix,
 * not a broken upload to discard.
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execute, queryOne } from '../core/db.ts';
import { logger } from '../core/logger.ts';
import { buildKey, localFilePath, storage } from '../core/storage.ts';
import { checkFfmpeg } from './render.worker.ts';
import {
  claimStage,
  completeStage,
  failStage,
  initStages,
  nextStage,
  pipelineProgress,
  skipStage,
  deferStage,
  stageOutput,
  type Stage,
} from '../modules/media/pipeline.ts';
import { probe, readHeader, assertHeaderMatches, EMPTY_PROBE, type ProbeResult } from '../modules/media/probe.ts';
import { buildLadderPlan, ladderFor } from '../modules/media/ladder.ts';
import { buildMasterPlaylist, posterArgs, segmentArgs, variantsFor, thumbnailArgs } from '../modules/media/hls.ts';
import { scoreVideo } from '../modules/media/quality.ts';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const STAGE_TIMEOUT_MS = 20 * 60 * 1000;

interface VideoRow {
  id: number;
  public_id: string;
  user_id: number;
  caption: string;
  duration_sec: number;
  privacy: string;
}

async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Stage exceeded its time limit and was stopped.'));
    }, STAGE_TIMEOUT_MS);

    proc.stderr.on('data', (b: Buffer) => {
      stderr = (stderr + b.toString()).slice(-4000);
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

/** The rendered master file, or the original if no render was needed. */
async function sourceKeyFor(videoId: number): Promise<string | null> {
  const asset = await queryOne<{ storage_key: string }>(
    `SELECT storage_key FROM video_assets
      WHERE video_id = :videoId AND kind IN ('original','rendition') AND deleted_at IS NULL
      ORDER BY id LIMIT 1`,
    { videoId },
  );
  return asset?.storage_key ?? null;
}

// ── Individual stages ──

async function runProbe(video: VideoRow): Promise<void> {
  const key = await sourceKeyFor(video.id);
  if (!key) {
    // The render stage has not produced anything yet; probe what we can later.
    await skipStage(video.id, 'probe', 'No source asset available yet.');
    return;
  }

  const filePath = localFilePath(key);

  // Magic bytes before anything opens the file as media.
  try {
    const header = await readHeader(filePath);
    assertHeaderMatches(header, 'video/mp4');
  } catch (err) {
    // A header mismatch on our own render output means something is badly wrong,
    // so it is recorded but does not stop the pipeline.
    logger.warn({ err, videoId: video.id }, 'header check on render output was inconclusive');
  }

  const result = await probe(filePath);

  await execute(
    `INSERT INTO video_probes
       (video_id, container, video_codec, audio_codec, width, height, fps, duration_sec,
        bitrate_kbps, audio_channels, audio_sample_rate, has_audio, rotation, size_bytes, raw)
     VALUES (:videoId, :container, :videoCodec, :audioCodec, :width, :height, :fps, :durationSec,
             :bitrateKbps, :audioChannels, :audioSampleRate, :hasAudio, :rotation, :sizeBytes, :raw)
     ON DUPLICATE KEY UPDATE
       container = VALUES(container), video_codec = VALUES(video_codec),
       audio_codec = VALUES(audio_codec), width = VALUES(width), height = VALUES(height),
       fps = VALUES(fps), duration_sec = VALUES(duration_sec),
       bitrate_kbps = VALUES(bitrate_kbps), audio_channels = VALUES(audio_channels),
       audio_sample_rate = VALUES(audio_sample_rate), has_audio = VALUES(has_audio),
       rotation = VALUES(rotation), size_bytes = VALUES(size_bytes), raw = VALUES(raw)`,
    {
      videoId: video.id,
      container: result.container,
      videoCodec: result.videoCodec,
      audioCodec: result.audioCodec,
      width: result.width,
      height: result.height,
      fps: result.fps,
      durationSec: result.durationSec,
      bitrateKbps: result.bitrateKbps,
      audioChannels: result.audioChannels,
      audioSampleRate: result.audioSampleRate,
      hasAudio: result.hasAudio ? 1 : 0,
      rotation: result.rotation,
      sizeBytes: result.sizeBytes,
      raw: JSON.stringify(result),
    },
  );

  if (result.width && result.height) {
    await execute('UPDATE videos SET width = :w, height = :h WHERE id = :id', {
      w: result.width,
      h: result.height,
      id: video.id,
    });
  }

  await completeStage(video.id, 'probe', result);
}

async function loadProbe(videoId: number): Promise<ProbeResult> {
  const stored = await stageOutput<ProbeResult>(videoId, 'probe');
  return stored ?? { ...EMPTY_PROBE };
}

async function runTranscode(video: VideoRow): Promise<void> {
  if (!(await checkFfmpeg())) {
    await skipStage(video.id, 'transcode', 'FFmpeg is not installed on this host.');
    return;
  }

  const key = await sourceKeyFor(video.id);
  if (!key) {
    await failStage(video.id, 'transcode', 'No source to transcode.');
    return;
  }

  const info = await loadProbe(video.id);
  const width = info.width ?? 1080;
  const height = info.height ?? 1920;
  const fps = info.fps ?? 30;

  const plans = buildLadderPlan(
    localFilePath(key),
    width,
    height,
    (label) => localFilePath(buildKey('render', 'mp4', `${video.public_id}/${label}`)),
    fps,
  );

  const produced: { label: string; key: string; width: number; height: number }[] = [];
  for (const plan of plans) {
    await mkdir(path.dirname(plan.outputPath), { recursive: true });
    await runFfmpeg(plan.args);

    // Recover the storage key from the absolute path the plan was built with.
    const storageKey = plan.outputPath
      .replace(/\\/g, '/')
      .split('/storage/')
      .slice(1)
      .join('/storage/');

    await execute(
      `INSERT INTO video_assets (video_id, kind, storage_key, width, height, bitrate_kbps, label)
       VALUES (:videoId, 'rendition', :key, :width, :height, :bitrate, :label)`,
      {
        videoId: video.id,
        key: storageKey,
        width: Math.round((width * plan.rung.height) / height),
        height: plan.rung.height,
        bitrate: plan.rung.videoKbps,
        label: plan.rung.label,
      },
    );
    produced.push({
      label: plan.rung.label,
      key: storageKey,
      width: Math.round((width * plan.rung.height) / height),
      height: plan.rung.height,
    });
  }

  await completeStage(video.id, 'transcode', { renditions: produced });
}

async function runPackage(video: VideoRow): Promise<void> {
  const transcode = await stageOutput<{ renditions: { label: string }[] }>(video.id, 'transcode');
  if (!transcode || transcode.renditions.length === 0) {
    await skipStage(video.id, 'package', 'No renditions were produced, so there is nothing to package.');
    return;
  }

  if (!(await checkFfmpeg())) {
    await skipStage(video.id, 'package', 'FFmpeg is not installed on this host.');
    return;
  }

  const info = await loadProbe(video.id);
  const rungs = ladderFor(info.height ?? 1920);
  const variants = variantsFor(rungs, info.width ?? 1080, info.height ?? 1920);

  const dirKey = `hls/${video.public_id}`;
  const dirPath = localFilePath(dirKey);
  await mkdir(dirPath, { recursive: true });

  for (const variant of variants) {
    const rendition = transcode.renditions.find((r) => r.label === variant.label);
    if (!rendition) continue;
    const source = localFilePath(
      (rendition as { key?: string }).key ?? '',
    );
    await runFfmpeg(segmentArgs(source, dirPath, variant.label));
  }

  const master = buildMasterPlaylist(variants);
  const masterKey = `${dirKey}/master.m3u8`;
  await storage.put(masterKey, Buffer.from(master, 'utf8'));

  await execute(
    `INSERT INTO video_assets (video_id, kind, storage_key, label)
     VALUES (:videoId, 'hls_manifest', :key, 'master')`,
    { videoId: video.id, key: masterKey },
  );
  await execute('UPDATE videos SET hls_key = :key WHERE id = :id', {
    key: masterKey,
    id: video.id,
  });

  await completeStage(video.id, 'package', { masterKey, variants: variants.map((v) => v.label) });
}

async function runThumbnails(video: VideoRow): Promise<void> {
  if (!(await checkFfmpeg())) {
    await skipStage(video.id, 'thumbnails', 'FFmpeg is not installed on this host.');
    return;
  }
  const key = await sourceKeyFor(video.id);
  if (!key) {
    await skipStage(video.id, 'thumbnails', 'No source available.');
    return;
  }

  const source = localFilePath(key);
  const posterKey = buildKey('image', 'jpg', `${video.public_id}/poster`);
  const posterPath = localFilePath(posterKey);
  await mkdir(path.dirname(posterPath), { recursive: true });

  // A frame a little way in: videos very often open on black.
  const at = Math.min(1, Number(video.duration_sec) / 4);
  await runFfmpeg(posterArgs(source, at, posterPath));

  await execute(
    `INSERT INTO video_assets (video_id, kind, storage_key, label)
     VALUES (:videoId, 'cover', :key, 'poster')`,
    { videoId: video.id, key: posterKey },
  );
  await execute('UPDATE videos SET poster_key = :key WHERE id = :id', {
    key: posterKey,
    id: video.id,
  });

  // Candidate frames for the cover picker.
  const stripKey = buildKey('image', 'jpg', `${video.public_id}/strip`);
  const stripPattern = localFilePath(stripKey).replace(/\.jpg$/, '_%02d.jpg');
  await runFfmpeg(thumbnailArgs(source, Number(video.duration_sec), 6, stripPattern));

  await completeStage(video.id, 'thumbnails', { posterKey, candidates: 6 });
}

async function runQuality(video: VideoRow): Promise<void> {
  const info = await loadProbe(video.id);

  const counts = await queryOne<{ hashtags: number; mentions: number }>(
    `SELECT
       (SELECT COUNT(*) FROM video_hashtags WHERE video_id = :id) AS hashtags,
       (SELECT COUNT(*) FROM video_mentions WHERE video_id = :id) AS mentions`,
    { id: video.id },
  );

  const score = scoreVideo({
    probe: info,
    caption: {
      caption: video.caption ?? '',
      hashtagCount: Number(counts?.hashtags ?? 0),
      mentionCount: Number(counts?.mentions ?? 0),
    },
  });

  await execute(
    `INSERT INTO video_quality_scores
       (video_id, overall, technical, content_relevance, thumbnail_quality, caption_relevance,
        spam_probability, duplicate_probability, safety_status, detail, model_version, scored_at)
     VALUES (:videoId, :overall, :technical, :contentRelevance, :thumbnailQuality, :captionRelevance,
             :spam, :duplicate, :safety, :detail, :modelVersion, NOW(3))
     ON DUPLICATE KEY UPDATE
       overall = VALUES(overall), technical = VALUES(technical),
       content_relevance = VALUES(content_relevance),
       thumbnail_quality = VALUES(thumbnail_quality),
       caption_relevance = VALUES(caption_relevance),
       spam_probability = VALUES(spam_probability),
       duplicate_probability = VALUES(duplicate_probability),
       safety_status = VALUES(safety_status), detail = VALUES(detail),
       model_version = VALUES(model_version), scored_at = NOW(3)`,
    {
      videoId: video.id,
      overall: score.overall,
      technical: score.technical,
      contentRelevance: score.contentRelevance,
      thumbnailQuality: score.thumbnailQuality,
      captionRelevance: score.captionRelevance,
      spam: score.spamProbability,
      duplicate: score.duplicateProbability,
      safety: score.safetyStatus,
      detail: JSON.stringify(score.detail),
      modelVersion: score.modelVersion,
    },
  );

  await completeStage(video.id, 'quality', score);
}

async function runPublishStage(video: VideoRow): Promise<void> {
  const packaged = await stageOutput<{ masterKey: string }>(video.id, 'package');

  // Without HLS the video is still playable from its rendition, so this is not a
  // failure — it just means adaptive streaming is unavailable for this one.
  await execute(
    `UPDATE videos
        SET processing_status = 'complete',
            status = CASE WHEN status = 'processing' THEN 'published' ELSE status END,
            published_at = COALESCE(published_at, NOW(3))
      WHERE id = :id`,
    { id: video.id },
  );

  await completeStage(video.id, 'publish', { hls: packaged?.masterKey ?? null });
  logger.info({ videoId: video.id }, 'processing pipeline complete');
}

/** Stages the render worker already handles. */
async function runRenderStage(video: VideoRow): Promise<void> {
  const job = await queryOne<{ status: string; output_key: string | null }>(
    'SELECT status, output_key FROM render_jobs WHERE video_id = :id ORDER BY id DESC LIMIT 1',
    { id: video.id },
  );

  if (!job) {
    await skipStage(video.id, 'render', 'No render job for this video.');
    return;
  }
  if (job.status === 'complete') {
    await completeStage(video.id, 'render', { outputKey: job.output_key });
    return;
  }
  if (job.status === 'failed') {
    await failStage(video.id, 'render', 'The render job failed.');
    return;
  }
  // Still queued or rendering. Defer rather than fail: waiting on the render
  // worker must not consume an attempt, or a slow render would exhaust the
  // retry budget and strand the video.
  await deferStage(video.id, 'render', `Waiting for the render job (${job.status}).`);
}

async function runAudioStage(video: VideoRow): Promise<void> {
  if (!(await checkFfmpeg())) {
    await skipStage(video.id, 'audio', 'FFmpeg is not installed on this host.');
    return;
  }
  const info = await loadProbe(video.id);
  if (!info.hasAudio) {
    await skipStage(video.id, 'audio', 'This video has no audio track.');
    return;
  }
  await completeStage(video.id, 'audio', { extracted: false, note: 'Audio extraction pending Phase 9.' });
}

const RUNNERS: Record<Stage, (video: VideoRow) => Promise<void>> = {
  probe: runProbe,
  render: runRenderStage,
  transcode: runTranscode,
  package: runPackage,
  thumbnails: runThumbnails,
  audio: runAudioStage,
  quality: runQuality,
  publish: runPublishStage,
};

/**
 * Advances one video by a single stage.
 *
 * Returns the stage it ran, or null when there was nothing to do. Running one
 * stage per call is what keeps the work interruptible: a kill between calls
 * loses nothing.
 */
export async function advance(videoId: number): Promise<Stage | null> {
  const video = await queryOne<VideoRow>(
    'SELECT id, public_id, user_id, caption, duration_sec, privacy FROM videos WHERE id = :id',
    { id: videoId },
  );
  if (!video) return null;

  await initStages(videoId);
  const stage = await nextStage(videoId);
  if (!stage) return null;

  if (!(await claimStage(videoId, stage))) return null;

  await execute(
    "UPDATE videos SET processing_status = 'processing' WHERE id = :id AND processing_status = 'pending'",
    { id: videoId },
  );

  try {
    await RUNNERS[stage](video);
  } catch (err) {
    await failStage(videoId, stage, err instanceof Error ? err.message : 'Stage failed.');
  }

  // Reconcile the video's own status from the stage table, every time. A stage
  // can fail either by throwing or by calling failStage directly, so doing this
  // only in the catch block left `status` and `processing_status` disagreeing —
  // the video read as failed in one column and still processing in the other.
  const progress = await pipelineProgress(videoId);
  if (progress.failed > 0) {
    await execute(
      "UPDATE videos SET processing_status = 'failed' WHERE id = :id AND processing_status <> 'failed'",
      { id: videoId },
    );
  }
  return stage;
}

/** Runs a video to completion, one stage at a time. */
export async function processVideo(videoId: number, maxStages = 20): Promise<number> {
  let ran = 0;
  for (let i = 0; i < maxStages; i += 1) {
    const stage = await advance(videoId);
    if (!stage) break;
    ran += 1;
  }
  return ran;
}
