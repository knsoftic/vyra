/**
 * Notifications: the inbox, the preferences behind it, and this device.
 *
 * Preferences are read and written per channel, not per category. A single
 * "Likes" switch would have to decide what it meant — stop the push, stop the
 * email, or stop the record itself — and whichever it picked would be wrong for
 * someone. Three answers are three switches.
 */

import { api } from './client';

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

/** Everything a person can be reached about. `marketing` has no in-app row. */
export type PreferenceKind = NotificationKind | 'marketing';

export interface ChannelPreferences {
  inApp: boolean;
  push: boolean;
  email: boolean;
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  body: string;
  targetType?: string;
  targetId?: string;
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

export interface QuietHours {
  /** Hour of day, 0–23. Null means no quiet window is set. */
  start: number | null;
  end: number | null;
}

export interface NotificationPreferences {
  preferences: Record<PreferenceKind, ChannelPreferences>;
  quietHours: QuietHours;
}

export const notifications = {
  list: (options: { unreadOnly?: boolean; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.unreadOnly) params.set('unreadOnly', 'true');
    if (options.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    return api.get<NotificationItem[]>(`/me/notifications${query ? `?${query}` : ''}`).then((r) => r.data);
  },

  unreadCount: () => api.get<{ unread: number }>('/me/notifications/count').then((r) => r.data),

  /** Unread chats and notifications together, for the tab bar badge. */
  unreadBadge: () =>
    api
      .get<{ chats: number; notifications: number; total: number }>('/me/unread')
      .then((r) => r.data),

  markAllRead: () =>
    api.post<{ read: number; unread: number }>('/me/notifications/read').then((r) => r.data),

  markRead: (id: string) =>
    api.post<{ read: number; unread: number }>(`/me/notifications/${id}/read`).then((r) => r.data),

  preferences: () =>
    api.get<NotificationPreferences>('/me/notification-preferences').then((r) => r.data),

  /**
   * Changes one channel of one category.
   *
   * Only the channels named are touched, so two switches flipped in quick
   * succession cannot overwrite each other's field.
   */
  setPreference: (kind: PreferenceKind, channels: Partial<ChannelPreferences>) =>
    api
      .patch<ChannelPreferences>('/me/notification-preferences', { kind, ...channels })
      .then((r) => r.data),

  setQuietHours: (start: number | null, end: number | null) =>
    api.patch<QuietHours>('/me/quiet-hours', { start, end }).then((r) => r.data),

  registerDevice: (device: {
    deviceId: string;
    platform: 'ios' | 'android' | 'web';
    pushToken: string;
    appVersion?: string;
  }) => api.post<{ registered: boolean }>('/me/devices', device).then((r) => r.data),

  unregisterDevice: (deviceId: string) =>
    api.delete<{ unregistered: boolean }>(`/me/devices/${deviceId}`).then((r) => r.data),
};
