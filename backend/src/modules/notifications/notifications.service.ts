/**
 * Notifications.
 *
 * One entry point, `notify`, which every other module calls. Three rules it
 * enforces so that no caller has to remember them:
 *
 * **Preferences decide delivery.** A user who turns push off for likes gets no
 * push for likes. The check is here, once, rather than at each call site —
 * because a preference honoured in four places out of five is a preference the
 * user believes in and the platform ignores.
 *
 * **Blocks apply.** Somebody who blocked you does not hear from you, including
 * through a notification about something you did.
 *
 * **Nothing is sent to the person who caused it.** Liking your own video does
 * not notify you that your video was liked.
 *
 * Email and push are queued in the outbox rather than sent inline. The write is
 * part of whatever transaction caused it, so a crash loses neither the event nor
 * the message; a dead provider fails the drain rather than the user's request.
 */

import { ulid } from 'ulid';
import { query, queryOne, execute } from '../../core/db.ts';
import { logger } from '../../core/logger.ts';
import { emitToUser } from '../../socket.ts';
import { SOCKET_EVENTS } from '../../../../shared/contracts/routes.ts';
import type { PoolConnection } from 'mysql2/promise';

export type NotificationKind =
  | 'like'
  | 'comment'
  | 'follow'
  | 'mention'
  | 'gift'
  | 'system'
  | 'verification'
  | 'campaign'
  | 'task';

/** Everything a user can be reached about, including one with no in-app row. */
export const PREFERENCE_KINDS = [
  'like',
  'comment',
  'follow',
  'mention',
  'gift',
  'system',
  'verification',
  'campaign',
  'task',
  'marketing',
] as const;

export type PreferenceKind = (typeof PREFERENCE_KINDS)[number];

export interface ChannelPreferences {
  inApp: boolean;
  push: boolean;
  email: boolean;
}

/**
 * The defaults.
 *
 * In-app on for everything, push on for things a person did to you, email off
 * except where it is the only way to reach someone. Marketing is off on all
 * three channels — consent is given, not withdrawn.
 */
const DEFAULTS: Record<PreferenceKind, ChannelPreferences> = {
  like: { inApp: true, push: true, email: false },
  comment: { inApp: true, push: true, email: false },
  follow: { inApp: true, push: true, email: false },
  mention: { inApp: true, push: true, email: false },
  gift: { inApp: true, push: true, email: false },
  // System messages carry account and security news, so they reach the inbox
  // whatever else is off.
  system: { inApp: true, push: true, email: true },
  verification: { inApp: true, push: true, email: true },
  campaign: { inApp: true, push: false, email: false },
  task: { inApp: true, push: false, email: false },
  marketing: { inApp: false, push: false, email: false },
};

export async function preferencesFor(userId: number): Promise<Record<PreferenceKind, ChannelPreferences>> {
  const rows = await query<{ kind: string; in_app: number; push: number; email: number }>(
    'SELECT kind, in_app, push, email FROM notification_preferences WHERE user_id = :userId',
    { userId },
  );

  const stored = new Map(
    rows.map((r) => [
      r.kind,
      { inApp: r.in_app === 1, push: r.push === 1, email: r.email === 1 },
    ]),
  );

  const result = {} as Record<PreferenceKind, ChannelPreferences>;
  for (const kind of PREFERENCE_KINDS) {
    result[kind] = stored.get(kind) ?? DEFAULTS[kind];
  }
  return result;
}

export async function setPreference(
  userId: number,
  kind: PreferenceKind,
  channels: Partial<ChannelPreferences>,
): Promise<ChannelPreferences> {
  const current = (await preferencesFor(userId))[kind];
  const next: ChannelPreferences = { ...current, ...channels };

  await execute(
    `INSERT INTO notification_preferences (user_id, kind, in_app, push, email)
     VALUES (:userId, :kind, :inApp, :push, :email)
     ON DUPLICATE KEY UPDATE in_app = :inApp, push = :push, email = :email`,
    {
      userId,
      kind,
      inApp: next.inApp ? 1 : 0,
      push: next.push ? 1 : 0,
      email: next.email ? 1 : 0,
    },
  );

  return next;
}

/**
 * The current quiet window.
 *
 * Read as well as written, because a setting you can change but not see is one
 * nobody can trust: the screen would have to guess what it had been set to, and
 * would guess wrong for everyone who had ever set it.
 */
export async function quietHoursFor(
  userId: number,
): Promise<{ start: number | null; end: number | null }> {
  const row = await queryOne<{ quiet_hours_start: number | null; quiet_hours_end: number | null }>(
    'SELECT quiet_hours_start, quiet_hours_end FROM user_profiles WHERE user_id = :userId',
    { userId },
  );
  return { start: row?.quiet_hours_start ?? null, end: row?.quiet_hours_end ?? null };
}

