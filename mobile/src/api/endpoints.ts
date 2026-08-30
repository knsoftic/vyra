/**
 * Typed endpoint wrappers.
 *
 * Thin on purpose: each function names a route, its body and its return type,
 * and does nothing else. Anything cleverer belongs either in the client (retry,
 * refresh, envelopes) or in a screen (what to do with the result).
 *
 * The types come from `shared/contracts`, so a backend change that alters a
 * response shape breaks the build here rather than at runtime on a device.
 */

import { api, setTokens } from './client';
import type {
  AuthSession,
  PrivateUser,
  PublicUser,
  SessionInfo,
  UsernameAvailability,
  PrivacySettings,
} from '../../../shared/contracts/user';
import type { CreativeCatalogue, VideoDraft } from '../../../shared/contracts/creative';
import type { UserInterests, SegmentMembership } from '../../../shared/contracts/behaviour';

// ── Auth ──

export interface DeviceInfo {
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  appVersion?: string;
}

export const auth = {
  async register(input: {
    email: string;
    password: string;
    username: string;
    displayName?: string;
    birthdate: string;
    device: DeviceInfo;
  }): Promise<AuthSession> {
    const { data } = await api.post<AuthSession>('/auth/register', input, { anonymous: true });
    setTokens(data.tokens);
    return data;
  },

  async login(input: { email: string; password: string; device: DeviceInfo }): Promise<AuthSession> {
    const { data } = await api.post<AuthSession>('/auth/login', input, { anonymous: true });
    setTokens(data.tokens);
    return data;
  },

  async logout(): Promise<void> {
    // The local session is cleared regardless: if the server call fails the user
    // still expects to be signed out on this device.
    try {
      await api.post('/auth/logout');
    } finally {
      setTokens(null);
    }
  },

  requestOtp: (email: string, purpose: 'signup' | 'login' | 'reset' | 'email_change') =>
    api.post<{ sent: boolean; expiresInMinutes: number; devCode?: string }>(
      '/auth/otp/request',
      { email, purpose },
      { anonymous: true },
    ).then((r) => r.data),

  verifyOtp: (email: string, code: string, purpose: 'signup' | 'login' | 'reset' | 'email_change') =>
    api.post<{ verified: true }>('/auth/otp/verify', { email, code, purpose }, { anonymous: true })
      .then((r) => r.data),

  resetPassword: (email: string, code: string, newPassword: string) =>
    api.post<{ reset: true }>('/auth/password/reset', { email, code, newPassword }, { anonymous: true })
      .then((r) => r.data),

  sessions: () => api.get<SessionInfo[]>('/auth/sessions').then((r) => r.data),
};

// ── Me ──

export const me = {
  profile: () => api.get<PrivateUser>('/me').then((r) => r.data),

  update: (patch: {
    displayName?: string;
    bio?: string;
    language?: string;
    links?: { label: string; url: string }[];
  }) => api.patch<PrivateUser>('/me', patch).then((r) => r.data),

  interests: () =>
    api.get<UserInterests & { top: { topic: string; weight: number }[] }>('/me/interests')
      .then((r) => r.data),

  segments: () => api.get<SegmentMembership[]>('/me/segments').then((r) => r.data),

  rebuildInterests: () => api.post<unknown>('/me/interests/rebuild', {}).then((r) => r.data),
};

// ── Users ──

export const users = {
  /** Takes a username or a public id — the server tells them apart by shape. */
  byHandle: (handle: string) =>
    api.get<PublicUser>(`/users/${encodeURIComponent(handle)}`).then((r) => r.data),

  byUsername: (username: string) =>
    api.get<PublicUser>(`/users/${encodeURIComponent(username)}`).then((r) => r.data),

  checkUsername: (username: string) =>
    api.get<UsernameAvailability>(`/users/check-username?username=${encodeURIComponent(username)}`)
      .then((r) => r.data),

  follow: (userId: string) =>
    api.post<{ following: boolean; followerCount: number }>(`/users/${userId}/follow`)
      .then((r) => r.data),

  unfollow: (userId: string) =>
    api.delete<{ following: boolean; followerCount: number }>(`/users/${userId}/follow`)
      .then((r) => r.data),
};

