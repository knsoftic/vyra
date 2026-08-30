/**
 * Notification routes.
 *
 * Reading the inbox, setting preferences, and registering a device for push.
 *
 * Nothing here sends anything. Notifications are produced as a side effect of
 * something happening — a follow, a gift, a decision — never by asking for one.
 */

import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { queryOne } from '../../core/db.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { requireAdmin } from '../../middleware/rbac.ts';
import * as notifications from './notifications.service.ts';
import * as outbox from './outbox.service.ts';

export const notificationsRouter: Router = Router();

const listQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const preferenceSchema = z.object({
  kind: z.enum(notifications.PREFERENCE_KINDS),
  inApp: z.boolean().optional(),
  push: z.boolean().optional(),
  email: z.boolean().optional(),
});

const quietHoursSchema = z.object({
  start: z.coerce.number().int().min(0).max(23).nullable(),
  end: z.coerce.number().int().min(0).max(23).nullable(),
});

const deviceSchema = z.object({
  deviceId: z.string().trim().min(8).max(128),
  platform: z.enum(['ios', 'android', 'web']),
  pushToken: z.string().trim().min(8).max(255),
  appVersion: z.string().trim().max(20).optional(),
});

// ── The inbox ──

notificationsRouter.get(
  '/me/notifications',
  requireAuth,
  limits.read,
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const q = valid<{ query: typeof listQuerySchema }>(req).query;
    res.json(
      ok(
        await notifications.list(userId, {
          ...(q.unreadOnly ? { unreadOnly: true } : {}),
          ...(q.limit ? { limit: q.limit } : {}),
        }),
      ),
    );
  }),
);

notificationsRouter.get(
  '/me/notifications/count',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok({ unread: await notifications.unreadCount(userId) }));
  }),
);

/**
 * Everything waiting for this person, as one number.
 *
 * The tab bar shows a single badge combining unread chats and unread
 * notifications, and it is on screen constantly — so it gets one endpoint and
 * one round trip rather than pulling two full lists to count them.
 *
 * The badge previously came from the bundled sample data, which meant every
 * account on the platform was shown the same invented unread count.
 */
notificationsRouter.get(
  '/me/unread',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;

    const [notificationCount, chatRow] = await Promise.all([
      notifications.unreadCount(userId),
      queryOne<{ unread: number }>(
        `SELECT COALESCE(SUM(p.unread_count), 0) AS unread
           FROM chat_participants p
           JOIN chats c ON c.id = p.chat_id
          WHERE p.user_id = :userId
            AND p.left_at IS NULL
            AND p.deleted_at IS NULL
            AND p.is_muted = 0
            AND c.deleted_at IS NULL`,
        { userId },
      ),
    ]);

    // Muted chats are excluded above: a badge is a request for attention, and
    // muting a conversation is someone saying they do not want that.
    const chats = Number(chatRow?.unread ?? 0);
    res.json(ok({ chats, notifications: notificationCount, total: chats + notificationCount }));
  }),
);

notificationsRouter.post(
  '/me/notifications/read',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await notifications.markRead(userId)));
  }),
);

notificationsRouter.post(
  '/me/notifications/:id/read',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await notifications.markRead(userId, String(req.params.id))));
  }),
);

// ── Preferences ──

notificationsRouter.get(
  '/me/notification-preferences',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const [preferences, quietHours] = await Promise.all([
      notifications.preferencesFor(userId),
      notifications.quietHoursFor(userId),
    ]);
    res.json(ok({ preferences, quietHours }));
  }),
);

notificationsRouter.patch(
  '/me/notification-preferences',
  requireAuth,
  limits.write,
  validate({ body: preferenceSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof preferenceSchema }>(req).body;
    const { kind, ...channels } = body;
    res.json(ok(await notifications.setPreference(userId, kind, channels)));
  }),
);

notificationsRouter.patch(
  '/me/quiet-hours',
  requireAuth,
  limits.write,
  validate({ body: quietHoursSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof quietHoursSchema }>(req).body;
    res.json(ok(await notifications.setQuietHours(userId, body.start, body.end)));
  }),
);

// ── Devices ──

notificationsRouter.post(
  '/me/devices',
  requireAuth,
  limits.write,
  validate({ body: deviceSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof deviceSchema }>(req).body;
    res.json(ok(await notifications.registerDevice(userId, body)));
  }),
);

notificationsRouter.delete(
  '/me/devices/:deviceId',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await notifications.unregisterDevice(userId, String(req.params.deviceId))));
  }),
);

// ── Operations ──

/**
 * The delivery queue's state.
 *
 * Staff-only, and deliberately blunt: how many messages are waiting, how many
 * have failed, how old the oldest one is, and what transport is carrying them.
 * An outbox nobody watches is a silent failure.
 */
notificationsRouter.get(
  '/admin/outbox',
  requireAuth,
  requireAdmin,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await outbox.status()));
  }),
);

notificationsRouter.post(
  '/admin/outbox/drain',
  requireAuth,
  requireAdmin,
  limits.write,
  asyncHandler(async (_req, res) => {
    res.json(ok(await outbox.drain()));
  }),
);