export async function setQuietHours(
  userId: number,
  start: number | null,
  end: number | null,
): Promise<{ start: number | null; end: number | null }> {
  await execute(
    'UPDATE user_profiles SET quiet_hours_start = :start, quiet_hours_end = :end WHERE user_id = :userId',
    { start, end, userId },
  );
  return { start, end };
}

/**
 * Whether the current hour falls inside the user's quiet hours.
 *
 * Handles a window that crosses midnight, which is the common case — 23:00 to
 * 07:00 is not "start before end".
 */
function isQuiet(hour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null) return false;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface NotifyInput {
  userId: number;
  kind: NotificationKind;
  body: string;
  actorId?: number;
  targetType?: string;
  targetId?: number;
  /** Queue an email as well, if the user allows that kind by email. */
  email?: { template: string; subject: string; payload: Record<string, unknown> };
  /** One notification per logical event; a retry produces nothing new. */
  dedupeKey?: string;
}

export interface NotifyResult {
  inApp: boolean;
  push: boolean;
  email: boolean;
  skipped?: 'self' | 'blocked' | 'preference';
}

/**
 * The single entry point.
 *
 * Never throws: a notification failing must not fail the action that caused it.
 * A caller that liked a video does not want the like rolled back because a push
 * token was stale.
 */
