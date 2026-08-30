/**
 * Publishing.
 *
 * Publishing creates the video row and queues a render; it does not render
 * inline. Transcoding takes far longer than an HTTP request should, and a
 * publish must not be lost because a phone locked its screen.
 *
 * The video is created in `processing` and only becomes visible when the render
 * completes. A video row that exists but has no playable file is worse than one
 * that is briefly absent — the feed would serve something that cannot play.
 */

import { ulid } from 'ulid';
import { execute, queryOne, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import { timelineDurationMs } from '../creative/edl.ts';
import { recordAssetUsage } from '../creative/catalogue.service.ts';
import { consumeDraft } from './drafts.service.ts';
import type { EditDecisionList } from '../../../../shared/contracts/creative.ts';
import type { PublishResult } from '../../../../shared/contracts/creative.ts';

/**
 * The column already carries every value the app uses, so this is a pass-through
 * guard rather than a translation. An earlier version mapped `followers` to
 * `friends`, which silently published to a different audience than the user
 * chose — the two are distinct on purpose.
 */
const PRIVACY = {
  public: 'public',
  followers: 'followers',
  friends: 'friends',
  private: 'private',
} as const;

export interface PublishInput {
  editList: EditDecisionList;
  caption: string;
  privacy: 'public' | 'followers' | 'friends' | 'private';
  categoryId?: string;
  coverKey?: string;
  coverTimeMs?: number;
  hashtags?: string[];
  mentions?: string[];
  locationName?: string;
  allowComments?: boolean;
  allowShare?: boolean;
  allowDownload?: boolean;
  allowRemix?: boolean;
  allowDuet?: boolean;
  draftId?: string;
}

/** Extracts `#tags` from a caption, merged with any sent explicitly. */
export function extractHashtags(caption: string, explicit: string[] = []): string[] {
  const found = [...caption.matchAll(/#([\p{L}\p{N}_]{1,64})/gu)].map((m) => m[1]!.toLowerCase());
  const all = [...explicit.map((t) => t.replace(/^#/, '').toLowerCase()), ...found];
  return [...new Set(all)].filter((t) => t.length > 0).slice(0, 30);
}

export function extractMentions(caption: string, explicit: string[] = []): string[] {
  const found = [...caption.matchAll(/@([a-z0-9._]{3,30})/gi)].map((m) => m[1]!.toLowerCase());
  const all = [...explicit.map((u) => u.replace(/^@/, '').toLowerCase()), ...found];
  return [...new Set(all)].slice(0, 30);
}

async function linkHashtags(videoId: number, tags: string[]): Promise<void> {
  for (const tag of tags) {
    await execute(
      `INSERT INTO hashtags (tag, video_count) VALUES (:tag, 1)
       ON DUPLICATE KEY UPDATE video_count = video_count + 1`,
      { tag },
    );
    const row = await queryOne<{ id: number }>('SELECT id FROM hashtags WHERE tag = :tag', { tag });
    if (row) {
      await execute(
        'INSERT IGNORE INTO video_hashtags (video_id, hashtag_id) VALUES (:videoId, :hashtagId)',
        { videoId, hashtagId: row.id },
      );
    }
  }
}

async function linkMentions(videoId: number, usernames: string[]): Promise<void> {
  for (const username of usernames) {
    const user = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE username = :username AND deleted_at IS NULL',
      { username },
    );
    if (!user) continue;
    await execute(
      'INSERT IGNORE INTO video_mentions (video_id, user_id) VALUES (:videoId, :userId)',
      { videoId, userId: user.id },
    );
  }
}

/**
 * Creates the video and its render job atomically.
 *
 * If the render job cannot be written, the video row is rolled back too —
 * otherwise the user would see a video stuck in `processing` forever with
 * nothing queued to finish it.
 */
export async function publish(userId: number, input: PublishInput): Promise<PublishResult> {
  const durationSec = Math.round(timelineDurationMs(input.editList) / 1000);
  if (durationSec <= 0) {
    throw new AppError('validation_failed', 'This edit produces an empty video.');
  }

  const caption = input.caption.slice(0, 2200);
  const hashtags = extractHashtags(caption, input.hashtags);
  const mentions = extractMentions(caption, input.mentions);

  const videoPublicId = ulid();
  const jobPublicId = ulid();

  const { videoId, jobId } = await transaction(async (tx) => {
    const videoResult = await execute(
      `INSERT INTO videos
         (public_id, user_id, category_id, caption, duration_sec, cover_time_ms, privacy, status,
          allow_comments, allow_share, allow_download, allow_remix, allow_duet,
          location_name, edit_list, render_status)
       VALUES
         (:publicId, :userId, :categoryId, :caption, :durationSec, :coverTimeMs, :privacy, 'processing',
          :allowComments, :allowShare, :allowDownload, :allowRemix, :allowDuet,
          :locationName, :editList, 'queued')`,
      {
        publicId: videoPublicId,
        userId,
        categoryId: input.categoryId ? Number(input.categoryId) : null,
        // Null means the pipeline picks a frame; a number is the person's own choice.
        coverTimeMs: input.coverTimeMs ?? null,
        caption,
        durationSec,
        privacy: PRIVACY[input.privacy],
        allowComments: input.allowComments === false ? 0 : 1,
        allowShare: input.allowShare === false ? 0 : 1,
        allowDownload: input.allowDownload === false ? 0 : 1,
        allowRemix: input.allowRemix === false ? 0 : 1,
        allowDuet: input.allowDuet === false ? 0 : 1,
        locationName: input.locationName?.slice(0, 120) ?? null,
        editList: JSON.stringify(input.editList),
      },
      tx,
    );

    const jobResult = await execute(
      `INSERT INTO render_jobs (public_id, user_id, video_id, edit_list, status)
       VALUES (:publicId, :userId, :videoId, :editList, 'queued')`,
      {
        publicId: jobPublicId,
        userId,
        videoId: videoResult.insertId,
        editList: JSON.stringify(input.editList),
      },
      tx,
    );

    return { videoId: videoResult.insertId, jobId: jobResult.insertId };
  });

  // Everything below is supporting metadata. A failure here should not undo a
  // publish the user already completed, so it runs outside the transaction and
  // is logged rather than thrown.
  try {
    await linkHashtags(videoId, hashtags);
    await linkMentions(videoId, mentions);
    if (input.editList.filterSlug) {
      await recordAssetUsage('filter', input.editList.filterSlug);
    }
    for (const effect of input.editList.effects) {
      await recordAssetUsage('effect', effect.effectSlug);
    }
    await execute(
      'UPDATE user_profiles SET video_count = video_count + 1 WHERE user_id = :userId',
      { userId },
    );
  } catch (err) {
    logger.error({ err, videoId }, 'post-publish metadata failed');
  }

  // The draft is only consumed once the video row exists, so a failed publish
  // never loses the user's work.
  if (input.draftId) {
    await consumeDraft(userId, input.draftId).catch((err: unknown) =>
      logger.warn({ err, draftId: input.draftId }, 'could not consume draft'),
    );
  }

  void jobId;
  return {
    videoId: videoPublicId,
    renderJob: {
      id: jobPublicId,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
    },
  };
}

export async function getRenderJob(userId: number, publicId: string) {
  const row = await queryOne<{
    public_id: string;
    status: 'queued' | 'rendering' | 'complete' | 'failed' | 'cancelled';
    progress: number;
    error: string | null;
    output_key: string | null;
    created_at: Date;
    finished_at: Date | null;
  }>(
    'SELECT * FROM render_jobs WHERE public_id = :publicId AND user_id = :userId',
    { publicId, userId },
  );
  if (!row) throw new AppError('not_found', 'Render job not found.');

  return {
    id: row.public_id,
    status: row.status,
    progress: Number(row.progress),
    ...(row.error ? { error: row.error } : {}),
    ...(row.output_key ? { outputKey: row.output_key } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.finished_at ? { finishedAt: new Date(row.finished_at).toISOString() } : {}),
  };
}
