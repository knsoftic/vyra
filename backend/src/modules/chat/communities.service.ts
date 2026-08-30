/**
 * Communities.
 *
 * A community is a chat with a policy layer on top. The chat carries the
 * messages; the community row carries who may join, who may post, and what the
 * place is called.
 *
 * The rule that shapes most of this file is ADR-014: **ordinary members see the
 * member count, never the member list.** A public community with fifty thousand
 * people in it is otherwise a scraping target that anyone can join to harvest.
 * Staff — owner, admin, moderator — can browse the roster, the join requests and
 * the reports; a member asking for the roster gets the staff list, which is the
 * part they legitimately need in order to know who to appeal to.
 *
 * Membership and the backing chat are written together. A community whose
 * members are not in its chat is a community nobody can talk in, and the two
 * halves drifting apart is the failure this transaction exists to prevent.
 */

import { ulid } from 'ulid';
import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { buildPage, decodeCursor, normaliseLimit } from '../../core/pagination.ts';
import { storage } from '../../core/storage.ts';
import type {
  Community,
  CommunityJoinRequest,
  CommunityMember,
  CommunityRole,
} from '../../../../shared/contracts/messaging.ts';
import type { PublicUser } from '../../../../shared/contracts/user.ts';
import type { Page } from '../../../../shared/contracts/http.ts';

const STAFF_ROLES: CommunityRole[] = ['owner', 'admin', 'moderator'];

export function isStaff(role: CommunityRole | null): boolean {
  return role !== null && STAFF_ROLES.includes(role);
}

interface CommunityRow {
  id: number;
  public_id: string;
  chat_public_id: string;
  name: string;
  logo_url: string | null;
  banner_url: string | null;
  description: string | null;
  rules: string | null;
  announcement: string | null;
  is_private: number;
  member_count: number;
  can_post: number;
  can_comment: number;
  can_send_media: number;
  can_send_links: number;
  can_invite: number;
  created_at: Date;
  my_role: CommunityRole | null;
  request_pending: number;
}

/**
 * `rules` is a JSON array in the column. A malformed value is treated as no
 * rules rather than throwing — a broken rules list should not make a community
 * unreadable.
 */