export async function notify(input: NotifyInput, tx?: PoolConnection): Promise<NotifyResult> {
  const none: NotifyResult = { inApp: false, push: false, email: false };

  try {
    // Nobody is told about their own action.
    if (input.actorId !== undefined && input.actorId === input.userId) {
      return { ...none, skipped: 'self' };
    }

    if (input.actorId !== undefined) {
      const blocked = await queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM blocks
          WHERE deleted_at IS NULL
            AND ((blocker_id = :recipient AND blocked_id = :actor)
              OR (blocker_id = :actor AND blocked_id = :recipient))`,
        { recipient: input.userId, actor: input.actorId },
        tx,
      );
      if (Number(blocked?.c ?? 0) > 0) return { ...none, skipped: 'blocked' };
    }

    const prefs = (await preferencesFor(input.userId))[input.kind as PreferenceKind] ??
      DEFAULTS[input.kind as PreferenceKind];

    if (!prefs.inApp && !prefs.push && !prefs.email) {
      return { ...none, skipped: 'preference' };
    }

    const result: NotifyResult = { inApp: false, push: false, email: false };

    if (prefs.inApp) {
      await execute(
        `INSERT INTO notifications (user_id, kind, actor_id, body, target_type, target_id)
         VALUES (:userId, :kind, :actorId, :body, :targetType, :targetId)`,
        {
          userId: input.userId,
          kind: input.kind,
          actorId: input.actorId ?? null,
          body: input.body,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
        },
        tx,
      );
      result.inApp = true;

      // The badge updates immediately for anyone with the app open.
      emitToUser(input.userId, SOCKET_EVENTS.notification, {
        kind: input.kind,
        body: input.body,
      });
    }

    // Quiet hours suppress the interruption, never the record. The in-app row
    // is already written; what is withheld is the thing that lights up a phone.
    const profile = await queryOne<{ quiet_hours_start: number | null; quiet_hours_end: number | null }>(
      'SELECT quiet_hours_start, quiet_hours_end FROM user_profiles WHERE user_id = :userId',
      { userId: input.userId },
      tx,
    );
    const quiet = isQuiet(
      new Date().getUTCHours(),
      profile?.quiet_hours_start ?? null,
      profile?.quiet_hours_end ?? null,
    );

    if (prefs.push && !quiet) {
      result.push = await queuePush(input, tx);
    }

    if (prefs.email && input.email) {
      result.email = await queueEmail(input, tx);
    }

    return result;
  } catch (err) {
    // A failed notification is logged and swallowed. The alternative is a like
    // that fails because a push token was stale.
    logger.error({ err, userId: input.userId, kind: input.kind }, 'could not notify');
    return none;
  }
}

async function queuePush(input: NotifyInput, tx?: PoolConnection): Promise<boolean> {
  const devices = await query<{ push_token: string }>(
    `SELECT push_token FROM user_devices
      WHERE user_id = :userId AND deleted_at IS NULL AND push_token IS NOT NULL
        AND push_token <> ''`,
    { userId: input.userId },
    tx,
  );
  if (devices.length === 0) return false;

  for (const device of devices) {
    await execute(
      `INSERT INTO outbox
         (public_id, channel, destination, user_id, template, subject, payload, dedupe_key)
       VALUES (:publicId, 'push', :destination, :userId, :template, NULL, :payload, :dedupeKey)
       ON DUPLICATE KEY UPDATE id = id`,
      {
        publicId: ulid(),
        destination: device.push_token,
        userId: input.userId,
        template: `push.${input.kind}`,
        payload: JSON.stringify({ body: input.body, kind: input.kind }),
        dedupeKey: input.dedupeKey ? `push:${input.dedupeKey}:${device.push_token}` : null,
      },
      tx,
    );
  }
  return true;
}

async function queueEmail(input: NotifyInput, tx?: PoolConnection): Promise<boolean> {
  if (!input.email) return false;

  const user = await queryOne<{ email: string }>(
    'SELECT email FROM users WHERE id = :userId AND deleted_at IS NULL',
    { userId: input.userId },
    tx,
  );
  if (!user?.email) return false;

  await execute(
    `INSERT INTO outbox
       (public_id, channel, destination, user_id, template, subject, payload, dedupe_key)
     VALUES (:publicId, 'email', :destination, :userId, :template, :subject, :payload, :dedupeKey)
     ON DUPLICATE KEY UPDATE id = id`,
    {
      publicId: ulid(),
      destination: user.email,
      userId: input.userId,
      template: input.email.template,
      subject: input.email.subject,
      payload: JSON.stringify(input.email.payload),
      dedupeKey: input.dedupeKey ? `email:${input.dedupeKey}` : null,
    },
    tx,
  );
  return true;
}

// ── Reading ──

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  body: string;
  targetType?: string;
  targetId?: string;
  /** `id` is present so a row can open the profile it is about. */
  actor?: {
    id: string;
    username: string;
    displayName: string;
    avatar: string | null;
    verificationTier: string;
  };
  read: boolean;
  createdAt: string;
}

export async function list(
  userId: number,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationItem[]> {
  const rows = await query<{
    id: number;
    kind: NotificationKind;
    body: string;
    target_type: string | null;
    target_id: number | null;
    read_at: Date | null;
    created_at: Date;
    actor_public_id: string | null;
    actor_verification_tier: string | null;
    actor_username: string | null;
    actor_display_name: string | null;
    actor_avatar: string | null;
  }>(
    `SELECT n.id, n.kind, n.body, n.target_type, n.target_id, n.read_at, n.created_at,
            u.public_id AS actor_public_id, u.verification_tier AS actor_verification_tier,
            u.username AS actor_username, p.display_name AS actor_display_name,
            p.avatar_url AS actor_avatar
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id AND u.deleted_at IS NULL
       LEFT JOIN user_profiles p ON p.user_id = n.actor_id
      WHERE n.user_id = :userId
        AND n.deleted_at IS NULL
        ${options.unreadOnly ? 'AND n.read_at IS NULL' : ''}
      ORDER BY n.created_at DESC
      LIMIT :limit`,
    { userId, limit: options.limit ?? 50 },
  );

  return rows.map((row) => {
    const item: NotificationItem = {
      id: String(row.id),
      kind: row.kind,
      body: row.body,
      read: row.read_at !== null,
      createdAt: new Date(row.created_at).toISOString(),
    };
    if (row.target_type) item.targetType = row.target_type;
    if (row.target_id !== null) item.targetId = String(row.target_id);
    if (row.actor_username && row.actor_public_id) {
      item.actor = {
        id: row.actor_public_id,
        username: row.actor_username,
        displayName: row.actor_display_name ?? row.actor_username,
        avatar: row.actor_avatar,
        verificationTier: row.actor_verification_tier ?? 'none',
      };
    }
    return item;
  });
}

export async function unreadCount(userId: number): Promise<number> {
  const row = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = :userId AND read_at IS NULL AND deleted_at IS NULL',
    { userId },
  );
  return Number(row?.c ?? 0);
}

export async function markRead(
  userId: number,
  notificationId?: string,
): Promise<{ read: number; unread: number }> {
  const result = await execute(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP(3)
      WHERE user_id = :userId AND read_at IS NULL AND deleted_at IS NULL
        ${notificationId ? 'AND id = :id' : ''}`,
    { userId, ...(notificationId ? { id: Number(notificationId) } : {}) },
  );
  return { read: result.affectedRows, unread: await unreadCount(userId) };
}

/** Registers a device for push. Re-registering updates the token in place. */
export async function registerDevice(
  userId: number,
  input: { deviceId: string; platform: 'ios' | 'android' | 'web'; pushToken: string; appVersion?: string },
): Promise<{ registered: true }> {
  await execute(
    `INSERT INTO user_devices (user_id, device_id, platform, push_token, app_version, last_seen_at)
     VALUES (:userId, :deviceId, :platform, :pushToken, :appVersion, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       push_token = :pushToken,
       app_version = COALESCE(:appVersion, app_version),
       last_seen_at = CURRENT_TIMESTAMP(3),
       deleted_at = NULL`,
    {
      userId,
      deviceId: input.deviceId,
      platform: input.platform,
      pushToken: input.pushToken,
      appVersion: input.appVersion ?? null,
    },
  );
  return { registered: true };
}

/**
 * Stops push to one device.
 *
 * The token is cleared rather than the row deleted, so the device is still
 * recognised on the next sign-in and its history survives.
 */
export async function unregisterDevice(
  userId: number,
  deviceId: string,
): Promise<{ unregistered: true }> {
  await execute(
    "UPDATE user_devices SET push_token = '' WHERE user_id = :userId AND device_id = :deviceId",
    { userId, deviceId },
  );
  return { unregistered: true };
}
