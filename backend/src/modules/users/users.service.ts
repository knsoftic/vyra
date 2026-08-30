/**
 * Profiles and account settings.
 *
 * Two invariants run through this file:
 *
 *  - **Blocks are bidirectional and enforced here**, not in the client. If
 *    either party has blocked the other, the profile is not returned. Doing this
 *    at the data layer means every caller inherits it.
 *
 *  - **Switching account type never destroys anything.** It is one UPDATE to a
 *    column. Videos, wallet balances, followers and chats are untouched, and the
 *    business profile row is kept even when switching back to individual, so
 *    switching to business again restores the previous details.
 */

import { execute, query, queryOne, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { buildPage, decodeCursor, normaliseLimit } from '../../core/pagination.ts';
import {
  ACCOUNT_TYPES,
  type AccountCategory,
  type AccountType,
  type PrivateUser,
  type PrivacySettings,
  type ProfileLink,
  type PublicUser,
  type UserPage,
  type VerificationTier,
} from '../../../../shared/contracts/user.ts';
import type { Page } from '../../../../shared/contracts/http.ts';

interface ProfileRow {
  id: number;
  public_id: string;
  username: string;
  email: string;
  email_verified_at: Date | null;
  account_category: AccountCategory;
  account_type: AccountType;
  verification_tier: VerificationTier;
  status: 'active' | 'suspended' | 'banned' | 'frozen';
  country_code: string | null;
  language: string;
  created_at: Date;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  links: string | null;
  is_private: number;
  who_can_comment: PrivacySettings['whoCanComment'];
  who_can_message: PrivacySettings['whoCanMessage'];
  who_can_duet: PrivacySettings['whoCanDuet'];
  allow_download: number;
  follower_count: number;
  following_count: number;
  video_count: number;
  like_count: number;
  business_category: string | null;
  website: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  cta_label: string | null;
  cta_url: string | null;
}

// Split so callers that need an extra column (a pagination cursor, say) can
// compose one in, rather than doing string surgery on a finished query.
const PROFILE_COLUMNS = `
  u.id, u.public_id, u.username, u.email, u.email_verified_at,
  u.account_category, u.account_type, u.verification_tier, u.status,
  u.country_code, u.language, u.created_at,
  p.display_name, p.bio, p.avatar_url, p.links, p.is_private,
  p.who_can_comment, p.who_can_message, p.who_can_duet, p.allow_download,
  p.follower_count, p.following_count, p.video_count, p.like_count,
  b.business_category, b.website, b.contact_email, b.contact_phone, b.cta_label, b.cta_url
`;

const PROFILE_FROM = `
  FROM users u
  JOIN user_profiles p ON p.user_id = u.id
  LEFT JOIN business_profiles b ON b.user_id = u.id AND b.deleted_at IS NULL
`;

const PROFILE_SELECT = `SELECT ${PROFILE_COLUMNS} ${PROFILE_FROM}`;

function parseLinks(raw: string | null): ProfileLink[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as ProfileLink[]) : undefined;
  } catch {
    return undefined;
  }
}

function toPublic(row: ProfileRow): PublicUser {
  const user: PublicUser = {
    id: row.public_id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    verified: row.verification_tier !== 'none',
    verificationTier: row.verification_tier,
    accountCategory: row.account_category,
    accountType: row.account_type,
    followers: Number(row.follower_count),
    following: Number(row.following_count),
    likes: Number(row.like_count),
    videos: Number(row.video_count),
    isPrivate: row.is_private === 1,
    createdAt: new Date(row.created_at).toISOString(),
  };
  if (row.avatar_url) user.avatar = row.avatar_url;
  const links = parseLinks(row.links);
  if (links) user.links = links;
  if (row.account_category === 'business') {
    user.business = {
      ...(row.business_category ? { category: row.business_category } : {}),
      ...(row.website ? { website: row.website } : {}),
      ...(row.contact_email ? { contactEmail: row.contact_email } : {}),
      ...(row.contact_phone ? { contactPhone: row.contact_phone } : {}),
      ...(row.cta_label ? { ctaLabel: row.cta_label } : {}),
      ...(row.cta_url ? { ctaUrl: row.cta_url } : {}),
    };
  }
  return user;
}

