/**
 * Signed URLs for private and follower-only media.
 *
 * Public renditions are served straight from the CDN. Anything restricted needs
 * a URL that proves the bearer was authorised, expires on its own, and cannot be
 * edited into a URL for a different object.
 *
 * The signature covers the key, the expiry and the viewer together. Signing only
 * the key would let someone extend their own expiry; leaving the viewer out
 * would let a valid link be passed to anyone. Because all three are inside the
 * MAC, changing any of them invalidates it.
 *
 * This is an access control, not encryption: it stops a leaked link being useful
 * indefinitely. It is not a substitute for checking permission before issuing one.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';
import { AppError } from './errors.ts';
import { assertSafeKey } from './storage.ts';

/** Long enough to watch a video, short enough that a leaked link goes stale. */
export const DEFAULT_TTL_SECONDS = 6 * 60 * 60;

export interface SignedUrlParams {
  key: string;
  /** Unix seconds. */
  expires: number;
  /** The viewer the link was issued to, or 'public' for unrestricted media. */
  viewer: string;
  signature: string;
}

function sign(key: string, expires: number, viewer: string): string {
  return createHmac('sha256', config.JWT_ACCESS_SECRET)
    .update(`${key}\n${expires}\n${viewer}`)
    .digest('base64url');
}

/**
 * Signs a media key for one viewer.
 *
 * `viewerId` should be the viewer's public id. Passing 'public' produces a link
 * anyone may use, which is only appropriate for media that is already public.
 */
export function signMediaUrl(
  key: string,
  viewerId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  assertSafeKey(key);
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = sign(key, expires, viewerId);
  const base = config.STORAGE_PUBLIC_URL.replace(/\/$/, '');
  const params = new URLSearchParams({
    expires: String(expires),
    viewer: viewerId,
    sig: signature,
  });
  return `${base}/${key}?${params.toString()}`;
}

/**
 * Verifies a signed request.
 *
 * Throws rather than returning false, so a caller cannot forget to check the
 * result. Expiry is checked before the signature is compared, since an expired
 * link is the common case and needs no constant-time handling.
 */
export function verifyMediaUrl(params: {
  key: string;
  expires: string | number;
  viewer: string;
  signature: string;
}): void {
  const expires = Number(params.expires);
  if (!Number.isFinite(expires)) {
    throw new AppError('forbidden', 'This media link is not valid.');
  }
  if (expires < Math.floor(Date.now() / 1000)) {
    throw new AppError('forbidden', 'This media link has expired.');
  }

  const expected = sign(params.key, expires, params.viewer);
  const a = Buffer.from(params.signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('forbidden', 'This media link is not valid.');
  }
}

/**
 * The URL a given viewer should be given for a video's media.
 *
 * Public videos get a plain CDN URL so they stay cacheable — signing public
 * media would defeat edge caching for no benefit. Restricted videos get a signed
 * URL bound to that viewer.
 */
export function mediaUrlFor(
  key: string,
  privacy: 'public' | 'followers' | 'friends' | 'private',
  viewerId: string | undefined,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  assertSafeKey(key);
  if (privacy === 'public') {
    return `${config.STORAGE_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  }
  if (!viewerId) {
    throw new AppError('forbidden', 'This video is not public.');
  }
  return signMediaUrl(key, viewerId, ttlSeconds);
}
