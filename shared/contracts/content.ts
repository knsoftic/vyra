/** Video, sound, comment and taxonomy contract. */

import type { Page } from './http.ts';
import type { PublicUser } from './user.ts';

export type VideoPrivacy = 'public' | 'friends' | 'private';
export type VideoStatus = 'processing' | 'ready' | 'failed' | 'removed';

export interface Sound {
  id: string;
  title: string;
  artist: string;
  cover?: string;
  url?: string;
  durationSec: number;
  isOriginal: boolean;
  videoCount: number;
}

export interface VideoStats {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

export interface Video {
  id: string;
  author: PublicUser;
  caption: string;
  /** HLS manifest. The client never receives a raw MP4 for playback. */
  playbackUrl: string;
  posterUrl: string;
  durationSec: number;
  width: number;
  height: number;
  privacy: VideoPrivacy;
  status: VideoStatus;
  sound?: Sound;
  hashtags: string[];
  mentions: string[];
  stats: VideoStats;
  /** Relative to the caller. */
  liked?: boolean;
  saved?: boolean;
  following?: boolean;
  allowComments: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  allowDownload: boolean;
  isPromoted: boolean;
  createdAt: string;
}

export interface Comment {
  id: string;
  videoId: string;
  author: PublicUser;
  body: string;
  likes: number;
  replies: number;
  liked?: boolean;
  /** Set when this comment answers another. Threads are one level deep. */
  parentId?: string;
  pinned: boolean;
  createdAt: string;
}

export interface CreateCommentBody {
  body: string;
  parentId?: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  icon?: string;
  videoCount: number;
}

export interface Hashtag {
  id: string;
  tag: string;
  videoCount: number;
  viewCount: number;
  isTrending: boolean;
}

/** Upload is a three-step handshake: init → client uploads to storage → finalise. */
export interface UploadInitBody {
  filename: string;
  sizeBytes: number;
  contentType: string;
  durationSec: number;
}

export interface UploadInitResult {
  uploadId: string;
  /** Pre-signed. Expires quickly; the client uploads directly to storage. */
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

export interface PublishVideoBody {
  uploadId: string;
  caption: string;
  privacy: VideoPrivacy;
  categoryId?: string;
  soundId?: string;
  hashtags?: string[];
  mentions?: string[];
  allowComments?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  allowDownload?: boolean;
  coverTimeMs?: number;
}

export type VideoPage = Page<Video>;
export type CommentPage = Page<Comment>;