function parseRules(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

function toCommunity(row: CommunityRow): Community {
  const community: Community = {
    id: row.public_id,
    chatId: row.chat_public_id,
    name: row.name,
    description: row.description ?? '',
    rules: parseRules(row.rules),
    memberCount: Number(row.member_count),
    isPrivate: row.is_private === 1,
    permissions: {
      canPost: row.can_post === 1,
      canComment: row.can_comment === 1,
      canSendMedia: row.can_send_media === 1,
      canSendLinks: row.can_send_links === 1,
      canInvite: row.can_invite === 1,
    },
    createdAt: new Date(row.created_at).toISOString(),
  };

  if (row.logo_url) community.avatar = row.logo_url;
  if (row.banner_url) community.banner = row.banner_url;
  if (row.announcement) community.announcement = row.announcement;
  if (row.my_role) community.myRole = row.my_role;
  if (Number(row.request_pending) === 1) community.joinRequestPending = true;

  return community;
}

const COMMUNITY_SELECT = `
  SELECT co.id, co.public_id, co.name, co.logo_url, co.banner_url, co.description,
         co.rules, co.announcement, co.is_private, co.member_count,
         co.can_post, co.can_comment, co.can_send_media, co.can_send_links, co.can_invite,
         co.created_at,
         ch.public_id AS chat_public_id,
         (SELECT cm.role FROM community_members cm
           WHERE cm.community_id = co.id AND cm.user_id = :viewerId
             AND cm.left_at IS NULL AND cm.is_banned = 0) AS my_role,
         EXISTS(SELECT 1 FROM community_join_requests jr
                 WHERE jr.community_id = co.id AND jr.user_id = :viewerId
                   AND jr.status = 'pending' AND jr.deleted_at IS NULL) AS request_pending
    FROM communities co
    JOIN chats ch ON ch.id = co.chat_id
   WHERE co.deleted_at IS NULL AND co.status = 'active'
`;

/** The caller's role, or null. Banned counts as not a member. */
export async function roleOf(communityId: number, userId: number): Promise<CommunityRole | null> {
  const row = await queryOne<{ role: CommunityRole; is_banned: number }>(
    `SELECT role, is_banned FROM community_members
      WHERE community_id = :communityId AND user_id = :userId AND left_at IS NULL`,
    { communityId, userId },
  );
  if (!row || Number(row.is_banned) === 1) return null;
  return row.role;
}

/** Resolves a public id to a row, or 404. */
export async function requireCommunity(
  publicId: string,
  viewerId: number,
): Promise<{ row: CommunityRow; community: Community }> {
  const row = await queryOne<CommunityRow>(`${COMMUNITY_SELECT} AND co.public_id = :publicId`, {
    publicId,
    viewerId,
  });
  if (!row) throw new AppError('not_found', 'Community not found.');
  return { row, community: toCommunity(row) };
}

export async function requireStaff(
  publicId: string,
  userId: number,
): Promise<{ row: CommunityRow; role: CommunityRole }> {
  const { row } = await requireCommunity(publicId, userId);
  const role = await roleOf(row.id, userId);
  if (!isStaff(role)) {
    throw new AppError('forbidden', 'Only community staff can do that.');
  }
  return { row, role: role as CommunityRole };
}

// ── Reads ──

/**
 * Public discovery.
 *
 * Private communities appear in the list — a private community is discoverable,
 * it is its *contents* that are closed — but nothing about who is in one is
 * returned here.
 */
export async function listCommunities(
  viewerId: number,
  options: { mine?: boolean; q?: string },
  cursor: string | undefined,
  limitRaw: unknown,
): Promise<Page<Community>> {
  const limit = normaliseLimit(limitRaw);
  const scope = `communities:${options.mine ? 'mine' : 'all'}`;
  const after = cursor ? decodeCursor(cursor, scope) : undefined;

  const rows = await query<CommunityRow>(
    `${COMMUNITY_SELECT}
       ${options.mine ? `AND EXISTS(SELECT 1 FROM community_members m
                                     WHERE m.community_id = co.id AND m.user_id = :viewerId
                                       AND m.left_at IS NULL AND m.is_banned = 0)` : ''}
       ${options.q ? 'AND co.name LIKE :search' : ''}
       ${after ? 'AND co.id < :afterId' : ''}
     ORDER BY co.member_count DESC, co.id DESC
     LIMIT :limit`,
    {
      viewerId,
      limit: limit + 1,
      ...(options.q ? { search: `%${options.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` } : {}),
      ...(after ? { afterId: Number(after.id) } : {}),
    },
  );

  const page = buildPage(rows, limit, scope, (row) => ({
    k: Number(row.member_count),
    id: String(row.id),
    s: scope,
  }));

  return {
    items: page.items.map(toCommunity),
    hasMore: page.hasMore,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

export async function getCommunity(publicId: string, viewerId: number): Promise<Community> {
  const { community } = await requireCommunity(publicId, viewerId);
  return community;
}

/**
 * The member list — subject to ADR-014.
 *
 * A staff caller gets everyone. Anyone else gets staff only, and is told so by
 * `restricted`, so the client can say "showing moderators" rather than implying
 * the community has four people in it.
 */
export async function listMembers(
  publicId: string,
  viewerId: number,
  cursor: string | undefined,
  limitRaw: unknown,
): Promise<Page<CommunityMember> & { restricted: boolean }> {
  const { row } = await requireCommunity(publicId, viewerId);
  const viewerRole = await roleOf(row.id, viewerId);
  const staff = isStaff(viewerRole);

  const limit = normaliseLimit(limitRaw);
  const scope = `community-members:${row.id}:${staff ? 'all' : 'staff'}`;
  const after = cursor ? decodeCursor(cursor, scope) : undefined;

  const rows = await query<{
    user_public_id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    bio: string | null;
    verification_tier: string;
    account_category: string;
    account_type: string;
    follower_count: number;
    following_count: number;
    like_count: number;
    video_count: number;
    is_private: number;
    user_created_at: Date;
    role: CommunityRole;
    is_muted: number;
    is_banned: number;
    joined_at: Date;
    sort_id: number;
  }>(
    `SELECT u.public_id AS user_public_id, u.username, u.verification_tier,
            u.account_category, u.account_type, u.created_at AS user_created_at,
            p.display_name, p.avatar_url, p.bio, p.follower_count, p.following_count,
            p.like_count, p.video_count, p.is_private,
            cm.role, cm.is_muted, cm.is_banned, cm.joined_at,
            u.id AS sort_id
       FROM community_members cm
       JOIN users u ON u.id = cm.user_id
       JOIN user_profiles p ON p.user_id = cm.user_id
      WHERE cm.community_id = :communityId
        AND cm.left_at IS NULL
        AND u.deleted_at IS NULL
        ${staff ? '' : "AND cm.role <> 'member'"}
        ${staff ? '' : 'AND cm.is_banned = 0'}
        ${after ? 'AND u.id > :afterId' : ''}
      ORDER BY FIELD(cm.role, 'owner', 'admin', 'moderator', 'member'), u.id
      LIMIT :limit`,
    {
      communityId: row.id,
      limit: limit + 1,
      ...(after ? { afterId: Number(after.id) } : {}),
    },
  );

  const page = buildPage(rows, limit, scope, (r) => ({
    k: r.sort_id,
    id: String(r.sort_id),
    s: scope,
  }));

  const items: CommunityMember[] = page.items.map((r) => {
    const user: PublicUser = {
      id: r.user_public_id,
      username: r.username,
      displayName: r.display_name,
      bio: r.bio ?? '',
      verified: r.verification_tier !== 'none',
      verificationTier: r.verification_tier as PublicUser['verificationTier'],
      accountCategory: r.account_category as PublicUser['accountCategory'],
      accountType: r.account_type as PublicUser['accountType'],
      followers: Number(r.follower_count),
      following: Number(r.following_count),
      likes: Number(r.like_count),
      videos: Number(r.video_count),
      isPrivate: r.is_private === 1,
      createdAt: new Date(r.user_created_at).toISOString(),
    };
    if (r.avatar_url) user.avatar = r.avatar_url;

    return {
      user,
      role: r.role,
      isMuted: r.is_muted === 1,
      isBanned: r.is_banned === 1,
      joinedAt: new Date(r.joined_at).toISOString(),
    };
  });

  return {
    items,
    hasMore: page.hasMore,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    restricted: !staff,
  };
}

/** Join requests. Staff only — this is a list of people, same as the roster. */
export async function listJoinRequests(
  publicId: string,
  userId: number,
): Promise<CommunityJoinRequest[]> {
  const { row } = await requireStaff(publicId, userId);

  const rows = await query<{
    public_id: string;
    message: string | null;
    status: 'pending' | 'approved' | 'rejected';
    created_at: Date;
    user_public_id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    bio: string | null;
    verification_tier: string;
    account_category: string;
    account_type: string;
    follower_count: number;
    following_count: number;
    like_count: number;
    video_count: number;
    is_private: number;
    user_created_at: Date;
  }>(
    `SELECT jr.id AS public_id, jr.message, jr.status, jr.created_at,
            u.public_id AS user_public_id, u.username, u.verification_tier,
            u.account_category, u.account_type, u.created_at AS user_created_at,
            p.display_name, p.avatar_url, p.bio, p.follower_count, p.following_count,
            p.like_count, p.video_count, p.is_private
       FROM community_join_requests jr
       JOIN users u ON u.id = jr.user_id
       JOIN user_profiles p ON p.user_id = jr.user_id
      WHERE jr.community_id = :communityId
        AND jr.status = 'pending'
        AND jr.deleted_at IS NULL
        AND u.deleted_at IS NULL
      ORDER BY jr.created_at ASC
      LIMIT 200`,
    { communityId: row.id },
  );

  return rows.map((r) => {
    const user: PublicUser = {
      id: r.user_public_id,
      username: r.username,
      displayName: r.display_name,
      bio: r.bio ?? '',
      verified: r.verification_tier !== 'none',
      verificationTier: r.verification_tier as PublicUser['verificationTier'],
      accountCategory: r.account_category as PublicUser['accountCategory'],
      accountType: r.account_type as PublicUser['accountType'],
      followers: Number(r.follower_count),
      following: Number(r.following_count),
      likes: Number(r.like_count),
      videos: Number(r.video_count),
      isPrivate: r.is_private === 1,
      createdAt: new Date(r.user_created_at).toISOString(),
    };
    if (r.avatar_url) user.avatar = r.avatar_url;

    const request: CommunityJoinRequest = {
      id: String(r.public_id),
      user,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
    };
    if (r.message) request.message = r.message;
    return request;
  });
}

// ── Writes ──

export async function createCommunity(
  userId: number,
  input: { name: string; description: string; isPrivate: boolean; rules: string[] },
): Promise<Community> {
  const publicId = ulid();
  const chatPublicId = ulid();

  await transaction(async (tx) => {
    // The chat comes first: the community points at it.
    const chatResult = await execute(
      `INSERT INTO chats (public_id, kind, title, description, owner_id, member_count)
       VALUES (:publicId, 'community', :title, :description, :owner, 1)`,
      {
        publicId: chatPublicId,
        title: input.name,
        description: input.description || null,
        owner: userId,
      },
      tx,
    );
    const chatId = chatResult.insertId;

    await execute(
      `INSERT INTO chat_participants (chat_id, user_id, role)
       VALUES (:chatId, :userId, 'owner')`,
      { chatId, userId },
      tx,
    );

    const communityResult = await execute(
      `INSERT INTO communities
         (public_id, chat_id, name, description, rules, is_private, owner_id, member_count)
       VALUES (:publicId, :chatId, :name, :description, :rules, :isPrivate, :owner, 1)`,
      {
        publicId,
        chatId,
        name: input.name,
        description: input.description || null,
        rules: JSON.stringify(input.rules),
        isPrivate: input.isPrivate ? 1 : 0,
        owner: userId,
      },
      tx,
    );

    await execute(
      `INSERT INTO community_members (community_id, user_id, role)
       VALUES (:communityId, :userId, 'owner')`,
      { communityId: communityResult.insertId, userId },
      tx,
    );
  });

  return getCommunity(publicId, userId);
}

export async function updateCommunity(
  userId: number,
  publicId: string,
  patch: Record<string, unknown>,
): Promise<Community> {
  const { row, role } = await requireStaff(publicId, userId);

  // Moderators run the room; they do not get to redefine what it is.
  const ownerOnly = ['name', 'isPrivate'];
  if (role === 'moderator' && ownerOnly.some((k) => patch[k] !== undefined)) {
    throw new AppError('forbidden', 'Only the owner or an admin can change that.');
  }

  const columns: Record<string, string> = {
    name: 'name',
    description: 'description',
    announcement: 'announcement',
    isPrivate: 'is_private',
    canPost: 'can_post',
    canComment: 'can_comment',
    canSendMedia: 'can_send_media',
    canSendLinks: 'can_send_links',
    canInvite: 'can_invite',
  };

  const sets: string[] = [];
  const params: Record<string, unknown> = { id: row.id };

  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${column} = :${key}`);
    params[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  }

  if (Array.isArray(patch.rules)) {
    sets.push('rules = :rules');
    params.rules = JSON.stringify(patch.rules);
  }
  if (typeof patch.logoKey === 'string') {
    sets.push('logo_url = :logo');
    params.logo = storage.url(patch.logoKey);
  }
  if (typeof patch.bannerKey === 'string') {
    sets.push('banner_url = :banner');
    params.banner = storage.url(patch.bannerKey);
  }

  if (sets.length > 0) {
    await execute(`UPDATE communities SET ${sets.join(', ')} WHERE id = :id`, params);
    // The chat title follows the community name, so the inbox does not show a
    // name the community stopped using.
    if (typeof patch.name === 'string') {
      await execute('UPDATE chats SET title = :title WHERE id = :chatId', {
        title: patch.name,
        chatId: row.id,
      });
    }
  }

  return getCommunity(publicId, userId);
}

export interface JoinResult {
  joined: boolean;
  /** True when the community is private and a request is awaiting a decision. */
  pending: boolean;
  chatId?: string;
}

/**
 * Joining.
 *
 * A public community admits immediately. A private one records a request, which
 * staff decide on. A banned account can do neither — and is told the same thing
 * either way, so a ban is not a signal to make a new account and try again.
 */
export async function joinCommunity(
  userId: number,
  publicId: string,
  message: string | undefined,
): Promise<JoinResult> {
  const { row } = await requireCommunity(publicId, userId);

  const existing = await queryOne<{ role: CommunityRole; is_banned: number; left_at: Date | null }>(
    `SELECT role, is_banned, left_at FROM community_members
      WHERE community_id = :communityId AND user_id = :userId`,
    { communityId: row.id, userId },
  );

  if (existing && Number(existing.is_banned) === 1) {
    throw new AppError('forbidden', 'You cannot join this community.');
  }
  if (existing && existing.left_at === null) {
    return { joined: true, pending: false, chatId: row.chat_public_id };
  }

  if (row.is_private === 1) {
    await execute(
      `INSERT INTO community_join_requests (community_id, user_id, message)
       VALUES (:communityId, :userId, :message)
       ON DUPLICATE KEY UPDATE status = 'pending', message = :message, deleted_at = NULL`,
      { communityId: row.id, userId, message: message ?? null },
    );
    return { joined: false, pending: true };
  }

  await admit(row.id, await chatIdOf(row.id), userId);
  return { joined: true, pending: false, chatId: row.chat_public_id };
}

async function chatIdOf(communityId: number): Promise<number> {
  const row = await queryOne<{ chat_id: number }>(
    'SELECT chat_id FROM communities WHERE id = :id',
    { id: communityId },
  );
  if (!row) throw new AppError('not_found', 'Community not found.');
  return row.chat_id;
}

/** Adds someone to both halves — the community and its chat — or to neither. */
async function admit(communityId: number, chatId: number, userId: number): Promise<void> {
  await transaction(async (tx) => {
    await execute(
      `INSERT INTO community_members (community_id, user_id, role)
       VALUES (:communityId, :userId, 'member')
       ON DUPLICATE KEY UPDATE left_at = NULL, is_banned = 0`,
      { communityId, userId },
      tx,
    );
    await execute(
      `INSERT INTO chat_participants (chat_id, user_id, role)
       VALUES (:chatId, :userId, 'member')
       ON DUPLICATE KEY UPDATE left_at = NULL`,
      { chatId, userId },
      tx,
    );
  });
  await refreshCounts(communityId, chatId);
}

export async function leaveCommunity(userId: number, publicId: string): Promise<{ left: true }> {
  const { row } = await requireCommunity(publicId, userId);
  const role = await roleOf(row.id, userId);

  if (role === 'owner') {
    throw new AppError(
      'forbidden',
      'Transfer ownership before leaving — a community cannot be left without an owner.',
    );
  }

  const chatId = await chatIdOf(row.id);
  await transaction(async (tx) => {
    await execute(
      `UPDATE community_members SET left_at = CURRENT_TIMESTAMP(3)
        WHERE community_id = :communityId AND user_id = :userId`,
      { communityId: row.id, userId },
      tx,
    );
    await execute(
      `UPDATE chat_participants SET left_at = CURRENT_TIMESTAMP(3)
        WHERE chat_id = :chatId AND user_id = :userId`,
      { chatId, userId },
      tx,
    );
  });

  await refreshCounts(row.id, chatId);
  return { left: true };
}

export async function decideJoinRequest(
  userId: number,
  publicId: string,
  requestId: string,
  approve: boolean,
): Promise<{ decided: true; approved: boolean }> {
  const { row } = await requireStaff(publicId, userId);

  const request = await queryOne<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM community_join_requests
      WHERE id = :requestId AND community_id = :communityId
        AND status = 'pending' AND deleted_at IS NULL`,
    { requestId: Number(requestId), communityId: row.id },
  );
  if (!request) throw new AppError('not_found', 'Request not found.');

  await execute(
    `UPDATE community_join_requests
        SET status = :status, decided_by = :decidedBy, decided_at = CURRENT_TIMESTAMP(3)
      WHERE id = :id`,
    { status: approve ? 'approved' : 'rejected', decidedBy: userId, id: request.id },
  );

  if (approve) {
    await admit(row.id, await chatIdOf(row.id), request.user_id);
  }

  return { decided: true, approved: approve };
}

/**
 * Role changes.
 *
 * The owner role is not assignable through this — transferring a community is a
 * different operation with different consequences, and letting it happen through
 * a generic "set role" call is how an admin promotes themselves.
 */
export async function setMemberRole(
  userId: number,
  publicId: string,
  memberPublicId: string,
  role: 'admin' | 'moderator' | 'member',
): Promise<{ role: string }> {
  const { row, role: callerRole } = await requireStaff(publicId, userId);

  if (callerRole === 'moderator') {
    throw new AppError('forbidden', 'Moderators cannot change roles.');
  }

  const member = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId: memberPublicId },
  );
  if (!member) throw new AppError('not_found', 'Account not found.');

  const target = await roleOf(row.id, member.id);
  if (target === null) throw new AppError('not_found', 'That person is not a member.');
  if (target === 'owner') throw new AppError('forbidden', 'The owner role cannot be changed here.');

  await execute(
    `UPDATE community_members SET role = :role
      WHERE community_id = :communityId AND user_id = :memberId`,
    { role, communityId: row.id, memberId: member.id },
  );

  // The chat role follows, so group permissions and community permissions agree.
  await execute(
    `UPDATE chat_participants SET role = :role
      WHERE chat_id = :chatId AND user_id = :memberId`,
    { role, chatId: await chatIdOf(row.id), memberId: member.id },
  );

  return { role };
}