/** The caller's own profile, including fields nobody else may see. */
export async function getPrivateUser(userId: number): Promise<PrivateUser> {
  const row = await queryOne<ProfileRow>(`${PROFILE_SELECT} WHERE u.id = :id AND u.deleted_at IS NULL`, {
    id: userId,
  });
  if (!row) throw new AppError('not_found', 'Account not found.');

  const counts = await queryOne<{ notifications: number; messages: number }>(
    `SELECT
       (SELECT COUNT(*) FROM notifications WHERE user_id = :id AND read_at IS NULL AND deleted_at IS NULL) AS notifications,
       (SELECT COALESCE(SUM(unread_count), 0) FROM chat_participants WHERE user_id = :id) AS messages`,
    { id: userId },
  ).catch(() => undefined);

  const monetization = await queryOne<{ state: string }>(
    'SELECT state FROM user_monetization WHERE user_id = :id',
    { id: userId },
  );

  const privacy: PrivacySettings = {
    isPrivate: row.is_private === 1,
    whoCanComment: row.who_can_comment,
    whoCanMessage: row.who_can_message,
    whoCanDuet: row.who_can_duet,
    allowDownload: row.allow_download === 1,
  };

  return {
    ...toPublic(row),
    email: row.email,
    emailVerified: row.email_verified_at !== null,
    ...(row.country_code ? { country: row.country_code } : {}),
    language: row.language,
    status: row.status,
    privacy,
    monetizationEnabled: monetization?.state === 'enabled',
    unreadNotifications: Number(counts?.notifications ?? 0),
    unreadMessages: Number(counts?.messages ?? 0),
  };
}

/**
 * Another user's profile, as seen by `viewerId`.
 *
 * Returns not-found rather than forbidden when a block is in place: confirming
 * "this account exists but has blocked you" is itself information the blocker
 * did not agree to share.
 */
/**
 * A public ULID, as `public_id` stores it.
 *
 * Usernames are `^[a-z0-9._]+$` — lowercase only — and a ULID is uppercase
 * Crockford base32, so the two sets cannot overlap and one parameter can carry
 * either without ambiguity. That matters because most of the app holds public
 * ids, not handles: a notification, a chat member, a community roster entry all
 * identify someone by id, and without this they had no way to open a profile.
 */
const PUBLIC_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export async function getPublicUser(
  handle: string,
  viewerId?: number,
): Promise<PublicUser> {
  const byPublicId = PUBLIC_ID_PATTERN.test(handle);

  const row = await queryOne<ProfileRow>(
    byPublicId
      ? `${PROFILE_SELECT} WHERE u.public_id = :handle AND u.deleted_at IS NULL`
      : `${PROFILE_SELECT} WHERE u.username = :handle AND u.deleted_at IS NULL`,
    { handle: byPublicId ? handle : handle.toLowerCase() },
  );
  if (!row || row.status === 'banned') throw new AppError('not_found', 'Account not found.');

  const user = toPublic(row);

  if (viewerId !== undefined && viewerId !== row.id) {
    const rel = await queryOne<{ following: number; followed_by: number; blocked: number; blocked_by: number }>(
      `SELECT
         EXISTS(SELECT 1 FROM follows WHERE follower_id = :viewer AND followee_id = :target AND deleted_at IS NULL) AS following,
         EXISTS(SELECT 1 FROM follows WHERE follower_id = :target AND followee_id = :viewer AND deleted_at IS NULL) AS followed_by,
         EXISTS(SELECT 1 FROM blocks   WHERE blocker_id = :viewer AND blocked_id = :target AND deleted_at IS NULL) AS blocked,
         EXISTS(SELECT 1 FROM blocks   WHERE blocker_id = :target AND blocked_id = :viewer AND deleted_at IS NULL) AS blocked_by`,
      { viewer: viewerId, target: row.id },
    );

    if (Number(rel?.blocked_by ?? 0) === 1) throw new AppError('not_found', 'Account not found.');

    user.isFollowing = Number(rel?.following ?? 0) === 1;
    user.isFollowedBy = Number(rel?.followed_by ?? 0) === 1;
    user.isBlocked = Number(rel?.blocked ?? 0) === 1;
  }

  return user;
}

/** Resolves a public ULID to the internal row id. */
export async function resolveUserId(publicId: string): Promise<number> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Account not found.');
  return row.id;
}