// ── Feed ──

export interface FeedVideo {
  id: string;
  caption: string;
  durationSec: number;
  hlsUrl: string | null;
  posterUrl: string | null;
  author: { username: string; displayName: string; avatar: string | null };
  stats: { views: number; likes: number; comments: number; shares: number };
  reason: string;
  impressionId: string;
  isNewCreator: boolean;
  /**
   * True when this slot was paid for. The client must label it — an unmarked
   * advertisement is the one thing the delivery design refuses to produce.
   */
  isPromoted?: boolean;
  campaignId?: string;
  ctaLabel?: string;
  destinationUrl?: string;
}

export const feed = {
  forYou: (limit = 10) =>
    api.get<{ items: FeedVideo[]; sessionId: string; ranker: 'ml' | 'rules' }>(
      `/feed?limit=${limit}`,
    ).then((r) => r.data),
};

// ── Behaviour events ──

export interface EventInput {
  event: string;
  dedupeKey: string;
  occurredAt: string;
  videoId?: string;
  creatorId?: string;
  sessionId?: string;
  feedSource?: string;
  watchMs?: number;
  videoMs?: number;
}

export const events = {
  send: (batch: EventInput[]) =>
    api.post<{ accepted: number; duplicates: number }>('/events', { events: batch })
      .then((r) => r.data),
};

// ── Creative ──

export const creative = {
  catalogue: () => api.get<CreativeCatalogue>('/creative/catalogue').then((r) => r.data),
  limits: () =>
    api.get<{ maxSizeBytes: number; maxDurationSec: number; chunkSize: number }>('/creative/limits')
      .then((r) => r.data),
  drafts: () => api.get<VideoDraft[]>('/drafts').then((r) => r.data),
  deleteDraft: (id: string) => api.delete<{ deleted: true }>(`/drafts/${id}`).then((r) => r.data),
};

// ── Videos and taxonomy ──

export interface VideoSummary {
  id: string;
  caption: string;
  durationSec: number;
  privacy: string;
  status: string;
  ready: boolean;
  hlsUrl: string | null;
  posterUrl: string | null;
  stats: { views: number; likes: number; comments: number; shares: number };
  author: { username: string; displayName: string; avatar: string | null };
  createdAt: string;
}

export interface CategorySummary {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  videoCount: number;
}

export const videos = {
  mine: (limit = 30) => api.get<VideoSummary[]>(`/me/videos?limit=${limit}`).then((r) => r.data),

  byUser: (username: string, limit = 30) =>
    api.get<VideoSummary[]>(`/users/${encodeURIComponent(username)}/videos?limit=${limit}`)
      .then((r) => r.data),
};

export interface HashtagSummary {
  tag: string;
  videoCount: number;
  viewCount: number;
}

export interface SearchResults {
  query: string;
  users: {
    id: string;
    username: string;
    displayName: string;
    avatar: string | null;
    followers: number;
    verificationTier: string;
    isFollowing: boolean;
    /** The caller's own account, which cannot be followed. */
    isSelf: boolean;
  }[];
  videos: VideoSummary[];
  hashtags: HashtagSummary[];
}

export const discover = {
  categories: () => api.get<CategorySummary[]>('/discover/categories').then((r) => r.data),

  hashtags: () => api.get<HashtagSummary[]>('/discover/hashtags').then((r) => r.data),

  categoryVideos: (slug: string, sort: 'popular' | 'recent' = 'popular', limit = 30) =>
    api.get<VideoSummary[]>(
      `/discover/categories/${encodeURIComponent(slug)}/videos?sort=${sort}&limit=${limit}`,
    ).then((r) => r.data),

  hashtagVideos: (tag: string, sort: 'popular' | 'recent' = 'popular', limit = 30) =>
    api.get<VideoSummary[]>(
      `/discover/hashtags/${encodeURIComponent(tag.replace(/^#/, ''))}/videos?sort=${sort}&limit=${limit}`,
    ).then((r) => r.data),

  trending: (limit = 12) =>
    api.get<VideoSummary[]>(`/discover/trending?limit=${limit}`).then((r) => r.data),

  creators: (limit = 10) =>
    api.get<{
      id: string;
      username: string;
      displayName: string;
      bio: string;
      avatar: string | null;
      followers: number;
      videos: number;
      verificationTier: string;
      isFollowing: boolean;
    }[]>(`/discover/creators?limit=${limit}`).then((r) => r.data),

  search: (q: string, type: 'all' | 'users' | 'videos' | 'hashtags' = 'all', limit = 20) =>
    api.get<SearchResults>(
      `/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`,
    ).then((r) => r.data),
};

