/**
 * Admin routes over people and content.
 *
 * Reads are plain queries over the owning tables. Writes fall into two camps:
 *
 * - **Catalogue rows** (categories, hashtags, music, creative assets, banners,
 *   flags, regions) are edited directly here, with an audit row each.
 * - **People and their content** are NOT edited here. Suspending a user or
 *   removing a video goes through the moderation module, which writes the
 *   record and the enforcement in one transaction (ADR-038). This file only
 *   shows the queue; the decision has one door.
 */

import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { requireAdmin, type AdminRequest } from '../../middleware/rbac.ts';
import { AppError } from '../../core/errors.ts';
import { query, queryOne, execute } from '../../core/db.ts';
import { audit } from '../../middleware/audit.ts';
import * as admin from './admin.service.ts';

export const adminContentRouter: Router = Router();
const guard: RequestHandler[] = [requireAuth, requireAdmin];

const pageSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

// ── Users ──

adminContentRouter.get(
  '/admin/users',
  ...guard,
  limits.read,
  validate({ query: pageSchema }),
  asyncHandler(async (req, res) => {
    const q = valid<{ query: typeof pageSchema }>(req).query;
    const where: string[] = ['u.deleted_at IS NULL'];
    const params: Record<string, unknown> = { limit: q.limit ?? 50, offset: q.offset ?? 0 };

    if (q.q) {
      where.push('(u.username LIKE :search OR u.email LIKE :search OR p.display_name LIKE :search)');
      params.search = `%${q.q}%`;
    }
    if (q.status && q.status !== 'all') {
      where.push('u.status = :status');
      params.status = q.status;
    }

    const rows = await query(
      `SELECT u.public_id AS id, u.username, u.email, u.status, u.account_category AS category,
              u.verification_tier AS verified, u.created_at AS joinedAt, u.last_active_at AS lastActiveAt,
              p.display_name AS name, p.avatar_url AS avatar,
              (SELECT COUNT(*) FROM videos v WHERE v.user_id = u.id AND v.deleted_at IS NULL) AS videos,
              (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id AND f.deleted_at IS NULL) AS followers,
              (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'user' AND r.target_id = u.id AND r.status = 'open') AS openReports
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE ${where.join(' AND ')}
        ORDER BY u.id DESC
        LIMIT :limit OFFSET :offset`,
      params,
    );

    const total = await queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL',
    );
    res.json(ok({ items: rows, total: Number(total?.c ?? 0) }));
  }),
);

adminContentRouter.get(
  '/admin/users/:id',
  ...guard,
  limits.read,
  asyncHandler(async (req, res) => {
    const publicId = String(req.params.id);
    const user = await queryOne<{ id: number } & Record<string, unknown>>(
      `SELECT u.id, u.public_id AS publicId, u.username, u.email, u.status, u.status_reason AS statusReason,
              u.account_category AS category, u.account_type AS type, u.verification_tier AS verified,
              u.country_code AS country, u.created_at AS joinedAt, u.last_active_at AS lastActiveAt,
              p.display_name AS name, p.avatar_url AS avatar, p.bio
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.public_id = :publicId AND u.deleted_at IS NULL`,
      { publicId },
    );
    if (!user) throw new AppError('not_found', 'No such account.');

    const [wallet, counts, actions] = await Promise.all([
      queryOne(
        `SELECT coin_balance AS coins, reward_balance AS rewards, live_gift_balance AS gifts,
                withdrawable_amount AS withdrawable, total_earned AS totalEarned, is_frozen AS frozen
           FROM wallets WHERE user_id = :id`,
        { id: user.id },
      ),
      queryOne(
        `SELECT
           (SELECT COUNT(*) FROM videos WHERE user_id = :id AND deleted_at IS NULL) AS videos,
           (SELECT COUNT(*) FROM follows WHERE followee_id = :id AND deleted_at IS NULL) AS followers,
           (SELECT COUNT(*) FROM follows WHERE follower_id = :id AND deleted_at IS NULL) AS following,
           (SELECT COUNT(*) FROM reports WHERE target_type = 'user' AND target_id = :id) AS reports`,
        { id: user.id },
      ),
      query(
        `SELECT id, action, reason,
                CASE WHEN reverted_at IS NULL THEN 'active' ELSE 'reverted' END AS status,
                created_at AS createdAt
           FROM moderation_actions
          WHERE target_type = 'user' AND target_id = :id
          ORDER BY id DESC LIMIT 10`,
        { id: user.id },
      ),
    ]);

    const { id: _internal, ...safe } = user;
    res.json(ok({ ...safe, wallet, counts, moderation: actions }));
  }),
);

// ── Videos ──