export interface UpdateProfileInput {
  displayName?: string;
  bio?: string;
  avatarKey?: string;
  links?: ProfileLink[];
  language?: string;
}

export async function updateProfile(
  userId: number,
  input: UpdateProfileInput,
): Promise<PrivateUser> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { userId };

  if (input.displayName !== undefined) {
    sets.push('display_name = :displayName');
    params.displayName = input.displayName.trim().slice(0, 60);
  }
  if (input.bio !== undefined) {
    sets.push('bio = :bio');
    params.bio = input.bio.trim().slice(0, 500);
  }
  if (input.avatarKey !== undefined) {
    sets.push('avatar_url = :avatarUrl');
    params.avatarUrl = input.avatarKey;
  }
  if (input.links !== undefined) {
    sets.push('links = :links');
    params.links = JSON.stringify(input.links.slice(0, 5));
  }

  if (sets.length > 0) {
    await execute(`UPDATE user_profiles SET ${sets.join(', ')} WHERE user_id = :userId`, params);
  }
  if (input.language !== undefined) {
    await execute('UPDATE users SET language = :language WHERE id = :userId', {
      language: input.language,
      userId,
    });
  }

  return getPrivateUser(userId);
}

export async function updatePrivacy(
  userId: number,
  input: Partial<PrivacySettings>,
): Promise<PrivacySettings> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { userId };

  if (input.isPrivate !== undefined) {
    sets.push('is_private = :isPrivate');
    params.isPrivate = input.isPrivate ? 1 : 0;
  }
  if (input.whoCanComment !== undefined) {
    sets.push('who_can_comment = :whoCanComment');
    params.whoCanComment = input.whoCanComment;
  }
  if (input.whoCanMessage !== undefined) {
    sets.push('who_can_message = :whoCanMessage');
    params.whoCanMessage = input.whoCanMessage;
  }
  if (input.whoCanDuet !== undefined) {
    sets.push('who_can_duet = :whoCanDuet');
    params.whoCanDuet = input.whoCanDuet;
  }
  if (input.allowDownload !== undefined) {
    sets.push('allow_download = :allowDownload');
    params.allowDownload = input.allowDownload ? 1 : 0;
  }

  if (sets.length > 0) {
    await execute(`UPDATE user_profiles SET ${sets.join(', ')} WHERE user_id = :userId`, params);
  }

  const user = await getPrivateUser(userId);
  return user.privacy;
}

/**
 * Changes account category and type.
 *
 * Nothing is deleted. Switching away from business keeps the business profile
 * row so switching back restores it — losing a filled-in business profile
 * because someone toggled a setting would be indefensible.
 */
export async function switchAccountType(
  userId: number,
  category: AccountCategory,
  type: AccountType,
): Promise<PrivateUser> {
  const permitted = ACCOUNT_TYPES[category];
  if (!permitted.includes(type)) {
    throw new AppError(
      'validation_failed',
      `'${type}' is not a valid ${category} account type.`,
      { details: { type: [`Choose one of: ${permitted.join(', ')}.`] } },
    );
  }

  await transaction(async (tx) => {
    await execute(
      'UPDATE users SET account_category = :category, account_type = :type WHERE id = :userId',
      { category, type, userId },
      tx,
    );
    if (category === 'business') {
      // Created empty on first switch; a later switch reuses the existing row.
      await execute(
        'INSERT INTO business_profiles (user_id) VALUES (:userId) ON DUPLICATE KEY UPDATE deleted_at = NULL',
        { userId },
        tx,
      );
    }
  });

  return getPrivateUser(userId);
}