// ── Social graph ──

export const graph = {
  followers: (userId: string, limit = 30) =>
    api.get<PublicUser[]>(`/users/${userId}/followers?limit=${limit}`).then((r) => r.data),

  following: (userId: string, limit = 30) =>
    api.get<PublicUser[]>(`/users/${userId}/following?limit=${limit}`).then((r) => r.data),

  blocked: () =>
    api.get<{ id: string; username: string; displayName: string; avatar?: string; blockedAt: string }[]>(
      '/me/blocked',
    ).then((r) => r.data),

  unblock: (userId: string) =>
    api.delete<{ blocked: false }>(`/users/${userId}/block`).then((r) => r.data),

  block: (userId: string) =>
    api.post<{ blocked: true }>(`/users/${userId}/block`).then((r) => r.data),
};

// ── Account and security ──

export type { PrivacySettings };

export interface MyReport {
  id: string;
  targetType: 'user' | 'video' | 'comment' | 'live' | 'community' | 'group' | 'message';
  reason: string;
  detail?: string;
  status: 'submitted' | 'reviewing' | 'action_taken' | 'no_action';
  createdAt: string;
  decidedAt?: string;
}

export const account = {
  reports: () => api.get<MyReport[]>('/me/reports').then((r) => r.data),

  submitReport: (input: {
    targetType: MyReport['targetType'];
    targetId: string;
    reason: string;
    detail?: string;
  }) => api.post<{ id: string }>('/reports', input).then((r) => r.data),

  privacy: (patch: Partial<PrivacySettings>) =>
    api.patch<PrivacySettings>('/me/privacy', patch).then((r) => r.data),

  switchType: (category: 'individual' | 'business', type: string) =>
    api.post<PrivateUser>('/me/account-type', { category, type }).then((r) => r.data),

  securityEvents: () =>
    api.get<{ id: string; event: string; outcome: string; detail?: string; device?: string; createdAt: string }[]>(
      '/me/security-events',
    ).then((r) => r.data),

  revokeSession: (sessionId: string) =>
    api.delete<{ revoked: true }>(`/auth/sessions/${sessionId}`).then((r) => r.data),

  logoutAll: () => api.post<{ revoked: number }>('/auth/logout-all').then((r) => r.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ changed: true }>('/auth/password/change', { currentPassword, newPassword })
      .then((r) => r.data),
};

// ── Music ──

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  category: string;
  coverUrl?: string;
  audioUrl: string;
  durationSec: number;
  isTrending: boolean;
  isFavourite?: boolean;
  usageCount: number;
}

export const music = {
  list: (options: { q?: string; category?: string; trending?: boolean; favourites?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (options.q) params.set('q', options.q);
    if (options.category) params.set('category', options.category);
    if (options.trending) params.set('trending', 'true');
    if (options.favourites) params.set('favourites', 'true');
    const qs = params.toString();
    return api.get<MusicTrack[]>(`/music${qs ? `?${qs}` : ''}`).then((r) => r.data);
  },

  categories: () =>
    api.get<{ name: string; trackCount: number }[]>('/music/categories').then((r) => r.data),

  favourite: (trackId: string) =>
    api.post<{ favourite: boolean }>(`/music/${trackId}/favourite`).then((r) => r.data),

  unfavourite: (trackId: string) =>
    api.delete<{ favourite: boolean }>(`/music/${trackId}/favourite`).then((r) => r.data),
};

