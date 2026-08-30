/**
 * Video listing and taxonomy.
 *
 * Completes two routes that were declared in the shared contract but never
 * implemented: a creator's own videos, and the public category list. Both are
 * needed by screens that already exist, and both are ordinary reads rather than
 * new capability.
 *
 * The visibility rules are the same ones the feed uses. A profile is a second
 * route to the same content, so it has to make the same decisions — otherwise
 * private videos leak through the profile even though the feed hides them.
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
import { storage } from '../../core/storage.ts';

export const videosRouter: Router = Router();

interface VideoRow {
  public_id: string;
  caption: string;
  duration_sec: string;
  privacy: string;
  status: string;
  processing_status: string;
  hls_key: string | null;
  poster_key: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  published_at: Date | null;
  created_at: Date;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

function toSummary(row: VideoRow) {
  return {
    id: row.public_id,
    caption: row.caption,
    durationSec: Number(row.duration_sec),
    privacy: row.privacy,
    status: row.status,
    ready: row.processing_status === 'complete',
    // Public media stays unsigned so the edge cache remains useful.
    hlsUrl: row.hls_key ? storage.url(row.hls_key) : null,
    posterUrl: row.poster_key ? storage.url(row.poster_key) : null,
    stats: {
      views: Number(row.view_count),
      likes: Number(row.like_count),
      comments: Number(row.comment_count),
      shares: Number(row.share_count),
    },
    author: {
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar_url,
    },
    createdAt: new Date(row.published_at ?? row.created_at).toISOString(),
  };
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const SELECT = `
  SELECT v.public_id, v.caption, v.duration_sec, v.privacy, v.status, v.processing_status,
         v.hls_key, v.poster_key, v.view_count, v.like_count, v.comment_count, v.share_count,
         v.published_at, v.created_at,
         u.username, p.display_name, p.avatar_url
    FROM videos v
    JOIN users u ON u.id = v.user_id
    JOIN user_profiles p ON p.user_id = v.user_id
`;

/** The caller's own videos, including ones still processing. */
videosRouter.get(
  '/me/videos',
  requireAuth,
  limits.read,
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const { limit } = valid<{ query: typeof listQuerySchema }>(req).query;

    const rows = await query<VideoRow>(
      `${SELECT}
        WHERE v.user_id = :userId AND v.deleted_at IS NULL
        ORDER BY COALESCE(v.published_at, v.created_at) DESC
        LIMIT :limit`,
      { userId: authed.userId, limit: limit ?? 30 },
    );

    res.json(ok(rows.map(toSummary)));
  }),
);

/**
 * Another creator's videos.
 *
 * Only published, public ones. A viewer looking at a profile is not entitled to
 * more than the feed would give them, and a blocked viewer sees nothing at all.
 */