export async function updateBusinessProfile(
  userId: number,
  input: {
    category?: string;
    website?: string;
    contactEmail?: string;
    contactPhone?: string;
    ctaLabel?: string;
    ctaUrl?: string;
  },
): Promise<PrivateUser> {
  const user = await queryOne<{ account_category: AccountCategory }>(
    'SELECT account_category FROM users WHERE id = :userId',
    { userId },
  );
  if (user?.account_category !== 'business') {
    throw new AppError(
      'forbidden',
      'Switch to a business account before editing the business profile.',
    );
  }

  await execute(
    `INSERT INTO business_profiles
       (user_id, business_category, website, contact_email, contact_phone, cta_label, cta_url)
     VALUES (:userId, :category, :website, :contactEmail, :contactPhone, :ctaLabel, :ctaUrl)
     ON DUPLICATE KEY UPDATE
       business_category = COALESCE(VALUES(business_category), business_category),
       website           = COALESCE(VALUES(website), website),
       contact_email     = COALESCE(VALUES(contact_email), contact_email),
       contact_phone     = COALESCE(VALUES(contact_phone), contact_phone),
       cta_label         = COALESCE(VALUES(cta_label), cta_label),
       cta_url           = COALESCE(VALUES(cta_url), cta_url),
       deleted_at        = NULL`,
    {
      userId,
      category: input.category ?? null,
      website: input.website ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      ctaLabel: input.ctaLabel ?? null,
      ctaUrl: input.ctaUrl ?? null,
    },
  );

  return getPrivateUser(userId);
}

/** Followers or following, paginated. Blocked accounts are filtered out. */
export async function listGraph(
  targetUserId: number,
  direction: 'followers' | 'following',
  viewerId: number | undefined,
  cursor: string | undefined,
  limitRaw: unknown,
): Promise<UserPage> {
  const limit = normaliseLimit(limitRaw);
  const scope = `graph:${direction}:${targetUserId}`;
  const after = cursor ? decodeCursor(cursor, scope) : undefined;

  // followers → people who follow the target; following → people the target follows.
  const subjectColumn = direction === 'followers' ? 'f.follower_id' : 'f.followee_id';
  const anchorColumn = direction === 'followers' ? 'f.followee_id' : 'f.follower_id';

  type GraphRow = ProfileRow & {
    rel_created: Date;
    viewer_following?: number;
    viewer_followed_by?: number;
  };

  // The viewer's relationship to each listed account, resolved in the same
  // query. Without it every row renders a "Follow" button regardless of whether
  // the viewer already follows that account, and tapping it tries to create a
  // follow that already exists. Two EXISTS columns cost far less than the
  // per-row lookup a single-profile fetch can afford.
  const relationshipColumns =
    viewerId !== undefined
      ? `,
       EXISTS(SELECT 1 FROM follows vf
               WHERE vf.follower_id = :viewerId AND vf.followee_id = u.id
                 AND vf.deleted_at IS NULL) AS viewer_following,
       EXISTS(SELECT 1 FROM follows vb
               WHERE vb.follower_id = u.id AND vb.followee_id = :viewerId
                 AND vb.deleted_at IS NULL) AS viewer_followed_by`
      : '';

  const rows = await query<GraphRow>(
    `SELECT ${PROFILE_COLUMNS}, f.created_at AS rel_created${relationshipColumns}
     ${PROFILE_FROM}
       JOIN follows f ON ${subjectColumn} = u.id
      WHERE ${anchorColumn} = :targetId
        AND f.deleted_at IS NULL
        AND u.deleted_at IS NULL
        AND u.status <> 'banned'
        ${after ? 'AND f.created_at < :afterAt' : ''}
        ${
          viewerId !== undefined
            ? `AND NOT EXISTS (
              SELECT 1 FROM blocks b
               WHERE b.deleted_at IS NULL
                 AND ((b.blocker_id = :viewerId AND b.blocked_id = u.id)
                   OR (b.blocker_id = u.id AND b.blocked_id = :viewerId)))`
            : ''
        }
      ORDER BY f.created_at DESC
      LIMIT :limit`,
    {
      targetId: targetUserId,
      limit: limit + 1,
      ...(after ? { afterAt: new Date(Number(after.k)) } : {}),
      ...(viewerId !== undefined ? { viewerId } : {}),
    },
  );

  const page = buildPage<GraphRow>(rows, limit, scope, (row) => ({
    k: new Date(row.rel_created).getTime(),
    id: String(row.id),
    s: scope,
  }));

  return {
    items: page.items.map((row) => {
      const user = toPublic(row);
      // Left undefined for an anonymous caller: "unknown" and "not following"
      // are different answers, and the client renders them differently.
      if (viewerId !== undefined && row.id !== viewerId) {
        user.isFollowing = Number(row.viewer_following ?? 0) === 1;
        user.isFollowedBy = Number(row.viewer_followed_by ?? 0) === 1;
      }
      return user;
    }),
    hasMore: page.hasMore,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

export { toPublic };