adminContentRouter.get(
  '/admin/videos',
  ...guard,
  limits.read,
  validate({ query: pageSchema }),
  asyncHandler(async (req, res) => {
    const q = valid<{ query: typeof pageSchema }>(req).query;
    const where: string[] = ['v.deleted_at IS NULL'];
    const params: Record<string, unknown> = { limit: q.limit ?? 50, offset: q.offset ?? 0 };

    if (q.q) {
      where.push('(v.caption LIKE :search OR u.username LIKE :search)');
      params.search = `%${q.q}%`;
    }
    if (q.status && q.status !== 'all') {
      where.push('v.status = :status');
      params.status = q.status;
    }

    const rows = await query(
      `SELECT v.public_id AS id, v.caption, v.status, v.privacy, v.duration_sec AS durationSec,
              v.view_count AS views, v.like_count AS likes, v.comment_count AS comments,
              v.created_at AS createdAt, v.published_at AS publishedAt,
              u.username, u.public_id AS userId,
              (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'video' AND r.target_id = v.id AND r.status = 'open') AS openReports
         FROM videos v
         JOIN users u ON u.id = v.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY v.id DESC
        LIMIT :limit OFFSET :offset`,
      params,
    );
    res.json(ok({ items: rows }));
  }),
);

// ── Comments ──

adminContentRouter.get(
  '/admin/comments',
  ...guard,
  limits.read,
  validate({ query: pageSchema }),
  asyncHandler(async (req, res) => {
    const q = valid<{ query: typeof pageSchema }>(req).query;
    const params: Record<string, unknown> = { limit: q.limit ?? 50 };
    let search = '';
    if (q.q) {
      search = 'AND (c.body LIKE :search OR u.username LIKE :search)';
      params.search = `%${q.q}%`;
    }
    const rows = await query(
      `SELECT c.public_id AS id, c.body, c.status, c.like_count AS likes, c.created_at AS createdAt,
              u.username, v.public_id AS videoId, v.caption AS videoCaption,
              (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.status = 'open') AS openReports
         FROM comments c
         JOIN users u ON u.id = c.user_id
         JOIN videos v ON v.id = c.video_id
        WHERE c.deleted_at IS NULL ${search}
        ORDER BY c.id DESC LIMIT :limit`,
      params,
    );
    res.json(ok({ items: rows }));
  }),
);

// ── Catalogue editors ──
//
// One helper covers the whole family: list rows, toggle or edit one, audit it.
// Each table gets an explicit column allow-list — "edit any column by name"
// would be a SQL injection dressed as a feature.

function catalogueEditor(options: {
  path: string;
  module: string;
  table: string;
  idColumn?: string;
  listSql: string;
  editable: Record<string, 'string' | 'number' | 'boolean'>;
}): void {
  const idColumn = options.idColumn ?? 'id';

  adminContentRouter.get(
    `/admin/${options.path}`,
    ...guard,
    limits.read,
    asyncHandler(async (_req, res) => {
      res.json(ok({ items: await query(options.listSql) }));
    }),
  );

  const patchSchema = z.object({
    changes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  });

  adminContentRouter.patch(
    `/admin/${options.path}/:id`,
    ...guard,
    limits.write,
    validate({ body: patchSchema }),
    asyncHandler(async (req, res) => {
      const body = valid<{ body: typeof patchSchema }>(req).body;
      const id = String(req.params.id);

      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      for (const [column, value] of Object.entries(body.changes)) {
        const kind = options.editable[column];
        if (!kind) throw new AppError('validation_failed', `'${column}' is not editable here.`);
        if (kind === 'boolean' && typeof value !== 'boolean') {
          throw new AppError('validation_failed', `'${column}' expects a boolean.`);
        }
        if (kind === 'number' && typeof value !== 'number') {
          throw new AppError('validation_failed', `'${column}' expects a number.`);
        }
        sets.push(`\`${column}\` = :set_${column}`);
        params[`set_${column}`] = kind === 'boolean' ? (value ? 1 : 0) : value;
      }
      if (sets.length === 0) throw new AppError('validation_failed', 'Nothing to change.');

      const result = await execute(
        `UPDATE \`${options.table}\` SET ${sets.join(', ')} WHERE \`${idColumn}\` = :id`,
        params,
      );
      if (result.affectedRows === 0) throw new AppError('not_found', 'No such row.');

      await audit(req, {
        module: options.module,
        action: 'update',
        targetType: options.table,
        targetId: id,
        newValue: body.changes,
      });
      res.json(ok({ saved: true }));
    }),
  );
}

catalogueEditor({
  path: 'categories',
  module: 'categories',
  table: 'categories',
  listSql: `SELECT id, slug, name, icon, color, sort_order AS sortOrder, is_enabled AS isEnabled,
                   (SELECT COUNT(*) FROM videos v WHERE v.category_id = categories.id AND v.deleted_at IS NULL) AS videos
              FROM categories ORDER BY sort_order, id`,
  editable: { name: 'string', icon: 'string', color: 'string', sort_order: 'number', is_enabled: 'boolean' },
});