videosRouter.get(
  '/users/:username/videos',
  optionalAuth,
  limits.read,
  validate({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res) => {
    const viewerId = (req as Partial<AuthedRequest>).userId;
    const { limit } = valid<{ query: typeof listQuerySchema }>(req).query;

    const owner = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE username = :username AND deleted_at IS NULL',
      { username: String(req.params.username).toLowerCase() },
    );
    if (!owner) throw new AppError('not_found', 'Account not found.');

    if (viewerId !== undefined && viewerId !== owner.id) {
      const blocked = await queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM blocks
          WHERE deleted_at IS NULL
            AND ((blocker_id = :viewer AND blocked_id = :owner)
              OR (blocker_id = :owner AND blocked_id = :viewer))`,
        { viewer: viewerId, owner: owner.id },
      );
      // Same answer as a missing account — confirming the block is itself a
      // disclosure the blocker did not agree to.
      if (Number(blocked?.c ?? 0) > 0) throw new AppError('not_found', 'Account not found.');
    }

    // The owner viewing their own profile sees everything.
    const ownView = viewerId === owner.id;

    const rows = await query<VideoRow>(
      `${SELECT}
        WHERE v.user_id = :ownerId AND v.deleted_at IS NULL
          ${ownView ? '' : "AND v.status = 'published' AND v.privacy = 'public'"}
        ORDER BY COALESCE(v.published_at, v.created_at) DESC
        LIMIT :limit`,
      { ownerId: owner.id, limit: limit ?? 30 },
    );

    res.json(ok(rows.map(toSummary)));
  }),
);

/** The public category list, used by discovery and by the create flow. */
videosRouter.get(
  '/discover/categories',
  optionalAuth,
  limits.read,
  asyncHandler(async (_req, res) => {
    const rows = await query<{
      id: number;
      slug: string;
      name: string;
      icon: string | null;
      color: string | null;
      video_count: number;
    }>(
      `SELECT c.id, c.slug, c.name, c.icon, c.color,
              (SELECT COUNT(*) FROM videos v
                WHERE v.category_id = c.id AND v.status = 'published'
                  AND v.privacy = 'public' AND v.deleted_at IS NULL) AS video_count
         FROM categories c
        WHERE c.is_enabled = 1
        ORDER BY c.sort_order, c.name`,
    );

    res.json(
      ok(
        rows.map((r) => ({
          id: String(r.id),
          slug: r.slug,
          name: r.name,
          icon: r.icon,
          color: r.color,
          videoCount: Number(r.video_count),
        })),
      ),
    );
  }),
);

/** Trending hashtags, for the discovery screens. */
videosRouter.get(
  '/discover/hashtags',
  optionalAuth,
  limits.read,
  asyncHandler(async (_req, res) => {
    const rows = await query<{ tag: string; video_count: number; view_count: number }>(
      `SELECT tag, video_count, view_count FROM hashtags
        ORDER BY video_count DESC, view_count DESC
        LIMIT 30`,
    );
    res.json(
      ok(
        rows.map((r) => ({
          tag: r.tag,
          videoCount: Number(r.video_count),
          viewCount: Number(r.view_count),
        })),
      ),
    );
  }),
);

/**
 * Videos in one category, and videos under one hashtag.
 *
 * Both are ordinary public reads over content the feed already serves, so they
 * apply the same three rules: published only, public only, and nothing from an
 * account either party has blocked. Sorting is an explicit whitelist rather than
 * a column name from the query string.
 */

/** Blocks are symmetric: neither side sees the other's content. */
const NOT_BLOCKED = `
  AND (:viewerId IS NULL OR NOT EXISTS (
        SELECT 1 FROM blocks b
         WHERE b.deleted_at IS NULL
           AND ((b.blocker_id = :viewerId AND b.blocked_id = v.user_id)
             OR (b.blocker_id = v.user_id AND b.blocked_id = :viewerId))))
`;

const PUBLIC_ONLY = `
  v.deleted_at IS NULL
  AND v.status = 'published'
  AND v.privacy = 'public'
  AND v.processing_status = 'complete'
`;

const discoverQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  sort: z.enum(['popular', 'recent']).optional(),
});

videosRouter.get(
  '/discover/categories/:slug/videos',
  optionalAuth,
  limits.read,
  validate({ query: discoverQuerySchema }),
  asyncHandler(async (req: Request, res) => {
    const viewerId = (req as Partial<AuthedRequest>).userId ?? null;
    const { limit, sort } = valid<{ query: typeof discoverQuerySchema }>(req).query;

    const category = await queryOne<{ id: number; name: string }>(
      'SELECT id, name FROM categories WHERE slug = :slug AND is_enabled = 1',
      { slug: String(req.params.slug).toLowerCase() },
    );
    if (!category) throw new AppError('not_found', 'Category not found.');

    // Chosen from a fixed set — never interpolated from user input.
    const order =
      sort === 'recent'
        ? 'COALESCE(v.published_at, v.created_at) DESC'
        : 'v.view_count DESC, COALESCE(v.published_at, v.created_at) DESC';

    const rows = await query<VideoRow>(
      `${SELECT}
        WHERE ${PUBLIC_ONLY}
          AND v.category_id = :categoryId
          ${NOT_BLOCKED}
        ORDER BY ${order}
        LIMIT :limit`,
      { categoryId: category.id, viewerId, limit: limit ?? 30 },
    );

    res.json(ok(rows.map(toSummary)));
  }),
);

videosRouter.get(
  '/discover/hashtags/:tag/videos',
  optionalAuth,
  limits.read,
  validate({ query: discoverQuerySchema }),
  asyncHandler(async (req: Request, res) => {
    const viewerId = (req as Partial<AuthedRequest>).userId ?? null;
    const { limit, sort } = valid<{ query: typeof discoverQuerySchema }>(req).query;

    // Tags are stored without the leading '#'; accept it either way.
    const tag = String(req.params.tag).replace(/^#/, '').toLowerCase();

    const order =
      sort === 'recent'
        ? 'COALESCE(v.published_at, v.created_at) DESC'
        : 'v.view_count DESC, COALESCE(v.published_at, v.created_at) DESC';

    const rows = await query<VideoRow>(
      `${SELECT}
         JOIN video_hashtags vh ON vh.video_id = v.id
         JOIN hashtags h ON h.id = vh.hashtag_id
        WHERE ${PUBLIC_ONLY}
          AND h.tag = :tag
          ${NOT_BLOCKED}
        ORDER BY ${order}
        LIMIT :limit`,
      { tag, viewerId, limit: limit ?? 30 },
    );

    res.json(ok(rows.map(toSummary)));
  }),
);

/**
 * Search across accounts, videos and hashtags.
 *
 * A prefix match on an index, not a relevance engine — that belongs to a real
 * search service later. What matters here is that it applies the same visibility
 * rules as everything else, and that `q` is always a bound parameter.
 */
const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  type: z.enum(['all', 'users', 'videos', 'hashtags']).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});

videosRouter.get(
  '/search',
  optionalAuth,
  limits.read,
  validate({ query: searchQuerySchema }),
  asyncHandler(async (req: Request, res) => {
    const viewerId = (req as Partial<AuthedRequest>).userId ?? null;
    const { q, type, limit } = valid<{ query: typeof searchQuerySchema }>(req).query;
    const take = limit ?? 20;
    const want = type ?? 'all';

    // LIKE wildcards in the term itself would otherwise widen the match.
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const contains = `%${escaped}%`;
    const prefix = `${escaped}%`;

    const users =
      want === 'all' || want === 'users'
        ? await query<{
            public_id: string;
            username: string;
            display_name: string;
            avatar_url: string | null;
            follower_count: number;
            verification_tier: string;
            is_following: number;
            is_self: number;
          }>(
            // The viewer's relationship comes back with the row. Without it every
            // result renders "Follow", including for accounts the viewer already
            // follows and for the viewer's own account.
            `SELECT u.public_id, u.username, u.verification_tier,
                    p.display_name, p.avatar_url, p.follower_count,
                    (:viewerId IS NOT NULL AND EXISTS (
                       SELECT 1 FROM follows f
                        WHERE f.follower_id = :viewerId AND f.followee_id = u.id
                          AND f.deleted_at IS NULL)) AS is_following,
                    (:viewerId IS NOT NULL AND u.id = :viewerId) AS is_self
               FROM users u
               JOIN user_profiles p ON p.user_id = u.id
              WHERE u.deleted_at IS NULL
                AND u.status = 'active'
                AND (u.username LIKE :contains OR p.display_name LIKE :contains)
                AND (:viewerId IS NULL OR NOT EXISTS (
                      SELECT 1 FROM blocks b
                       WHERE b.deleted_at IS NULL
                         AND ((b.blocker_id = :viewerId AND b.blocked_id = u.id)
                           OR (b.blocker_id = u.id AND b.blocked_id = :viewerId))))
              ORDER BY (u.username = :exact) DESC, p.follower_count DESC
              LIMIT :limit`,
            { contains, exact: q.toLowerCase(), viewerId, limit: take },
          )
        : [];

    const videoRows =
      want === 'all' || want === 'videos'
        ? await query<VideoRow>(
            `${SELECT}
              WHERE ${PUBLIC_ONLY}
                AND v.caption LIKE :contains
                ${NOT_BLOCKED}
              ORDER BY v.view_count DESC
              LIMIT :limit`,
            { contains, viewerId, limit: take },
          )
        : [];

    const hashtags =
      want === 'all' || want === 'hashtags'
        ? await query<{ tag: string; video_count: number; view_count: number }>(
            `SELECT tag, video_count, view_count FROM hashtags
              WHERE tag LIKE :prefix
              ORDER BY video_count DESC, view_count DESC
              LIMIT :limit`,
            { prefix, limit: take },
          )
        : [];

    res.json(
      ok({
        query: q,
        users: users.map((u) => ({
          id: u.public_id,
          username: u.username,
          displayName: u.display_name,
          avatar: u.avatar_url,
          followers: Number(u.follower_count),
          verificationTier: u.verification_tier,
          isFollowing: Number(u.is_following) === 1,
          isSelf: Number(u.is_self) === 1,
        })),
        videos: videoRows.map(toSummary),
        hashtags: hashtags.map((h) => ({
          tag: h.tag,
          videoCount: Number(h.video_count),
          viewCount: Number(h.view_count),
        })),
      }),
    );
  }),
);

/**
 * Explore's two remaining lists.
 *
 * `trending` is ordered by measured views, not by anything an advertiser can
 * buy — a promoted video earns its place in Explore the same way as any other.
 * `creators` is ordered by real follower counts for the same reason.
 */

videosRouter.get(
  '/discover/trending',
  optionalAuth,
  limits.read,
  validate({ query: discoverQuerySchema }),
  asyncHandler(async (req: Request, res) => {
    const viewerId = (req as Partial<AuthedRequest>).userId ?? null;
    const { limit } = valid<{ query: typeof discoverQuerySchema }>(req).query;

    const rows = await query<VideoRow>(
      `${SELECT}
        WHERE ${PUBLIC_ONLY}
          ${NOT_BLOCKED}
        ORDER BY v.view_count DESC, v.like_count DESC
        LIMIT :limit`,
      { viewerId, limit: limit ?? 12 },
    );

    res.json(ok(rows.map(toSummary)));
  }),
);

/**
 * The Following feed: videos from accounts the viewer actually follows.
 *
 * Newest first, and nothing else — no ranking, no recommendation, no promoted
 * slots. Someone who chose to follow an account asked for exactly this, and a
 * "following" tab that reorders or pads what it shows is not a following tab.
 *
 * An empty answer is a real answer: it means the people you follow have not
 * posted, or you follow nobody yet.
 */
videosRouter.get(
  '/discover/following',
  requireAuth,
  limits.read,
  validate({ query: discoverQuerySchema }),
  asyncHandler(async (req: Request, res) => {
    const { userId } = req as AuthedRequest;
    const { limit } = valid<{ query: typeof discoverQuerySchema }>(req).query;

    const rows = await query<VideoRow>(
      `${SELECT}
        WHERE ${PUBLIC_ONLY}
          AND EXISTS (SELECT 1 FROM follows f
                       WHERE f.follower_id = :viewerId
                         AND f.followee_id = v.user_id
                         AND f.deleted_at IS NULL)
        ORDER BY v.published_at DESC, v.id DESC
        LIMIT :limit`,
      { viewerId: userId, limit: limit ?? 12 },
    );

    res.json(ok(rows.map(toSummary)));
  }),
);

videosRouter.get(
  '/discover/creators',
  optionalAuth,
  limits.read,
  validate({ query: discoverQuerySchema }),
  asyncHandler(async (req: Request, res) => {
    const viewerId = (req as Partial<AuthedRequest>).userId ?? null;
    const { limit } = valid<{ query: typeof discoverQuerySchema }>(req).query;

    const rows = await query<{
      public_id: string;
      username: string;
      display_name: string;
      bio: string | null;
      avatar_url: string | null;
      follower_count: number;
      video_count: number;
      verification_tier: string;
      is_following: number;
    }>(
      `SELECT u.public_id, u.username, u.verification_tier,
              p.display_name, p.bio, p.avatar_url, p.follower_count, p.video_count,
              (:viewerId IS NOT NULL AND EXISTS (
                 SELECT 1 FROM follows f
                  WHERE f.follower_id = :viewerId AND f.followee_id = u.id
                    AND f.deleted_at IS NULL)) AS is_following
         FROM users u
         JOIN user_profiles p ON p.user_id = u.id
        WHERE u.deleted_at IS NULL
          AND u.status = 'active'
          AND p.is_private = 0
          AND p.video_count > 0
          AND (:viewerId IS NULL OR u.id <> :viewerId)
          AND (:viewerId IS NULL OR NOT EXISTS (
                SELECT 1 FROM blocks b
                 WHERE b.deleted_at IS NULL
                   AND ((b.blocker_id = :viewerId AND b.blocked_id = u.id)
                     OR (b.blocker_id = u.id AND b.blocked_id = :viewerId))))
        ORDER BY p.follower_count DESC, p.video_count DESC
        LIMIT :limit`,
      { viewerId, limit: limit ?? 10 },
    );

    res.json(
      ok(
        rows.map((r) => ({
          id: r.public_id,
          username: r.username,
          displayName: r.display_name,
          bio: r.bio ?? '',
          avatar: r.avatar_url,
          followers: Number(r.follower_count),
          videos: Number(r.video_count),
          verificationTier: r.verification_tier,
          isFollowing: Number(r.is_following) === 1,
        })),
      ),
    );
  }),
);
