/**
 * Likes, saves and comments.
 *
 * Every call returns the count the server just produced. The app renders that
 * rather than incrementing its own copy — two devices, or a screen left open
 * for an hour, then cannot disagree about how many likes a video has.
 */

import { api } from './client';

export interface LikeResult {
  liked: boolean;
  likeCount: number;
}

export interface SaveResult {
  saved: boolean;
  saveCount: number;
}

export interface CommentAuthor {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  verificationTier: string;
}

export interface Comment {
  id: string;
  body: string;
  likeCount: number;
  replyCount: number;
  isPinned: boolean;
  liked: boolean;
  /** True when this comment is by the video's author. */
  isAuthor: boolean;
  canDelete: boolean;
  author: CommentAuthor;
  createdAt: string;
}

export const engagement = {
  like: (videoId: string) =>
    api.post<LikeResult>(`/videos/${videoId}/like`).then((r) => r.data),
  unlike: (videoId: string) =>
    api.delete<LikeResult>(`/videos/${videoId}/like`).then((r) => r.data),

  save: (videoId: string) =>
    api.post<SaveResult>(`/videos/${videoId}/save`).then((r) => r.data),
  unsave: (videoId: string) =>
    api.delete<SaveResult>(`/videos/${videoId}/save`).then((r) => r.data),

  savedVideos: () => api.get<unknown[]>('/me/saved').then((r) => r.data),

  /** One request for a whole page of the feed, rather than one per card. */
  stateFor: (videoIds: string[]) =>
    api
      .post<{ liked: string[]; saved: string[] }>('/videos/engagement-state', { videoIds })
      .then((r) => r.data),

  comments: (videoId: string, limit = 30) =>
    api
      .get<{ items: Comment[]; total: number }>(`/videos/${videoId}/comments?limit=${limit}`)
      .then((r) => r.data),

  addComment: (videoId: string, body: string, parentId?: string) =>
    api
      .post<Comment>(`/videos/${videoId}/comments`, { body, ...(parentId ? { parentId } : {}) })
      .then((r) => r.data),

  replies: (commentId: string) =>
    api.get<Comment[]>(`/comments/${commentId}/replies`).then((r) => r.data),

  deleteComment: (commentId: string) =>
    api.delete<{ deleted: true }>(`/comments/${commentId}`).then((r) => r.data),

  likeComment: (commentId: string) =>
    api.post<{ liked: boolean; likeCount: number }>(`/comments/${commentId}/like`).then((r) => r.data),

  unlikeComment: (commentId: string) =>
    api.delete<{ liked: boolean; likeCount: number }>(`/comments/${commentId}/like`).then((r) => r.data),
};
