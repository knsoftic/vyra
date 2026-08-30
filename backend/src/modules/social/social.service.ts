/**
 * Social graph — follows, blocks and reports.
 *
 * Follows and blocks are **soft-deleted**, never removed. Unfollowing and then
 * re-following restores the same row, and a block that gets lifted leaves a
 * record that it happened. That matters for abuse investigation: "they blocked
 * me and then unblocked me to message me" is only answerable if the history
 * survives.
 *
 * Counters on `user_profiles` are maintained inside the same transaction as the
 * relationship change, so a follower count can never drift from the graph.
 */

import { execute, query, queryOne, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { ulid } from 'ulid';
import { logger } from '../../core/logger.ts';
import { emitToUser } from '../../socket.ts';
import { SOCKET_EVENTS } from '../../../../shared/contracts/routes.ts';
import type { ReportTargetType } from '../../../../shared/contracts/user.ts';

export interface FollowResult {
  following: boolean;
  followerCount: number;
}

/** True if either party has blocked the other. */
export async function isBlockedEitherWay(a: number, b: number): Promise<boolean> {
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM blocks
      WHERE deleted_at IS NULL
        AND ((blocker_id = :a AND blocked_id = :b) OR (blocker_id = :b AND blocked_id = :a))`,
    { a, b },
  );
  return Number(row?.c ?? 0) > 0;
}

export async function follow(followerId: number, followeeId: number): Promise<FollowResult> {
  if (followerId === followeeId) {
    throw new AppError('bad_request', 'You cannot follow yourself.');
  }
  if (await isBlockedEitherWay(followerId, followeeId)) {
    // Same response as a missing account — see getPublicUser.
    throw new AppError('not_found', 'Account not found.');
  }

  return transaction(async (tx) => {
    const existing = await queryOne<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM follows WHERE follower_id = :a AND followee_id = :b FOR UPDATE',
      { a: followerId, b: followeeId },
      tx,
    );

    // Already following: return the current state rather than double-counting.
    if (existing && existing.deleted_at === null) {
      const count = await currentFollowerCount(followeeId, tx);
      return { following: true, followerCount: count };
    }

    if (existing) {
      await execute(
        'UPDATE follows SET deleted_at = NULL, created_at = NOW(3) WHERE follower_id = :a AND followee_id = :b',
        { a: followerId, b: followeeId },
        tx,
      );
    } else {
      await execute(
        'INSERT INTO follows (follower_id, followee_id) VALUES (:a, :b)',
        { a: followerId, b: followeeId },
        tx,
      );
    }

    await execute(
      'UPDATE user_profiles SET follower_count = follower_count + 1 WHERE user_id = :id',
      { id: followeeId },
      tx,
    );
    await execute(
      'UPDATE user_profiles SET following_count = following_count + 1 WHERE user_id = :id',
      { id: followerId },
      tx,
    );

    const count = await currentFollowerCount(followeeId, tx);
    return { following: true, followerCount: count };
  }).then(async (result) => {
    await notifyFollow(followerId, followeeId);
    return result;
  });
}

export async function unfollow(followerId: number, followeeId: number): Promise<FollowResult> {
  return transaction(async (tx) => {
    const existing = await queryOne<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM follows WHERE follower_id = :a AND followee_id = :b FOR UPDATE',
      { a: followerId, b: followeeId },
      tx,
    );

    if (!existing || existing.deleted_at !== null) {
      const count = await currentFollowerCount(followeeId, tx);
      return { following: false, followerCount: count };
    }

    await execute(
      'UPDATE follows SET deleted_at = NOW(3) WHERE follower_id = :a AND followee_id = :b',
      { a: followerId, b: followeeId },
      tx,
    );
    // GREATEST guards against a counter that has already drifted to zero.
    await execute(
      'UPDATE user_profiles SET follower_count = GREATEST(follower_count - 1, 0) WHERE user_id = :id',
      { id: followeeId },
      tx,
    );
    await execute(
      'UPDATE user_profiles SET following_count = GREATEST(following_count - 1, 0) WHERE user_id = :id',
      { id: followerId },
      tx,
    );

    const count = await currentFollowerCount(followeeId, tx);
    return { following: false, followerCount: count };
  });
}

async function currentFollowerCount(userId: number, tx: Parameters<typeof execute>[2]): Promise<number> {
  const row = await queryOne<{ follower_count: number }>(
    'SELECT follower_count FROM user_profiles WHERE user_id = :id',
    { id: userId },
    tx,
  );
  return Number(row?.follower_count ?? 0);
}

async function notifyFollow(followerId: number, followeeId: number): Promise<void> {
  try {
    await execute(
      `INSERT INTO notifications (user_id, kind, actor_id, body, target_type, target_id)
       VALUES (:userId, 'follow', :actorId, 'started following you', 'user', :actorId)`,
      { userId: followeeId, actorId: followerId },
    );
    emitToUser(followeeId, SOCKET_EVENTS.notification, { kind: 'follow', actorId: followerId });
  } catch (err) {
    // A missed notification must not fail the follow itself.
    logger.warn({ err, followerId, followeeId }, 'follow notification failed');
  }
}

/**
 * Blocks a user.
 *
 * Blocking severs the follow in both directions — that is what users expect it
 * to mean. The follow rows are soft-deleted, so unblocking does not silently
 * restore a following relationship the blocker did not ask for; they would
 * have to follow again deliberately.
 */
export async function block(blockerId: number, blockedId: number): Promise<{ blocked: true }> {
  if (blockerId === blockedId) {
    throw new AppError('bad_request', 'You cannot block yourself.');
  }

  await transaction(async (tx) => {
    await execute(
      `INSERT INTO blocks (blocker_id, blocked_id) VALUES (:a, :b)
       ON DUPLICATE KEY UPDATE deleted_at = NULL, created_at = NOW(3)`,
      { a: blockerId, b: blockedId },
      tx,
    );

    // Drop both follow directions, adjusting only the counters that change.
    for (const [follower, followee] of [
      [blockerId, blockedId],
      [blockedId, blockerId],
    ] as const) {
      const live = await queryOne<{ x: number }>(
        `SELECT 1 AS x FROM follows
          WHERE follower_id = :a AND followee_id = :b AND deleted_at IS NULL FOR UPDATE`,
        { a: follower, b: followee },
        tx,
      );
      if (!live) continue;

      await execute(
        'UPDATE follows SET deleted_at = NOW(3) WHERE follower_id = :a AND followee_id = :b',
        { a: follower, b: followee },
        tx,
      );
      await execute(
        'UPDATE user_profiles SET follower_count = GREATEST(follower_count - 1, 0) WHERE user_id = :id',
        { id: followee },
        tx,
      );
      await execute(
        'UPDATE user_profiles SET following_count = GREATEST(following_count - 1, 0) WHERE user_id = :id',
        { id: follower },
        tx,
      );
    }
  });

  return { blocked: true };
}

export async function unblock(blockerId: number, blockedId: number): Promise<{ blocked: false }> {
  await execute(
    `UPDATE blocks SET deleted_at = NOW(3)
      WHERE blocker_id = :a AND blocked_id = :b AND deleted_at IS NULL`,
    { a: blockerId, b: blockedId },
  );
  return { blocked: false };
}

export interface BlockedEntry {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  blockedAt: string;
}

export async function listBlocked(blockerId: number): Promise<BlockedEntry[]> {
  const rows = await query<{
    public_id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    created_at: Date;
  }>(
    `SELECT u.public_id, u.username, p.display_name, p.avatar_url, bl.created_at
       FROM blocks bl
       JOIN users u ON u.id = bl.blocked_id
       JOIN user_profiles p ON p.user_id = u.id
      WHERE bl.blocker_id = :id AND bl.deleted_at IS NULL
      ORDER BY bl.created_at DESC
      LIMIT 500`,
    { id: blockerId },
  );

  return rows.map((r) => ({
    id: r.public_id,
    username: r.username,
    displayName: r.display_name,
    ...(r.avatar_url ? { avatar: r.avatar_url } : {}),
    blockedAt: new Date(r.created_at).toISOString(),
  }));
}

/**
 * Files a report. Deliberately permissive about duplicates — the same person
 * reporting twice is noise, but suppressing a report is worse than storing one
 * extra row, and repeat volume is itself a moderation signal.
 */
export async function report(
  reporterId: number,
  input: { targetType: ReportTargetType; targetId: number; reason: string; detail?: string },
): Promise<{ reportId: string }> {
  const publicId = ulid();
  await execute(
    `INSERT INTO reports (public_id, reporter_id, target_type, target_id, reason, detail)
     VALUES (:publicId, :reporterId, :targetType, :targetId, :reason, :detail)`,
    {
      publicId,
      reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason.slice(0, 80),
      detail: input.detail?.slice(0, 1000) ?? null,
    },
  );
  return { reportId: publicId };
}