catalogueEditor({
  path: 'hashtags',
  module: 'hashtags',
  table: 'hashtags',
  listSql: `SELECT id, tag, status, is_featured AS isFeatured, video_count AS videos, view_count AS views,
                   created_at AS createdAt
              FROM hashtags ORDER BY video_count DESC LIMIT 200`,
  editable: { status: 'string', is_featured: 'boolean' },
});

catalogueEditor({
  path: 'music',
  module: 'music',
  table: 'music_tracks',
  listSql: `SELECT id, title, artist, category, duration_sec AS durationSec, licence_status AS licence,
                   is_trending AS isTrending, is_enabled AS isEnabled, usage_count AS uses
              FROM music_tracks WHERE deleted_at IS NULL ORDER BY usage_count DESC LIMIT 200`,
  editable: { is_enabled: 'boolean', is_trending: 'boolean', licence_status: 'string', category: 'string' },
});

catalogueEditor({
  path: 'creative',
  module: 'creative',
  table: 'creative_assets',
  listSql: `SELECT id, kind, slug, name, category, sort_order AS sortOrder, is_enabled AS isEnabled,
                   is_trending AS isTrending, is_new AS isNew, is_premium AS isPremium, usage_count AS uses
              FROM creative_assets ORDER BY kind, sort_order LIMIT 300`,
  editable: { is_enabled: 'boolean', is_trending: 'boolean', is_new: 'boolean', is_premium: 'boolean', sort_order: 'number' },
});

catalogueEditor({
  path: 'flags',
  module: 'flags',
  table: 'feature_flags',
  listSql: `SELECT id, flag_key AS flagKey, label, description, is_enabled AS isEnabled,
                   rollout_percent AS rolloutPercent, updated_at AS updatedAt
              FROM feature_flags ORDER BY flag_key`,
  editable: { is_enabled: 'boolean', rollout_percent: 'number', label: 'string', description: 'string' },
});

catalogueEditor({
  path: 'regions',
  module: 'regions',
  table: 'country_settings',
  idColumn: 'code',
  listSql: `SELECT code, name, currency, is_enabled AS isEnabled, ads_enabled AS adsEnabled,
                   business_enabled AS businessEnabled, verification_enabled AS verificationEnabled
              FROM country_settings ORDER BY name`,
  editable: {
    is_enabled: 'boolean',
    ads_enabled: 'boolean',
    business_enabled: 'boolean',
    verification_enabled: 'boolean',
    currency: 'string',
  },
});

// Feature flags can also be created — the other catalogues ship seeded.
const createFlagSchema = z.object({
  flagKey: z.string().trim().regex(/^[a-z0-9_.-]{2,60}$/),
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});

adminContentRouter.post(
  '/admin/flags',
  ...guard,
  limits.write,
  validate({ body: createFlagSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof createFlagSchema }>(req).body;
    try {
      await execute(
        `INSERT INTO feature_flags (flag_key, label, description, is_enabled, rollout_percent, updated_by)
         VALUES (:flagKey, :label, :description, 0, 100, :adminId)`,
        {
          flagKey: body.flagKey,
          label: body.label,
          description: body.description ?? '',
          adminId: (req as AdminRequest).adminId,
        },
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new AppError('conflict', 'A flag with that key already exists.');
      }
      throw err;
    }
    await audit(req, {
      module: 'flags',
      action: 'create',
      targetType: 'feature_flags',
      targetId: body.flagKey,
    });
    res.status(201).json(ok({ created: true }));
  }),
);

// ── Live streams ──

adminContentRouter.get(
  '/admin/live',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT s.public_id AS id, s.title, s.category, s.status, s.started_at AS startedAt,
              s.ended_at AS endedAt, s.viewer_count AS viewers, s.peak_viewers AS peakViewers,
              s.like_count AS likes, s.created_at AS createdAt, u.username AS host
         FROM live_streams s
         JOIN users u ON u.id = s.host_id
        ORDER BY (s.status = 'live') DESC, s.id DESC
        LIMIT 100`,
    );
    res.json(ok({ items: rows }));
  }),
);

// ── Communities ──

adminContentRouter.get(
  '/admin/communities',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT c.public_id AS id, c.name, c.is_private AS isPrivate, c.status,
              c.member_count AS members, c.created_at AS createdAt, u.username AS owner,
              (SELECT COUNT(*) FROM community_join_requests j WHERE j.community_id = c.id AND j.status = 'pending') AS pendingRequests
         FROM communities c
         JOIN users u ON u.id = c.owner_id
        WHERE c.deleted_at IS NULL
        ORDER BY c.member_count DESC
        LIMIT 100`,
    );
    res.json(ok({ items: rows }));
  }),
);

