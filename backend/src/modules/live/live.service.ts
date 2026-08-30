/**
 * Live streaming.
 *
 * The server does not carry video. It issues the credential a broadcaster uses
 * to reach the ingest server, records what happened, and fans out the chat,
 * likes and gifts that ride alongside. Media goes to a media server (RTMP in,
 * HLS out) which is deployment, not application code.
 *
 * Two things shape the design.
 *
 * **A stream key is a credential.** Anyone holding one can broadcast as that
 * creator, so it is generated once, returned once, and stored only as a hash —
 * the same treatment as a password. It also expires, so a leaked key stops
 * working rather than granting impersonation indefinitely.
 *
 * **Viewer counts are derived, not reported.** A client that can tell the server
 * how many people are watching can tell it anything. The count comes from the
 * `live_viewers` rows the server itself wrote, which is also what makes "no fake
 * engagement" true here rather than merely intended.
 */

import { createHash, randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { storage } from '../../core/storage.ts';
import { config } from '../../core/config.ts';
import * as social from '../social/social.service.ts';
import type { LiveComment, LiveStream, StreamCredentials } from '../../../../shared/contracts/live.ts';
import type { PublicUser } from '../../../../shared/contracts/user.ts';

/** A key is good for one broadcast plus a generous margin for reconnects. */
const KEY_TTL_HOURS = 12;
/** A viewer cannot claim more than this many likes in one call. */
export const MAX_LIKES_PER_CALL = 50;

const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex');

interface StreamRow {
  id: number;
  public_id: string;
  title: string;
  category: string | null;
  category_id: number | null;
  thumbnail_key: string | null;
  status: 'scheduled' | 'live' | 'ended' | 'stopped_by_admin';
  allow_comments: number;
  allow_gifts: number;
  allow_guests: number;
  viewer_count: number;
  peak_viewers: number;
  like_count: string | number;
  gift_coins: string | number;
  started_at: Date | null;
  ended_at: Date | null;
  host_id: number;
  host_public_id: string;
  host_username: string;
  host_display_name: string;
  host_avatar: string | null;
  host_bio: string | null;
  host_verification: string;
  host_category: string;
  host_type: string;
  host_followers: number;
  host_following: number;
  host_likes: number;
  host_videos: number;
  host_private: number;
  host_created: Date;
}

const STREAM_SELECT = `
  SELECT s.id, s.public_id, s.title, s.category, s.category_id, s.thumbnail_key, s.status,
         s.allow_comments, s.allow_gifts, s.allow_guests, s.viewer_count, s.peak_viewers,
         s.like_count, s.gift_coins, s.started_at, s.ended_at, s.host_id,
         u.public_id AS host_public_id, u.username AS host_username,
         u.verification_tier AS host_verification, u.account_category AS host_category,
         u.account_type AS host_type, u.created_at AS host_created,
         p.display_name AS host_display_name, p.avatar_url AS host_avatar, p.bio AS host_bio,
         p.follower_count AS host_followers, p.following_count AS host_following,
         p.like_count AS host_likes, p.video_count AS host_videos, p.is_private AS host_private
    FROM live_streams s
    JOIN users u ON u.id = s.host_id
    JOIN user_profiles p ON p.user_id = s.host_id
   WHERE s.deleted_at IS NULL
`;

function toHost(row: StreamRow): PublicUser {
  const host: PublicUser = {
    id: row.host_public_id,
    username: row.host_username,
    displayName: row.host_display_name,
    bio: row.host_bio ?? '',
    verified: row.host_verification !== 'none',
    verificationTier: row.host_verification as PublicUser['verificationTier'],
    accountCategory: row.host_category as PublicUser['accountCategory'],
    accountType: row.host_type as PublicUser['accountType'],
    followers: Number(row.host_followers),
    following: Number(row.host_following),
    likes: Number(row.host_likes),
    videos: Number(row.host_videos),
    isPrivate: row.host_private === 1,
    createdAt: new Date(row.host_created).toISOString(),
  };
  if (row.host_avatar) host.avatar = row.host_avatar;
  return host;
}

function toStream(row: StreamRow): LiveStream {
  const stream: LiveStream = {
    id: row.public_id,
    host: toHost(row),
    title: row.title,
    // `stopped_by_admin` is a distinct database state but the client only needs
    // to know the stream is unavailable; the reason belongs in moderation.
    state: row.status === 'stopped_by_admin' ? 'banned' : row.status,
    viewerCount: Number(row.viewer_count),
    peakViewers: Number(row.peak_viewers),
    likeCount: Number(row.like_count),
    giftCoins: Number(row.gift_coins),
  };

  if (row.thumbnail_key) stream.cover = storage.url(row.thumbnail_key);
  if (row.category_id !== null) stream.categoryId = String(row.category_id);
  if (row.started_at) stream.startedAt = new Date(row.started_at).toISOString();
  if (row.ended_at) stream.endedAt = new Date(row.ended_at).toISOString();

  // Playback only exists while there is something to play.
  if (row.status === 'live') {
    stream.playbackUrl = `${config.LIVE_PLAYBACK_URL}/live/${row.public_id}/index.m3u8`;
  }

  return stream;
}

// ── Reads ──

/** Streams currently on air, most watched first. */
export async function listLive(limit = 30): Promise<LiveStream[]> {
  const rows = await query<StreamRow>(
    `${STREAM_SELECT} AND s.status = 'live'
      ORDER BY s.viewer_count DESC, s.started_at DESC
      LIMIT :limit`,
    { limit },
  );
  return rows.map(toStream);
}

export async function getStream(publicId: string, viewerId?: number): Promise<LiveStream> {
  const row = await queryOne<StreamRow>(`${STREAM_SELECT} AND s.public_id = :publicId`, {
    publicId,
  });
  if (!row) throw new AppError('not_found', 'Stream not found.');

  // A blocked viewer is told the stream does not exist, the same answer the
  // rest of the product gives.
  if (viewerId !== undefined && viewerId !== row.host_id) {
    if (await social.isBlockedEitherWay(viewerId, row.host_id)) {
      throw new AppError('not_found', 'Stream not found.');
    }
  }

  return toStream(row);
}

/** Resolves a public id to a row the caller is allowed to act on as host. */
async function requireHost(publicId: string, userId: number): Promise<{ id: number; status: string }> {
  const row = await queryOne<{ id: number; status: string; host_id: number }>(
    'SELECT id, status, host_id FROM live_streams WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Stream not found.');
  if (row.host_id !== userId) throw new AppError('forbidden', 'You are not hosting this stream.');
  return { id: row.id, status: row.status };
}

async function requireLive(publicId: string): Promise<{ id: number; host_id: number; allow_comments: number }> {
  const row = await queryOne<{ id: number; host_id: number; allow_comments: number; status: string }>(
    'SELECT id, host_id, allow_comments, status FROM live_streams WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Stream not found.');
  if (row.status !== 'live') throw new AppError('bad_request', 'That stream is not live.');
  return { id: row.id, host_id: row.host_id, allow_comments: row.allow_comments };
}

// ── Broadcasting ──

export interface StartedStream {
  stream: LiveStream;
  credentials: StreamCredentials;
}

/**
 * Starts a broadcast.
 *
 * The stream key is returned exactly once, here. It is stored hashed, so it
 * cannot be read back — a creator who loses it starts a new stream rather than
 * recovering the old credential, which is the same trade a password reset makes.
 */
export async function startStream(
  userId: number,
  input: {
    title: string;
    categoryId?: string;
    coverKey?: string;
    allowComments?: boolean;
    allowGifts?: boolean;
    allowGuests?: boolean;
  },
): Promise<StartedStream> {
  // One live stream per host. A second would split the audience between two
  // broadcasts and make the viewer count meaningless.
  const existing = await queryOne<{ public_id: string }>(
    `SELECT public_id FROM live_streams
      WHERE host_id = :userId AND status = 'live' AND deleted_at IS NULL LIMIT 1`,
    { userId },
  );
  if (existing) {
    throw new AppError('bad_request', 'You are already live. End that stream first.');
  }

  let categoryId: number | null = null;
  if (input.categoryId) {
    const category = await queryOne<{ id: number }>(
      'SELECT id FROM categories WHERE (id = :id OR slug = :slug) AND is_enabled = 1',
      { id: Number(input.categoryId) || 0, slug: input.categoryId },
    );
    categoryId = category?.id ?? null;
  }

  const publicId = ulid();
  const streamKey = `${publicId}-${randomBytes(24).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + KEY_TTL_HOURS * 60 * 60 * 1000);
  const ingestUrl = config.LIVE_INGEST_URL;

  await execute(
    `INSERT INTO live_streams
       (public_id, host_id, title, category_id, thumbnail_key, stream_key_hash,
        ingest_url, key_expires_at, status, allow_comments, allow_gifts, allow_guests,
        started_at)
     VALUES (:publicId, :hostId, :title, :categoryId, :coverKey, :keyHash,
             :ingestUrl, :expiresAt, 'live', :allowComments, :allowGifts, :allowGuests,
             CURRENT_TIMESTAMP(3))`,
    {
      publicId,
      hostId: userId,
      title: input.title,
      categoryId,
      coverKey: input.coverKey ?? null,
      keyHash: hashKey(streamKey),
      ingestUrl,
      expiresAt,
      allowComments: input.allowComments === false ? 0 : 1,
      allowGifts: input.allowGifts === false ? 0 : 1,
      allowGuests: input.allowGuests === true ? 1 : 0,
    },
  );

  return {
    stream: await getStream(publicId, userId),
    credentials: {
      streamId: publicId,
      ingestUrl,
      streamKey,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/** Verifies a key presented by the ingest server. Never logs the key itself. */
export async function verifyStreamKey(streamKey: string): Promise<{ streamId: string } | null> {
  const row = await queryOne<{ public_id: string; key_expires_at: Date | null; status: string }>(
    `SELECT public_id, key_expires_at, status FROM live_streams
      WHERE stream_key_hash = :hash AND deleted_at IS NULL`,
    { hash: hashKey(streamKey) },
  );
  if (!row) return null;
  if (row.status !== 'live') return null;
  if (row.key_expires_at && new Date(row.key_expires_at).getTime() < Date.now()) return null;
  return { streamId: row.public_id };
}

export async function endStream(
  userId: number,
  publicId: string,
): Promise<LiveStream> {
  const stream = await requireHost(publicId, userId);
  if (stream.status !== 'live') return getStream(publicId, userId);

  await transaction(async (tx) => {
    await execute(
      `UPDATE live_streams
          SET status = 'ended', ended_at = CURRENT_TIMESTAMP(3), viewer_count = 0,
              stream_key_hash = NULL
        WHERE id = :id`,
      { id: stream.id },
      tx,
    );
    // Everyone still marked as watching is released, so a later count of "who
    // was here" is not permanently wrong.
    await execute(
      `UPDATE live_viewers SET left_at = CURRENT_TIMESTAMP(3)
        WHERE stream_id = :id AND left_at IS NULL`,
      { id: stream.id },
      tx,
    );
  });

  return getStream(publicId, userId);
}

/**
 * Stops a stream on moderation grounds.
 *
 * Distinct from the host ending it: the state is different, the reason is
 * recorded, and the host cannot undo it by pressing "go live" on the same row.
 */
export async function stopStreamAsAdmin(
  publicId: string,
  adminUserId: number,
  reason: string,
): Promise<LiveStream> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM live_streams WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Stream not found.');

  await transaction(async (tx) => {
    await execute(
      `UPDATE live_streams
          SET status = 'stopped_by_admin', ended_at = CURRENT_TIMESTAMP(3),
              ended_reason = :reason, viewer_count = 0, stream_key_hash = NULL
        WHERE id = :id`,
      { id: row.id, reason },
      tx,
    );
    await execute(
      `UPDATE live_viewers SET left_at = CURRENT_TIMESTAMP(3)
        WHERE stream_id = :id AND left_at IS NULL`,
      { id: row.id },
      tx,
    );
  });

  void adminUserId;
  return getStream(publicId);
}

// ── Watching ──

export interface JoinResult {
  stream: LiveStream;
  viewerCount: number;
}

/**
 * Records that someone is watching, and returns the true count.
 *
 * The count is recomputed from the rows rather than incremented, so a double
 * join, a reconnect or a crashed client cannot drift it upward — which is what
 * makes the number on screen a measurement rather than a claim.
 */
export async function joinStream(publicId: string, userId: number): Promise<JoinResult> {
  const stream = await requireLive(publicId);

  if (await social.isBlockedEitherWay(userId, stream.host_id)) {
    throw new AppError('not_found', 'Stream not found.');
  }

  const banned = await queryOne<{ is_banned: number }>(
    'SELECT is_banned FROM live_viewers WHERE stream_id = :streamId AND user_id = :userId',
    { streamId: stream.id, userId },
  );
  if (banned && Number(banned.is_banned) === 1) {
    throw new AppError('forbidden', 'You cannot join this stream.');
  }

  await execute(
    `INSERT INTO live_viewers (stream_id, user_id) VALUES (:streamId, :userId)
     ON DUPLICATE KEY UPDATE left_at = NULL, joined_at = CURRENT_TIMESTAMP(3)`,
    { streamId: stream.id, userId },
  );

  const count = await refreshViewerCount(stream.id);
  return { stream: await getStream(publicId, userId), viewerCount: count };
}

export async function leaveStream(publicId: string, userId: number): Promise<{ viewerCount: number }> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM live_streams WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!row) return { viewerCount: 0 };

  await execute(
    `UPDATE live_viewers SET left_at = CURRENT_TIMESTAMP(3)
      WHERE stream_id = :streamId AND user_id = :userId AND left_at IS NULL`,
    { streamId: row.id, userId },
  );

  return { viewerCount: await refreshViewerCount(row.id) };
}

/** Derived from the rows, and `peak_viewers` only ever moves up. */
async function refreshViewerCount(streamId: number): Promise<number> {
  await execute(
    `UPDATE live_streams
        SET viewer_count = (SELECT COUNT(*) FROM live_viewers
                             WHERE stream_id = :streamId AND left_at IS NULL AND is_banned = 0),
            peak_viewers = GREATEST(peak_viewers,
              (SELECT COUNT(*) FROM live_viewers
                WHERE stream_id = :streamId AND left_at IS NULL AND is_banned = 0))
      WHERE id = :streamId`,
    { streamId },
  );
  const row = await queryOne<{ viewer_count: number }>(
    'SELECT viewer_count FROM live_streams WHERE id = :streamId',
    { streamId },
  );
  return Number(row?.viewer_count ?? 0);
}

export async function listViewers(
  publicId: string,
  userId: number,
  limit = 50,
): Promise<PublicUser[]> {
  const stream = await requireHost(publicId, userId);

  const rows = await query<{
    public_id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    bio: string | null;
    verification_tier: string;
    account_category: string;
    account_type: string;
    follower_count: number;
    following_count: number;
    like_count: number;
    video_count: number;
    is_private: number;
    created_at: Date;
  }>(
    `SELECT u.public_id, u.username, u.verification_tier, u.account_category, u.account_type,
            u.created_at, p.display_name, p.avatar_url, p.bio, p.follower_count,
            p.following_count, p.like_count, p.video_count, p.is_private
       FROM live_viewers v
       JOIN users u ON u.id = v.user_id
       JOIN user_profiles p ON p.user_id = v.user_id
      WHERE v.stream_id = :streamId AND v.left_at IS NULL AND v.is_banned = 0
      ORDER BY v.joined_at DESC
      LIMIT :limit`,
    { streamId: stream.id, limit },
  );

  return rows.map((r) => {
    const user: PublicUser = {
      id: r.public_id,
      username: r.username,
      displayName: r.display_name,
      bio: r.bio ?? '',
      verified: r.verification_tier !== 'none',
      verificationTier: r.verification_tier as PublicUser['verificationTier'],
      accountCategory: r.account_category as PublicUser['accountCategory'],
      accountType: r.account_type as PublicUser['accountType'],
      followers: Number(r.follower_count),
      following: Number(r.following_count),
      likes: Number(r.like_count),
      videos: Number(r.video_count),
      isPrivate: r.is_private === 1,
      createdAt: new Date(r.created_at).toISOString(),
    };
    if (r.avatar_url) user.avatar = r.avatar_url;
    return user;
  });
}

/** Removes a viewer and stops them rejoining. Host only. */
export async function banViewer(
  publicId: string,
  hostId: number,
  targetPublicId: string,
): Promise<{ banned: true }> {
  const stream = await requireHost(publicId, hostId);

  const target = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE public_id = :publicId',
    { publicId: targetPublicId },
  );
  if (!target) throw new AppError('not_found', 'Account not found.');
  if (target.id === hostId) throw new AppError('bad_request', 'You cannot ban yourself.');

  await execute(
    `INSERT INTO live_viewers (stream_id, user_id, is_banned, left_at)
     VALUES (:streamId, :userId, 1, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE is_banned = 1, left_at = CURRENT_TIMESTAMP(3)`,
    { streamId: stream.id, userId: target.id },
  );

  await refreshViewerCount(stream.id);
  return { banned: true };
}

// ── Chat and likes ──

interface CommentRow {
  id: number;
  body: string;
  created_at: Date;
  author_public_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar: string | null;
  author_bio: string | null;
  author_verification: string;
  author_category: string;
  author_type: string;
  author_followers: number;
  author_following: number;
  author_likes: number;
  author_videos: number;
  author_private: number;
  author_created: Date;
}

function toComment(row: CommentRow, streamPublicId: string): LiveComment {
  const author: PublicUser = {
    id: row.author_public_id,
    username: row.author_username,
    displayName: row.author_display_name,
    bio: row.author_bio ?? '',
    verified: row.author_verification !== 'none',
    verificationTier: row.author_verification as PublicUser['verificationTier'],
    accountCategory: row.author_category as PublicUser['accountCategory'],
    accountType: row.author_type as PublicUser['accountType'],
    followers: Number(row.author_followers),
    following: Number(row.author_following),
    likes: Number(row.author_likes),
    videos: Number(row.author_videos),
    isPrivate: row.author_private === 1,
    createdAt: new Date(row.author_created).toISOString(),
  };
  if (row.author_avatar) author.avatar = row.author_avatar;

  return {
    id: String(row.id),
    streamId: streamPublicId,
    author,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const COMMENT_SELECT = `
  SELECT c.id, c.body, c.created_at,
         u.public_id AS author_public_id, u.username AS author_username,
         u.verification_tier AS author_verification, u.account_category AS author_category,
         u.account_type AS author_type, u.created_at AS author_created,
         p.display_name AS author_display_name, p.avatar_url AS author_avatar, p.bio AS author_bio,
         p.follower_count AS author_followers, p.following_count AS author_following,
         p.like_count AS author_likes, p.video_count AS author_videos, p.is_private AS author_private
    FROM live_comments c
    JOIN users u ON u.id = c.user_id
    JOIN user_profiles p ON p.user_id = c.user_id
   WHERE c.deleted_at IS NULL AND c.kind = 'comment'
`;

export async function listComments(
  publicId: string,
  limit = 50,
): Promise<LiveComment[]> {
  const stream = await queryOne<{ id: number }>(
    'SELECT id FROM live_streams WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!stream) throw new AppError('not_found', 'Stream not found.');

  const rows = await query<CommentRow>(
    `${COMMENT_SELECT} AND c.stream_id = :streamId ORDER BY c.id DESC LIMIT :limit`,
    { streamId: stream.id, limit },
  );
  return rows.reverse().map((row) => toComment(row, publicId));
}

export async function addComment(
  publicId: string,
  userId: number,
  body: string,
): Promise<LiveComment> {
  const stream = await requireLive(publicId);

  if (Number(stream.allow_comments) === 0) {
    throw new AppError('forbidden', 'Comments are turned off for this stream.');
  }
  if (await social.isBlockedEitherWay(userId, stream.host_id)) {
    throw new AppError('not_found', 'Stream not found.');
  }

  const banned = await queryOne<{ is_banned: number }>(
    'SELECT is_banned FROM live_viewers WHERE stream_id = :streamId AND user_id = :userId',
    { streamId: stream.id, userId },
  );
  if (banned && Number(banned.is_banned) === 1) {
    throw new AppError('forbidden', 'You cannot comment on this stream.');
  }

  const result = await execute(
    `INSERT INTO live_comments (stream_id, user_id, body, kind)
     VALUES (:streamId, :userId, :body, 'comment')`,
    { streamId: stream.id, userId, body },
  );

  const row = await queryOne<CommentRow>(`${COMMENT_SELECT} AND c.id = :id`, {
    id: result.insertId,
  });
  if (!row) throw new AppError('internal_error', 'The comment could not be read back.');
  return toComment(row, publicId);
}

/**
 * Records likes.
 *
 * Live likes are taps, and there are many per viewer, so the per-stream total
 * stays denormalised. What is *not* denormalised is who sent them: a per-viewer
 * row means the total is attributable, and it means a client cannot post an
 * arbitrary number — each call is capped, and the stream total is recomputed
 * from the rows rather than incremented by whatever arrived.
 */
export async function addLikes(
  publicId: string,
  userId: number,
  count: number,
): Promise<{ likeCount: number; yours: number }> {
  const stream = await requireLive(publicId);

  const capped = Math.max(1, Math.min(Math.floor(count) || 1, MAX_LIKES_PER_CALL));

  await execute(
    `INSERT INTO live_likes (stream_id, user_id, count) VALUES (:streamId, :userId, :count)
     ON DUPLICATE KEY UPDATE count = count + :count`,
    { streamId: stream.id, userId, count: capped },
  );

  await execute(
    `UPDATE live_streams
        SET like_count = (SELECT COALESCE(SUM(count), 0) FROM live_likes WHERE stream_id = :streamId)
      WHERE id = :streamId`,
    { streamId: stream.id },
  );

  const totals = await queryOne<{ like_count: string | number; yours: string | number }>(
    `SELECT s.like_count,
            COALESCE((SELECT l.count FROM live_likes l
                       WHERE l.stream_id = s.id AND l.user_id = :userId), 0) AS yours
       FROM live_streams s WHERE s.id = :streamId`,
    { streamId: stream.id, userId },
  );

  return {
    likeCount: Number(totals?.like_count ?? 0),
    yours: Number(totals?.yours ?? 0),
  };
}

/** Streams the caller has hosted, for their own history. */
export async function myStreams(userId: number, limit = 30): Promise<LiveStream[]> {
  const rows = await query<StreamRow>(
    `${STREAM_SELECT} AND s.host_id = :userId
      ORDER BY s.created_at DESC LIMIT :limit`,
    { userId, limit },
  );
  return rows.map(toStream);
}
