/**
 * Playback and processing routes.
 *
 * The playback endpoint is where privacy actually bites: it decides whether a
 * viewer may see a video at all, and only then chooses between a plain CDN URL
 * and a signed one. Doing that here rather than in the client is what makes
 * "followers only" mean something.
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { optionalAuth, requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { requireAdmin, requirePermission } from '../../middleware/rbac.ts';
import { audit } from '../../middleware/audit.ts';
import { mediaUrlFor } from '../../core/signed-url.ts';
import { pipelineProgress, resetPipeline, STAGES, type Stage } from './pipeline.ts';

export const mediaRouter: Router = Router();

type Privacy = 'public' | 'followers' | 'friends' | 'private';

interface PlaybackRow {
  id: number;
  public_id: string;
  user_id: number;
  privacy: Privacy;
  status: string;
  processing_status: string;
  hls_key: string | null;
  poster_key: string | null;
  duration_sec: number;
  width: number | null;
  height: number | null;
  owner_public_id: string;
}

/**
 * Decides whether `viewerId` may watch this video.
 *
 * Returns not-found rather than forbidden throughout: telling someone a private
 * video exists is itself a disclosure the owner did not agree to.
 */
async function assertCanWatch(video: PlaybackRow, viewerId: number | undefined): Promise<void> {
  if (video.user_id === viewerId) return;

  if (video.status !== 'published') {
    throw new AppError('not_found', 'Video not found.');
  }

  // A block in either direction hides the video completely.
  if (viewerId !== undefined) {
    const blocked = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM blocks
        WHERE deleted_at IS NULL
          AND ((blocker_id = :viewer AND blocked_id = :owner)
            OR (blocker_id = :owner AND blocked_id = :viewer))`,
      { viewer: viewerId, owner: video.user_id },
    );
    if (Number(blocked?.c ?? 0) > 0) throw new AppError('not_found', 'Video not found.');
  }

  if (video.privacy === 'public') return;
  if (video.privacy === 'private') throw new AppError('not_found', 'Video not found.');

  if (viewerId === undefined) throw new AppError('not_found', 'Video not found.');

  const follows = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM follows
      WHERE follower_id = :viewer AND followee_id = :owner AND deleted_at IS NULL`,
    { viewer: viewerId, owner: video.user_id },
  );
  const viewerFollowsOwner = Number(follows?.c ?? 0) > 0;

  if (video.privacy === 'followers') {
    if (!viewerFollowsOwner) throw new AppError('not_found', 'Video not found.');
    return;
  }

  // "friends" means the follow is mutual.
  const back = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM follows
      WHERE follower_id = :owner AND followee_id = :viewer AND deleted_at IS NULL`,
    { viewer: viewerId, owner: video.user_id },
  );
  if (!viewerFollowsOwner || Number(back?.c ?? 0) === 0) {
    throw new AppError('not_found', 'Video not found.');
  }
}

mediaRouter.get(
  '/videos/:id/playback',
  optionalAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const viewerId = (req as Partial<AuthedRequest>).userId;
    const viewerPublicId = (req as Partial<AuthedRequest>).userPublicId;

    const video = await queryOne<PlaybackRow>(
      `SELECT v.id, v.public_id, v.user_id, v.privacy, v.status, v.processing_status,
              v.hls_key, v.poster_key, v.duration_sec, v.width, v.height,
              u.public_id AS owner_public_id
         FROM videos v
         JOIN users u ON u.id = v.user_id
        WHERE v.public_id = :publicId AND v.deleted_at IS NULL`,
      { publicId: String(req.params.id) },
    );
    if (!video) throw new AppError('not_found', 'Video not found.');

    await assertCanWatch(video, viewerId);

    // Anything not fully processed is reported as not ready. Gating on
    // `status === 'processing'` alone let a *failed* video fall through and be
    // served as playable with a null URL — worse than saying it is not ready.
    if (video.processing_status !== 'complete') {
      res.json(
        ok({
          ready: false,
          processingStatus: video.processing_status,
          failed: video.processing_status === 'failed' || video.status === 'failed',
          progress: await pipelineProgress(video.id),
        }),
      );
      return;
    }

    const renditions = await query<{
      storage_key: string;
      label: string;
      width: number | null;
      height: number | null;
      bitrate_kbps: number | null;
    }>(
      `SELECT storage_key, label, width, height, bitrate_kbps
         FROM video_assets
        WHERE video_id = :videoId AND kind = 'rendition' AND deleted_at IS NULL
        ORDER BY height`,
      { videoId: video.id },
    );

    const sign = (key: string) => mediaUrlFor(key, video.privacy, viewerPublicId);

    res.json(
      ok({
        ready: true,
        videoId: video.public_id,
        durationSec: Number(video.duration_sec),
        width: video.width,
        height: video.height,
        // HLS is preferred; the rendition list is the fallback for players that
        // cannot do adaptive streaming.
        hlsUrl: video.hls_key ? sign(video.hls_key) : null,
        posterUrl: video.poster_key ? sign(video.poster_key) : null,
        renditions: renditions.map((r) => ({
          label: r.label,
          width: r.width,
          height: r.height,
          bitrateKbps: r.bitrate_kbps,
          url: sign(r.storage_key),
        })),
      }),
    );
  }),
);

/** Processing progress, for the "your video is being processed" screen. */
mediaRouter.get(
  '/videos/:id/processing',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const video = await queryOne<{ id: number; user_id: number; processing_status: string }>(
      'SELECT id, user_id, processing_status FROM videos WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: String(req.params.id) },
    );
    if (!video || video.user_id !== authed.userId) {
      throw new AppError('not_found', 'Video not found.');
    }
    res.json(
      ok({
        processingStatus: video.processing_status,
        ...(await pipelineProgress(video.id)),
      }),
    );
  }),
);

/** Decomposed quality score. Visible to the owner, and to admins. */
mediaRouter.get(
  '/videos/:id/quality',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const video = await queryOne<{ id: number; user_id: number }>(
      'SELECT id, user_id FROM videos WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: String(req.params.id) },
    );
    if (!video || video.user_id !== authed.userId) {
      throw new AppError('not_found', 'Video not found.');
    }

    const score = await queryOne<Record<string, unknown>>(
      'SELECT * FROM video_quality_scores WHERE video_id = :id',
      { id: video.id },
    );
    if (!score) throw new AppError('not_found', 'This video has not been scored yet.');

    res.json(
      ok({
        overall: Number(score.overall),
        technical: Number(score.technical),
        contentRelevance: Number(score.content_relevance),
        thumbnailQuality: Number(score.thumbnail_quality),
        captionRelevance: Number(score.caption_relevance),
        spamProbability: Number(score.spam_probability),
        duplicateProbability: Number(score.duplicate_probability),
        safetyStatus: score.safety_status,
        modelVersion: score.model_version,
        detail: typeof score.detail === 'string' ? JSON.parse(score.detail) : score.detail,
      }),
    );
  }),
);

// ── Admin ──

const reprocessSchema = z.object({
  stages: z.array(z.enum(STAGES)).optional(),
  reason: z.string().min(1).max(500),
});

/**
 * Re-runs processing for a video (exit criterion 6).
 *
 * Resets stage rows rather than deleting anything, and never touches the
 * original upload — reprocessing must be safe to run on a live video.
 */
mediaRouter.post(
  '/admin/videos/:id/reprocess',
  requireAuth,
  requireAdmin,
  requirePermission('videos', 'update'),
  validate({ body: reprocessSchema }),
  asyncHandler(async (req: Request, res) => {
    const body = valid<{ body: typeof reprocessSchema }>(req).body;
    const video = await queryOne<{ id: number }>(
      'SELECT id FROM videos WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: String(req.params.id) },
    );
    if (!video) throw new AppError('not_found', 'Video not found.');

    await resetPipeline(video.id, body.stages as Stage[] | undefined);
    await audit(req, {
      module: 'videos',
      action: 'reprocess',
      targetType: 'video',
      targetId: String(req.params.id),
      newValue: { stages: body.stages ?? 'all' },
      reason: body.reason,
    });

    res.json(ok({ queued: true, stages: body.stages ?? STAGES }));
  }),
);

mediaRouter.post(
  '/admin/videos/:id/rescore',
  requireAuth,
  requireAdmin,
  requirePermission('videos', 'update'),
  validate({ body: reprocessSchema }),
  asyncHandler(async (req: Request, res) => {
    const body = valid<{ body: typeof reprocessSchema }>(req).body;
    const video = await queryOne<{ id: number }>(
      'SELECT id FROM videos WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: String(req.params.id) },
    );
    if (!video) throw new AppError('not_found', 'Video not found.');

    await resetPipeline(video.id, ['quality']);
    await audit(req, {
      module: 'videos',
      action: 'rescore',
      targetType: 'video',
      targetId: String(req.params.id),
      reason: body.reason,
    });

    res.json(ok({ queued: true }));
  }),
);
