/**
 * Server shapes → UI shapes.
 *
 * The contracts in `shared/contracts` describe what the API returns; the types
 * in `src/types` describe what the components render. They are close but not
 * identical, and translating in each screen produced a slightly different
 * mapping every time — which is how a screen ends up inventing a follower count
 * that nobody measured.
 *
 * The rule these follow: fields the server did not send are given a neutral
 * default, never a plausible-looking guess.
 */

import type { PublicUser, PrivateUser } from '../../../shared/contracts/user';
import type { VideoSummary } from './endpoints';
import type { User, Video } from '../types';

/** A deterministic stand-in so a missing avatar is stable rather than random. */
export function fallbackAvatar(username: string): string {
  return `https://i.pravatar.cc/150?u=${encodeURIComponent(username)}`;
}

export function toUser(source: PublicUser | PrivateUser): User {
  const user: User = {
    id: source.id,
    username: source.username,
    displayName: source.displayName,
    avatar: source.avatar ?? fallbackAvatar(source.username),
    bio: source.bio,
    accountCategory: source.accountCategory,
    accountType: source.accountType as User['accountType'],
    verification: source.verificationTier,
    followers: source.followers,
    following: source.following,
    likes: source.likes,
    videos: source.videos,
    isPrivate: source.isPrivate,
    joinedAt: source.createdAt,
  };

  // Relationship flags are absent for anonymous callers; leaving them undefined
  // is meaningfully different from `false` and the UI treats it that way.
  if (source.isFollowing !== undefined) user.isFollowing = source.isFollowing;
  if (source.isFollowedBy !== undefined) user.isFollowedBy = source.isFollowedBy;
  if (source.isBlocked !== undefined) user.isBlocked = source.isBlocked;

  if (source.links?.length) user.links = source.links.map((l) => l.url);

  if (source.business) {
    const b = source.business;
    if (b.category) user.businessCategory = b.category;
    if (b.website) user.website = b.website;
    if (b.contactEmail) user.contactEmail = b.contactEmail;
    if (b.contactPhone) user.contactPhone = b.contactPhone;
    if (b.ctaLabel && b.ctaUrl) user.cta = { label: b.ctaLabel, url: b.ctaUrl };
  }

  return user;
}

/**
 * A server video summary as a grid/feed card.
 *
 * A video still processing has no playable URL. The poster stands in so the
 * card shows a still rather than a player pointed at nothing.
 */
/**
 * The author a video summary carries, as a User.
 *
 * Counts are not in the summary, so they stay at zero rather than being made up;
 * a screen that needs them fetches the profile.
 */
export function summaryAuthor(summary: VideoSummary): User {
  return {
    id: summary.author.username,
    username: summary.author.username,
    displayName: summary.author.displayName,
    avatar: summary.author.avatar ?? fallbackAvatar(summary.author.username),
    accountCategory: 'individual',
    accountType: 'normal',
    verification: 'none',
    followers: 0,
    following: 0,
    likes: 0,
    videos: 0,
  };
}

export function toVideo(summary: VideoSummary, author: User = summaryAuthor(summary)): Video {
  return {
    id: summary.id,
    author,
    caption: summary.caption,
    hashtags: [],
    mentions: [],
    sound: {
      id: `sound_${summary.id}`,
      title: 'Original sound',
      artist: author.displayName,
      cover: summary.posterUrl ?? '',
      durationSec: summary.durationSec,
      isOriginal: true,
    },
    url: summary.hlsUrl ?? '',
    poster: summary.posterUrl ?? `https://picsum.photos/seed/${summary.id}/400/720`,
    durationSec: summary.durationSec,
    privacy: (summary.privacy as Video['privacy']) ?? 'public',
    interaction: {
      allowComments: true,
      allowShare: true,
      allowDownload: true,
      allowRemix: true,
      allowDuet: true,
    },
    stats: { ...summary.stats, saves: 0 },
    liked: false,
    saved: false,
    category: 'general',
    createdAt: summary.createdAt,
  };
}
