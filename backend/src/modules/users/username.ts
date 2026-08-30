/**
 * Username rules.
 *
 * Usernames appear in URLs and in @mentions, so they carry impersonation risk.
 * Three defences:
 *   - a reserved list, so nobody registers @admin, @support or @help;
 *   - confusable normalisation, so @paypa1 cannot masquerade as @paypal by
 *     swapping visually similar characters;
 *   - permanent retirement, so a released username cannot be claimed by someone
 *     inheriting the previous owner's mentions and links.
 */

import { queryOne } from '../../core/db.ts';
import type { UsernameAvailability } from '../../../../shared/contracts/user.ts';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_PATTERN = /^[a-z0-9._]+$/;

/**
 * Names that must never belong to an ordinary account: platform routes, roles
 * that imply authority, and support surfaces an attacker would impersonate.
 */
export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'helpdesk',
  'moderator', 'mod', 'staff', 'team', 'official', 'verified', 'security',
  'billing', 'payments', 'payment', 'wallet', 'coins', 'refund', 'refunds',
  'vyra', 'vyraapp', 'vyraofficial', 'vyrasupport', 'vyrateam',
  'api', 'www', 'mail', 'email', 'ftp', 'cdn', 'static', 'assets', 'media',
  'login', 'logout', 'signin', 'signup', 'register', 'auth', 'oauth',
  'settings', 'account', 'accounts', 'profile', 'me', 'user', 'users',
  'about', 'terms', 'privacy', 'legal', 'contact', 'careers', 'press',
  'explore', 'discover', 'feed', 'trending', 'live', 'shop', 'store',
  'null', 'undefined', 'true', 'false', 'anonymous', 'guest', 'everyone', 'all',
]);

/**
 * Collapses characters that read alike, so two usernames that look the same to a
 * human resolve to one key. Used for the reserved check only — the stored
 * username keeps its original spelling.
 */
export function skeleton(username: string): string {
  return username
    .toLowerCase()
    .replace(/[._]/g, '')
    .replace(/0/g, 'o')
    .replace(/[1l]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a');
}

const RESERVED_SKELETONS = new Set([...RESERVED_USERNAMES].map(skeleton));

export function validateFormat(username: string): 'invalid' | 'reserved' | null {
  const lower = username.toLowerCase();
  if (lower.length < USERNAME_MIN || lower.length > USERNAME_MAX) return 'invalid';
  if (!USERNAME_PATTERN.test(lower)) return 'invalid';
  // Leading/trailing punctuation and doubled separators read as typosquatting.
  if (/^[._]|[._]$|[._]{2}/.test(lower)) return 'invalid';
  if (RESERVED_USERNAMES.has(lower) || RESERVED_SKELETONS.has(skeleton(lower))) return 'reserved';
  return null;
}

/** Full availability check, including names retired by a previous owner. */
export async function checkUsername(
  username: string,
  forUserId?: number,
): Promise<UsernameAvailability> {
  const lower = username.toLowerCase();

  const formatIssue = validateFormat(lower);
  if (formatIssue) return { username: lower, available: false, reason: formatIssue };

  const taken = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE username = :username',
    { username: lower },
  );
  if (taken && taken.id !== forUserId) {
    return { username: lower, available: false, reason: 'taken' };
  }

  const retired = await queryOne<{ id: number; user_id: number }>(
    'SELECT id, user_id FROM username_history WHERE username = :username LIMIT 1',
    { username: lower },
  );
  // The original owner may reclaim their own former username; nobody else may.
  if (retired && retired.user_id !== forUserId) {
    return { username: lower, available: false, reason: 'previously_used' };
  }

  return { username: lower, available: true };
}