export async function moderateMember(
  userId: number,
  publicId: string,
  memberPublicId: string,
  patch: { muted?: boolean; banned?: boolean },
): Promise<{ isMuted: boolean; isBanned: boolean }> {
  const { row } = await requireStaff(publicId, userId);

  const member = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId: memberPublicId },
  );
  if (!member) throw new AppError('not_found', 'Account not found.');

  const target = await roleOf(row.id, member.id);
  if (target === 'owner') throw new AppError('forbidden', 'The owner cannot be moderated.');

  const sets: string[] = [];
  const params: Record<string, unknown> = { communityId: row.id, memberId: member.id };
  if (patch.muted !== undefined) {
    sets.push('is_muted = :muted');
    params.muted = patch.muted ? 1 : 0;
  }
  if (patch.banned !== undefined) {
    sets.push('is_banned = :banned');
    params.banned = patch.banned ? 1 : 0;
  }
  if (sets.length === 0) throw new AppError('bad_request', 'Nothing to change.');

  await execute(
    `UPDATE community_members SET ${sets.join(', ')}
      WHERE community_id = :communityId AND user_id = :memberId`,
    params,
  );

  // A ban removes them from the conversation as well; leaving them able to
  // read and post would make the ban decorative.
  if (patch.banned === true) {
    await execute(
      `UPDATE chat_participants SET left_at = CURRENT_TIMESTAMP(3)
        WHERE chat_id = :chatId AND user_id = :memberId`,
      { chatId: await chatIdOf(row.id), memberId: member.id },
    );
    await refreshCounts(row.id, await chatIdOf(row.id));
  }

  const after = await queryOne<{ is_muted: number; is_banned: number }>(
    `SELECT is_muted, is_banned FROM community_members
      WHERE community_id = :communityId AND user_id = :memberId`,
    { communityId: row.id, memberId: member.id },
  );

  return {
    isMuted: Number(after?.is_muted ?? 0) === 1,
    isBanned: Number(after?.is_banned ?? 0) === 1,
  };
}

/** Both counters are derived from the rows, so they cannot drift. */
async function refreshCounts(communityId: number, chatId: number): Promise<void> {
  await execute(
    `UPDATE communities
        SET member_count = (SELECT COUNT(*) FROM community_members
                             WHERE community_id = :communityId
                               AND left_at IS NULL AND is_banned = 0)
      WHERE id = :communityId`,
    { communityId },
  );
  await execute(
    `UPDATE chats
        SET member_count = (SELECT COUNT(*) FROM chat_participants
                             WHERE chat_id = :chatId AND left_at IS NULL)
      WHERE id = :chatId`,
    { chatId },
  );
}
