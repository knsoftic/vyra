/**
 * Likes, saves and comments.
 *
 * Three rules hold everywhere in this file.
 *
 * **Idempotent.** Liking twice is liking once. A double tap, a retried request
 * and a flaky connection all converge on the same state, because the row is
 * locked and inspected before anything is counted. A counter that drifts
 * upward on retries is a counter nobody can trust, and these numbers are the
 * ones the ranking engine reads.
 *
 * **The count is derived, never assumed.** Every mutation returns the count it
 * just produced, read back inside the same transaction. The client renders that
 * rather than incrementing its own copy — so two devices, or a screen left open
 * for an hour, cannot disagree about how many likes a video has.
 *
 * **The author's rules are enforced here.** A video with comments turned off
 * cannot be commented on, and someone who has been blocked cannot reach the
 * author through a like or a comment. Both checks live in this file rather than
 * in the routes, so no future route can forget them.
 */

import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import { notify } from '../notifications/notifications.service.ts';

// ── Shared lookups ──

interface VideoRow {
  id: number;
  user_id: number;
  allow_comments: number;
  privacy: string;
}

/**
 * Resolves a public video id, and refuses one the viewer may not interact with.
 *
 * A blocked viewer gets `not_found` rather than `forbidden`: the same answer a
 * deleted video gives, so the response cannot be used to discover that a
 * specific person has blocked you.
 */