// ── Banners ──

adminContentRouter.get(
  '/admin/banners',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT id, title, subtitle, placement, status, cta_label AS ctaLabel, cta_url AS ctaUrl,
              starts_at AS startsAt, ends_at AS endsAt, impressions, clicks, created_at AS createdAt
         FROM banners ORDER BY id DESC LIMIT 100`,
    );
    res.json(ok({ items: rows }));
  }),
);

const bannerSchema = z.object({
  title: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(255).optional(),
  placement: z.enum(['explore_top', 'home_promo', 'campaign_banner']),
  ctaLabel: z.string().trim().max(40).optional(),
  ctaUrl: z.string().trim().url().max(500).optional(),
});

adminContentRouter.post(
  '/admin/banners',
  ...guard,
  limits.write,
  validate({ body: bannerSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof bannerSchema }>(req).body;
    const result = await execute(
      `INSERT INTO banners (title, subtitle, placement, status, cta_label, cta_url)
       VALUES (:title, :subtitle, :placement, 'draft', :ctaLabel, :ctaUrl)`,
      {
        title: body.title,
        subtitle: body.subtitle ?? null,
        placement: body.placement,
        ctaLabel: body.ctaLabel ?? null,
        ctaUrl: body.ctaUrl ?? null,
      },
    );
    await audit(req, {
      module: 'banners',
      action: 'create',
      targetType: 'banners',
      targetId: result.insertId,
      newValue: body,
    });
    res.status(201).json(ok({ id: result.insertId }));
  }),
);

const bannerStatusSchema = z.object({ status: z.enum(['draft', 'scheduled', 'live', 'ended']) });

adminContentRouter.patch(
  '/admin/banners/:id',
  ...guard,
  limits.write,
  validate({ body: bannerStatusSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof bannerStatusSchema }>(req).body;
    const result = await execute(
      `UPDATE banners SET status = :status,
              starts_at = CASE WHEN :status = 'live' AND starts_at IS NULL THEN CURRENT_TIMESTAMP(3) ELSE starts_at END,
              ends_at   = CASE WHEN :status = 'ended' THEN CURRENT_TIMESTAMP(3) ELSE ends_at END
        WHERE id = :id`,
      { status: body.status, id: Number(req.params.id) },
    );
    if (result.affectedRows === 0) throw new AppError('not_found', 'No such banner.');
    await audit(req, {
      module: 'banners',
      action: 'status',
      targetType: 'banners',
      targetId: String(req.params.id),
      newValue: body,
    });
    res.json(ok({ saved: true }));
  }),
);

// ── Notification campaigns ──

adminContentRouter.get(
  '/admin/notification-campaigns',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT id, title, body, audience, status, scheduled_at AS scheduledAt,
              sent_count AS sentCount, created_at AS createdAt
         FROM notification_campaigns ORDER BY id DESC LIMIT 50`,
    );
    res.json(ok({ items: rows }));
  }),
);

const campaignSchema = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(500),
});

/**
 * Composes and immediately sends a platform announcement.
 *
 * Delivery is the in-app inbox, written in one INSERT…SELECT so ten thousand
 * users cost one statement, not ten thousand round trips. It lands as a
 * `system` notification — the kind that always reaches the inbox — but it
 * respects nothing *more* than that: no push, no email. A megaphone that could
 * page every phone at 3am belongs behind a push provider that exists.
 */
adminContentRouter.post(
  '/admin/notification-campaigns',
  ...guard,
  limits.write,
  validate({ body: campaignSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof campaignSchema }>(req).body;
    const a = req as AdminRequest;

    const campaign = await execute(
      `INSERT INTO notification_campaigns (title, body, audience, status, created_by)
       VALUES (:title, :body, 'all_users', 'sending', :adminId)`,
      { title: body.title, body: body.body, adminId: a.adminId },
    );

    const sent = await execute(
      `INSERT INTO notifications (user_id, kind, body)
       SELECT id, 'system', :message FROM users WHERE deleted_at IS NULL AND status = 'active'`,
      { message: `${body.title} — ${body.body}` },
    );

    await execute(
      `UPDATE notification_campaigns SET status = 'sent', sent_count = :count WHERE id = :id`,
      { count: sent.affectedRows, id: campaign.insertId },
    );

    await audit(req, {
      module: 'notifications',
      action: 'send_campaign',
      targetType: 'notification_campaigns',
      targetId: campaign.insertId,
      newValue: { title: body.title, recipients: sent.affectedRows },
    });

    res.status(201).json(ok({ id: campaign.insertId, recipients: sent.affectedRows }));
  }),
);