async function loadVideo(publicId: string, viewerId: number): Promise<VideoRow> {
  const video = await queryOne<VideoRow>(
    `SELECT v.id, v.user_id, v.allow_comments, v.privacy
       FROM videos v
      WHERE v.public_id = :publicId
        AND v.deleted_at IS NULL
        AND v.status = 'published'`,
    { publicId },
  );
  if (!video) throw new AppError('not_found', 'Video not found.');

  const blocked = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM blocks
      WHERE deleted_at IS NULL
        AND ((blocker_id = :viewer AND blocked_id = :author)
          OR (blocker_id = :author AND blocked_id = :viewer))`,
    { viewer: viewerId, author: video.user_id },
  );
  if (Number(blocked?.c ?? 0) > 0) throw new AppError('not_found', 'Video not found.');

  return video;
}

// ── Likes ──

export interface LikeResult {
  liked: boolean;
  likeCount: number;
}

async function videoLikeCount(videoId: number, tx?: Parameters<typeof queryOne>[2]): Promise<number> {
  const row = await queryOne<{ c: number }>(
    'SELECT like_count AS c FROM videos WHERE id = :id',
    { id: videoId },
    tx,
  );
  return Number(row?.c ?? 0);
}

export async function likeVideo(userId: number, publicId: string): Promise<LikeResult> {
  const video = await loadVideo(publicId, userId);

  const result = await transaction(async (tx) => {
    const existing = await queryOne<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM likes WHERE user_id = :userId AND video_id = :videoId FOR UPDATE',
      { userId, videoId: video.id },
      tx,
    );

    // Already liked. Return the current count instead of counting it again.
    if (existing && existing.deleted_at === null) {
      return { liked: true, likeCount: await videoLikeCount(video.id, tx), isNew: false };
    }

    if (existing) {
      await execute(
        `UPDATE likes SET deleted_at = NULL, created_at = CURRENT_TIMESTAMP(3)
          WHERE user_id = :userId AND video_id = :videoId`,
        { userId, videoId: video.id },
        tx,
      );
    } else {
      await execute(
        'INSERT INTO likes (user_id, video_id) VALUES (:userId, :videoId)',
        { userId, videoId: video.id },
        tx,
      );
    }

    await execute(
      'UPDATE videos SET like_count = like_count + 1 WHERE id = :id',
      { id: video.id },
      tx,
    );

    return { liked: true, likeCount: await videoLikeCount(video.id, tx), isNew: true };
  });

  if (result.isNew) {
    // Never blocks the like: notify() swallows its own failures, and the author
    // hearing about it is not a precondition for the like having happened.
    await notify({
      userId: video.user_id,
      kind: 'like',
      actorId: userId,
      body: 'liked your video',
      targetType: 'video',
      targetId: video.id,
      dedupeKey: `like:${userId}:${video.id}`,
    });
  }

  return { liked: result.liked, likeCount: result.likeCount };
}

export async function unlikeVideo(userId: number, publicId: string): Promise<LikeResult> {
  const video = await loadVideo(publicId, userId);

  return transaction(async (tx) => {
    const existing = await queryOne<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM likes WHERE user_id = :userId AND video_id = :videoId FOR UPDATE',
      { userId, videoId: video.id },
      tx,
    );

    // Not liked: nothing to undo, and nothing to decrement.
    if (!existing || existing.deleted_at !== null) {
      return { liked: false, likeCount: await videoLikeCount(video.id, tx) };
    }

    await execute(
      `UPDATE likes SET deleted_at = CURRENT_TIMESTAMP(3)
        WHERE user_id = :userId AND video_id = :videoId`,
      { userId, videoId: video.id },
      tx,
    );
    // GREATEST guards the floor: a counter that has drifted must not go negative
    // and start rendering as a nonsense number.
    await execute(
      'UPDATE videos SET like_count = GREATEST(like_count - 1, 0) WHERE id = :id',
      { id: video.id },
      tx,
    );

    return { liked: false, likeCount: await videoLikeCount(video.id, tx) };
  });
}

// ── Saves ──

export interface SaveResult {
  saved: boolean;
  saveCount: number;
}

export async function saveVideo(userId: number, publicId: string): Promise<SaveResult> {
  const video = await loadVideo(publicId, userId);

  return transaction(async (tx) => {
    const existing = await queryOne<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM saves WHERE user_id = :userId AND video_id = :videoId FOR UPDATE',
      { userId, videoId: video.id },
      tx,
    );

    if (existing && existing.deleted_at === null) {
      const row = await queryOne<{ c: number }>(
        'SELECT save_count AS c FROM videos WHERE id = :id', { id: video.id }, tx,
      );
      return { saved: true, saveCount: Number(row?.c ?? 0) };
    }

    if (existing) {
      await execute(
        `UPDATE saves SET deleted_at = NULL, created_at = CURRENT_TIMESTAMP(3)
          WHERE user_id = :userId AND video_id = :videoId`,
        { userId, videoId: video.id },
        tx,
      );
    } else {
      await execute(
        'INSERT INTO saves (user_id, video_id) VALUES (:userId, :videoId)',
        { userId, videoId: video.id },
        tx,
      );
    }

    await execute('UPDATE videos SET save_count = save_count + 1 WHERE id = :id', { id: video.id }, tx);

    const row = await queryOne<{ c: number }>(
      'SELECT save_count AS c FROM videos WHERE id = :id', { id: video.id }, tx,
    );
    // A save is private — the author is deliberately not told. Knowing who
    // bookmarked you is not information a save is meant to carry.
    return { saved: true, saveCount: Number(row?.c ?? 0) };
  });
}

export async function unsaveVideo(userId: number, publicId: string): Promise<SaveResult> {
  const video = await loadVideo(publicId, userId);

  return transaction(async (tx) => {
    const existing = await queryOne<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM saves WHERE user_id = :userId AND video_id = :videoId FOR UPDATE',
      { userId, videoId: video.id },
      tx,
    );

    if (existing && existing.deleted_at === null) {
      await execute(
        `UPDATE saves SET deleted_at = CURRENT_TIMESTAMP(3)
          WHERE user_id = :userId AND video_id = :videoId`,
        { userId, videoId: video.id },
        tx,
      );
      await execute(
        'UPDATE videos SET save_count = GREATEST(save_count - 1, 0) WHERE id = :id',
        { id: video.id },
        tx,
      );
    }

    const row = await queryOne<{ c: number }>(
      'SELECT save_count AS c FROM videos WHERE id = :id', { id: video.id }, tx,
    );
    return { saved: false, saveCount: Number(row?.c ?? 0) };
  });
}

/** The caller's saved videos. Private by definition — only ever their own. */
export async function savedVideos(userId: number, limit = 30): Promise<unknown[]> {
  return query(
    `SELECT v.public_id AS id, v.caption, v.duration_sec AS durationSec,
            v.view_count AS views, v.like_count AS likes, v.poster_key AS posterKey,
            u.username, p.display_name AS displayName, p.avatar_url AS avatar,
            s.created_at AS savedAt
       FROM saves s
       JOIN videos v ON v.id = s.video_id
       JOIN users u ON u.id = v.user_id
       LEFT JOIN user_profiles p ON p.user_id = v.user_id
      WHERE s.user_id = :userId
        AND s.deleted_at IS NULL
        AND v.deleted_at IS NULL
        AND v.status = 'published'
      ORDER BY s.created_at DESC
      LIMIT :limit`,
    { userId, limit },
  );
}

// ── Comments ──

export interface CommentView {
  id: string;
  body: string;
  likeCount: number;
  replyCount: number;
  isPinned: boolean;
  liked: boolean;
  isAuthor: boolean;
  canDelete: boolean;
  author: { id: string; username: string; displayName: string; avatar: string | null; verificationTier: string };
  createdAt: string;
  replies?: CommentView[];
}

interface CommentRow {
  id: number;
  public_id: string;
  body: string;
  like_count: number;
  reply_count: number;
  is_pinned: number;
  user_id: number;
  created_at: Date;
  author_public_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  verification_tier: string;
  viewer_liked: number;
}

const COMMENT_SELECT = `
  SELECT c.id, c.public_id, c.body, c.like_count, c.reply_count, c.is_pinned,
         c.user_id, c.created_at,
         u.public_id AS author_public_id, u.username, u.verification_tier,
         p.display_name, p.avatar_url,
         EXISTS(SELECT 1 FROM comment_likes cl
                 WHERE cl.comment_id = c.id AND cl.user_id = :viewerId
                   AND cl.deleted_at IS NULL) AS viewer_liked
    FROM comments c
    JOIN users u ON u.id = c.user_id AND u.deleted_at IS NULL
    LEFT JOIN user_profiles p ON p.user_id = c.user_id
`;

function toComment(row: CommentRow, viewerId: number, videoAuthorId: number): CommentView {
  return {
    id: row.public_id,
    body: row.body,
    likeCount: Number(row.like_count),
    replyCount: Number(row.reply_count),
    isPinned: row.is_pinned === 1,
    liked: Number(row.viewer_liked) === 1,
    isAuthor: row.user_id === videoAuthorId,
    // The commenter may delete their own; so may the video's author, on their
    // own video. Anything beyond that is moderation, which has its own door.
    canDelete: row.user_id === viewerId || viewerId === videoAuthorId,
    author: {
      id: row.author_public_id,
      username: row.username,
      displayName: row.display_name ?? row.username,
      avatar: row.avatar_url,
      verificationTier: row.verification_tier,
    },
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Top-level comments, pinned first, then newest.
 *
 * Replies are not fetched here: a thread with two hundred replies would make
 * the first page enormous for the one reader who wants to expand it.
 */
export async function listComments(
  publicId: string,
  viewerId: number,
  limit = 30,
): Promise<{ items: CommentView[]; total: number }> {
  const video = await loadVideo(publicId, viewerId);

  const rows = await query<CommentRow>(
    `${COMMENT_SELECT}
      WHERE c.video_id = :videoId
        AND c.parent_id IS NULL
        AND c.deleted_at IS NULL
        AND c.status = 'visible'
      ORDER BY c.is_pinned DESC, c.created_at DESC
      LIMIT :limit`,
    { videoId: video.id, viewerId, limit },
  );

  const total = await queryOne<{ c: number }>(
    'SELECT comment_count AS c FROM videos WHERE id = :id',
    { id: video.id },
  );

  return {
    items: rows.map((row) => toComment(row, viewerId, video.user_id)),
    total: Number(total?.c ?? 0),
  };
}

export async function listReplies(
  commentPublicId: string,
  viewerId: number,
  limit = 30,
): Promise<CommentView[]> {
  const parent = await queryOne<{ id: number; video_id: number }>(
    'SELECT id, video_id FROM comments WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId: commentPublicId },
  );
  if (!parent) throw new AppError('not_found', 'Comment not found.');

  const video = await queryOne<{ user_id: number }>(
    'SELECT user_id FROM videos WHERE id = :id',
    { id: parent.video_id },
  );

  const rows = await query<CommentRow>(
    `${COMMENT_SELECT}
      WHERE c.parent_id = :parentId
        AND c.deleted_at IS NULL
        AND c.status = 'visible'
      ORDER BY c.created_at ASC
      LIMIT :limit`,
    { parentId: parent.id, viewerId, limit },
  );

  return rows.map((row) => toComment(row, viewerId, video?.user_id ?? 0));
}

export async function addComment(
  userId: number,
  publicId: string,
  body: string,
  parentPublicId?: string,
): Promise<CommentView> {
  const video = await loadVideo(publicId, userId);

  if (video.allow_comments !== 1) {
    throw new AppError('forbidden', 'Comments are turned off for this video.');
  }

  const trimmed = body.trim();
  if (trimmed.length === 0) throw new AppError('validation_failed', 'A comment cannot be empty.');

  let parentId: number | null = null;
  if (parentPublicId) {
    const parent = await queryOne<{ id: number; video_id: number; parent_id: number | null }>(
      'SELECT id, video_id, parent_id FROM comments WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: parentPublicId },
    );
    if (!parent || parent.video_id !== video.id) {
      throw new AppError('not_found', 'The comment you are replying to no longer exists.');
    }
    // Threads are one level deep. A reply to a reply attaches to the same
    // parent, which keeps the thread readable instead of stepping off the
    // right edge of a phone.
    parentId = parent.parent_id ?? parent.id;
  }

  const { ulid } = await import('ulid');
  const commentPublicId = ulid();

  const created = await transaction(async (tx) => {
    const result = await execute(
      `INSERT INTO comments (public_id, video_id, user_id, parent_id, body)
       VALUES (:publicId, :videoId, :userId, :parentId, :body)`,
      { publicId: commentPublicId, videoId: video.id, userId, parentId, body: trimmed },
      tx,
    );

    await execute(
      'UPDATE videos SET comment_count = comment_count + 1 WHERE id = :id',
      { id: video.id },
      tx,
    );
    if (parentId !== null) {
      await execute(
        'UPDATE comments SET reply_count = reply_count + 1 WHERE id = :id',
        { id: parentId },
        tx,
      );
    }

    return result.insertId;
  });

  // Who hears about it: the video's author for a top-level comment, the
  // comment's author for a reply. Both, when someone replies on their own video.
  const recipients = new Set<number>();
  recipients.add(video.user_id);
  if (parentId !== null) {
    const parentAuthor = await queryOne<{ user_id: number }>(
      'SELECT user_id FROM comments WHERE id = :id',
      { id: parentId },
    );
    if (parentAuthor) recipients.add(parentAuthor.user_id);
  }

  for (const recipient of recipients) {
    await notify({
      userId: recipient,
      kind: 'comment',
      actorId: userId,
      body: parentId === null ? 'commented on your video' : 'replied to your comment',
      targetType: 'video',
      targetId: video.id,
      dedupeKey: `comment:${created}:${recipient}`,
    });
  }

  const row = await queryOne<CommentRow>(
    `${COMMENT_SELECT} WHERE c.id = :id`,
    { id: created, viewerId: userId },
  );
  if (!row) throw new AppError('internal_error', 'The comment was saved but could not be read back.');

  return toComment(row, userId, video.user_id);
}

export async function deleteComment(userId: number, commentPublicId: string): Promise<{ deleted: true }> {
  const comment = await queryOne<{ id: number; user_id: number; video_id: number; parent_id: number | null }>(
    'SELECT id, user_id, video_id, parent_id FROM comments WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId: commentPublicId },
  );
  if (!comment) throw new AppError('not_found', 'Comment not found.');

  const video = await queryOne<{ user_id: number }>(
    'SELECT user_id FROM videos WHERE id = :id',
    { id: comment.video_id },
  );

  const isOwnComment = comment.user_id === userId;
  const isVideoAuthor = video?.user_id === userId;
  if (!isOwnComment && !isVideoAuthor) {
    throw new AppError('forbidden', 'You can only delete your own comments.');
  }

  await transaction(async (tx) => {
    await execute(
      'UPDATE comments SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = :id',
      { id: comment.id },
      tx,
    );
    // Replies go with the comment they hang from, and the video's count drops
    // by the whole thread — otherwise the number counts comments nobody can see.
    const replies = await execute(
      `UPDATE comments SET deleted_at = CURRENT_TIMESTAMP(3)
        WHERE parent_id = :id AND deleted_at IS NULL`,
      { id: comment.id },
      tx,
    );

    await execute(
      'UPDATE videos SET comment_count = GREATEST(comment_count - :n, 0) WHERE id = :videoId',
      { n: 1 + replies.affectedRows, videoId: comment.video_id },
      tx,
    );

    if (comment.parent_id !== null) {
      await execute(
        'UPDATE comments SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = :id',
        { id: comment.parent_id },
        tx,
      );
    }
  });

  return { deleted: true };
}

export async function likeComment(
  userId: number,
  commentPublicId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const comment = await queryOne<{ id: number }>(
    "SELECT id FROM comments WHERE public_id = :publicId AND deleted_at IS NULL AND status = 'visible'",
    { publicId: commentPublicId },
  );
  if (!comment) throw new AppError('not_found', 'Comment not found.');

  return transaction(async (tx) => {
    const existing = await queryOne<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM comment_likes WHERE user_id = :userId AND comment_id = :id FOR UPDATE',
      { userId, id: comment.id },
      tx,
    );

    if (existing && existing.deleted_at === null) {
      const row = await queryOne<{ c: number }>(
        'SELECT like_count AS c FROM comments WHERE id = :id', { id: comment.id }, tx,
      );
      return { liked: true, likeCount: Number(row?.c ?? 0) };
    }

    if (existing) {
      await execute(
        `UPDATE comment_likes SET deleted_at = NULL, created_at = CURRENT_TIMESTAMP(3)
          WHERE user_id = :userId AND comment_id = :id`,
        { userId, id: comment.id },
        tx,
      );
    } else {
      await execute(
        'INSERT INTO comment_likes (user_id, comment_id) VALUES (:userId, :id)',
        { userId, id: comment.id },
        tx,
      );
    }
    await execute('UPDATE comments SET like_count = like_count + 1 WHERE id = :id', { id: comment.id }, tx);

    const row = await queryOne<{ c: number }>(
      'SELECT like_count AS c FROM comments WHERE id = :id', { id: comment.id }, tx,
    );
    return { liked: true, likeCount: Number(row?.c ?? 0) };
  });
}

export async function unlikeComment(
  userId: number,
  commentPublicId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const comment = await queryOne<{ id: number }>(
    'SELECT id FROM comments WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId: commentPublicId },
  );
  if (!comment) throw new AppError('not_found', 'Comment not found.');

  return transaction(async (tx) => {
    const existing = await queryOne<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM comment_likes WHERE user_id = :userId AND comment_id = :id FOR UPDATE',
      { userId, id: comment.id },
      tx,
    );

    if (existing && existing.deleted_at === null) {
      await execute(
        `UPDATE comment_likes SET deleted_at = CURRENT_TIMESTAMP(3)
          WHERE user_id = :userId AND comment_id = :id`,
        { userId, id: comment.id },
        tx,
      );
      await execute(
        'UPDATE comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = :id',
        { id: comment.id },
        tx,
      );
    }

    const row = await queryOne<{ c: number }>(
      'SELECT like_count AS c FROM comments WHERE id = :id', { id: comment.id }, tx,
    );
    return { liked: false, likeCount: Number(row?.c ?? 0) };
  });
}

/**
 * Which of these videos the viewer has liked and saved.
 *
 * The feed needs this for a page of videos at once; asking per video would be
 * one round trip per card.
 */
export async function viewerState(
  userId: number,
  publicIds: string[],
): Promise<{ liked: string[]; saved: string[] }> {
  if (publicIds.length === 0) return { liked: [], saved: [] };

  const [likes, saves] = await Promise.all([
    query<{ public_id: string }>(
      `SELECT v.public_id FROM likes l JOIN videos v ON v.id = l.video_id
        WHERE l.user_id = :userId AND l.deleted_at IS NULL AND v.public_id IN (:ids)`,
      { userId, ids: publicIds },
    ).catch(() => []),
    query<{ public_id: string }>(
      `SELECT v.public_id FROM saves s JOIN videos v ON v.id = s.video_id
        WHERE s.user_id = :userId AND s.deleted_at IS NULL AND v.public_id IN (:ids)`,
      { userId, ids: publicIds },
    ).catch(() => []),
  ]);

  return {
    liked: likes.map((r) => r.public_id),
    saved: saves.map((r) => r.public_id),
  };
}

/** Used by the moderation module when a comment is removed by staff. */
export async function recountVideoComments(videoId: number): Promise<void> {
  try {
    await execute(
      `UPDATE videos SET comment_count = (
         SELECT COUNT(*) FROM comments
          WHERE video_id = :id AND deleted_at IS NULL AND status = 'visible')
        WHERE id = :id`,
      { id: videoId },
    );
  } catch (err) {
    logger.warn({ err, videoId }, 'comment recount failed');
  }
}
