/**
 * Moderation.
 *
 * The report queue, the decisions taken on it, and the enforcement of those
 * decisions. Three properties shape the design.
 *
 * **A decision without enforcement is theatre.** Suspending an account has to
 * stop that account doing things; removing a video has to remove it. Every
 * action here writes both the record *and* the change it describes, in one
 * transaction, so the two cannot disagree. A `moderation_actions` row that
 * claims a suspension nobody is serving would be worse than no record at all.
 *
 * **Every action is reversible and attributed.** Moderation is done by people
 * under time pressure on incomplete information, so it is wrong sometimes. Each
 * action names the administrator, carries a reason, and can be reverted — and
 * reverting restores what the action changed rather than merely marking a row.
 *
 * **The reporter learns the outcome, never the details.** Someone who reports
 * content is entitled to know it was looked at and what happened. They are not
 * entitled to know who the moderator was, what else that account has done, or
 * what internal note was attached.
 */

import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import type { PoolConnection } from 'mysql2/promise';

export type ModerationAction =
  | 'no_action'
  | 'warning'
  | 'content_removal'
  | 'restrict_distribution'
  | 'temporary_restriction'
  | 'suspension'
  | 'permanent_ban'
  | 'reinstate';

export type ReportTargetType = 'user' | 'video' | 'comment' | 'live' | 'community' | 'group' | 'message';

export interface QueuedReport {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  detail?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'reviewing' | 'actioned' | 'dismissed';
  reporter: { username: string };
  /** How many separate people have reported the same thing. */
  reportCount: number;
  createdAt: string;
}

/**
 * The queue, ordered by how much attention each item deserves.
 *
 * Severity first, then how many people reported it, then age. Repeated reports
 * of the same target are a stronger signal than one report, and the oldest
 * unactioned item should never be starved by a stream of new ones.
 */
export async function reportQueue(
  options: { status?: string; targetType?: string; limit?: number } = {},
): Promise<QueuedReport[]> {
  const rows = await query<{
    public_id: string;
    target_type: ReportTargetType;
    target_id: number;
    reason: string;
    detail: string | null;
    severity: QueuedReport['severity'];
    status: QueuedReport['status'];
    created_at: Date;
    reporter_username: string;
    report_count: number;
  }>(
    `SELECT r.public_id, r.target_type, r.target_id, r.reason, r.detail, r.severity,
            r.status, r.created_at, u.username AS reporter_username,
            (SELECT COUNT(DISTINCT r2.reporter_id) FROM reports r2
              WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id
                AND r2.deleted_at IS NULL) AS report_count
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
      WHERE r.deleted_at IS NULL
        ${options.status ? 'AND r.status = :status' : "AND r.status IN ('pending', 'reviewing')"}
        ${options.targetType ? 'AND r.target_type = :targetType' : ''}
      ORDER BY FIELD(r.severity, 'critical', 'high', 'medium', 'low'),
               report_count DESC,
               r.created_at ASC
      LIMIT :limit`,
    {
      limit: options.limit ?? 100,
      ...(options.status ? { status: options.status } : {}),
      ...(options.targetType ? { targetType: options.targetType } : {}),
    },
  );

  return rows.map((row) => {
    const report: QueuedReport = {
      id: row.public_id,
      targetType: row.target_type,
      targetId: String(row.target_id),
      reason: row.reason,
      severity: row.severity,
      status: row.status,
      reporter: { username: row.reporter_username },
      reportCount: Number(row.report_count),
      createdAt: new Date(row.created_at).toISOString(),
    };
    if (row.detail) report.detail = row.detail;
    return report;
  });
}

/** Everything reported about one target, so a decision is made on the whole picture. */
export async function reportContext(
  targetType: ReportTargetType,
  targetId: number,
): Promise<{
  reports: { reason: string; detail?: string; createdAt: string }[];
  priorActions: { action: string; reason: string; createdAt: string; reverted: boolean }[];
}> {
  const reports = await query<{ reason: string; detail: string | null; created_at: Date }>(
    `SELECT reason, detail, created_at FROM reports
      WHERE target_type = :targetType AND target_id = :targetId AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 50`,
    { targetType, targetId },
  );

  const priorActions = await query<{
    action: string;
    reason: string;
    created_at: Date;
    reverted_at: Date | null;
  }>(
    `SELECT action, reason, created_at, reverted_at FROM moderation_actions
      WHERE target_type = :targetType AND target_id = :targetId
      ORDER BY created_at DESC LIMIT 50`,
    { targetType, targetId },
  );

  return {
    reports: reports.map((r) => ({
      reason: r.reason,
      ...(r.detail ? { detail: r.detail } : {}),
      createdAt: new Date(r.created_at).toISOString(),
    })),
    priorActions: priorActions.map((a) => ({
      action: a.action,
      reason: a.reason,
      createdAt: new Date(a.created_at).toISOString(),
      reverted: a.reverted_at !== null,
    })),
  };
}

export interface DecisionInput {
  adminUserId: number;
  reportPublicId?: string;
  targetType: ReportTargetType;
  targetId: number;
  action: ModerationAction;
  reason: string;
  /** For temporary restrictions and suspensions. */
  durationHours?: number;
}

export interface DecisionResult {
  actionId: number;
  action: ModerationAction;
  enforced: string;
  expiresAt?: string;
}

/**
 * Applies a moderation decision.
 *
 * The record and the enforcement happen together. Everything that follows is
 * inside one transaction so that a crash cannot leave a suspension recorded but
 * not served, or served but not recorded.
 */
export async function decide(input: DecisionInput): Promise<DecisionResult> {
  if (input.reason.trim().length < 3) {
    // Moderation without a stated reason cannot be reviewed, appealed or
    // learned from, so it is refused rather than allowed with an empty string.
    throw new AppError('bad_request', 'A moderation decision must state its reason.');
  }

  const expiresAt =
    input.durationHours && input.durationHours > 0
      ? new Date(Date.now() + input.durationHours * 60 * 60 * 1000)
      : null;

  let actionId = 0;
  let enforced = 'nothing';

  await transaction(async (tx) => {
    let reportId: number | null = null;
    if (input.reportPublicId) {
      const report = await queryOne<{ id: number }>(
        'SELECT id FROM reports WHERE public_id = :publicId AND deleted_at IS NULL',
        { publicId: input.reportPublicId },
        tx,
      );
      if (!report) throw new AppError('not_found', 'Report not found.');
      reportId = report.id;
    }

    const result = await execute(
      `INSERT INTO moderation_actions
         (report_id, admin_id, target_type, target_id, action, reason, expires_at)
       VALUES (:reportId, :adminId, :targetType, :targetId, :action, :reason, :expiresAt)`,
      {
        reportId,
        adminId: input.adminUserId,
        targetType: input.targetType,
        targetId: input.targetId,
        action: input.action,
        reason: input.reason,
        expiresAt,
      },
      tx,
    );
    actionId = result.insertId;

    enforced = await enforce(tx, input, expiresAt);

    // Every report about this target is resolved by the decision, so a queue
    // does not show ten entries for one thing already dealt with.
    await execute(
      `UPDATE reports
          SET status = :status, decided_by = :adminId, decided_at = CURRENT_TIMESTAMP(3)
        WHERE target_type = :targetType AND target_id = :targetId
          AND status IN ('pending', 'reviewing') AND deleted_at IS NULL`,
      {
        status: input.action === 'no_action' ? 'dismissed' : 'actioned',
        adminId: input.adminUserId,
        targetType: input.targetType,
        targetId: input.targetId,
      },
      tx,
    );
  });

  logger.info(
    {
      actionId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      adminUserId: input.adminUserId,
      enforced,
    },
    'moderation decision applied',
  );

  return {
    actionId,
    action: input.action,
    enforced,
    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
  };
}

/**
 * Carries out what the decision says.
 *
 * Returns a short description of what actually changed, which the caller logs
 * and returns — so "we suspended them" is a claim backed by a statement of what
 * the system did, not an assumption.
 */
async function enforce(
  tx: PoolConnection,
  input: DecisionInput,
  expiresAt: Date | null,
): Promise<string> {
  switch (input.action) {
    case 'no_action':
    case 'warning':
      // A warning is a message, not a restriction. It changes nothing about
      // what the account can do, and saying so plainly matters.
      return input.action === 'warning' ? 'recorded a warning' : 'nothing';

    case 'content_removal': {
      if (input.targetType === 'video') {
        const result = await execute(
          `UPDATE videos SET deleted_at = CURRENT_TIMESTAMP(3), status = 'removed'
            WHERE id = :id AND deleted_at IS NULL`,
          { id: input.targetId },
          tx,
        );
        return result.affectedRows > 0 ? 'removed the video' : 'the video was already removed';
      }
      if (input.targetType === 'comment') {
        const result = await execute(
          'UPDATE comments SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = :id AND deleted_at IS NULL',
          { id: input.targetId },
          tx,
        );
        return result.affectedRows > 0 ? 'removed the comment' : 'the comment was already removed';
      }
      throw new AppError('bad_request', `Content removal does not apply to a ${input.targetType}.`);
    }

    case 'restrict_distribution': {
      if (input.targetType !== 'video') {
        throw new AppError(
          'bad_request',
          'Distribution can only be restricted on a video.',
        );
      }
      // The video stays up and its owner keeps it; it stops being recommended.
      // That distinction matters — this is the proportionate response to
      // borderline content, and removing it would not be.
      //
      // `status = restricted` is the enforcement: the feed selects only
      // `published` rows, so a restricted video leaves recommendations while
      // remaining reachable by anyone who has its link.
      const restricted = await execute(
        `UPDATE videos SET status = 'restricted' WHERE id = :id AND status = 'published'`,
        { id: input.targetId },
        tx,
      );
      return restricted.affectedRows > 0
        ? 'stopped recommending the video'
        : 'the video was already restricted';
    }

    case 'temporary_restriction': {
      const userId = await resolveOwner(tx, input.targetType, input.targetId);
      await execute(
        "UPDATE users SET status = 'frozen' WHERE id = :id AND status = 'active'",
        { id: userId },
        tx,
      );
      return expiresAt
        ? `froze the account until ${expiresAt.toISOString()}`
        : 'froze the account';
    }

    case 'suspension': {
      const userId = await resolveOwner(tx, input.targetType, input.targetId);
      await execute(
        "UPDATE users SET status = 'suspended' WHERE id = :id AND status <> 'banned'",
        { id: userId },
        tx,
      );
      // Sessions are ended so the suspension takes effect now rather than when
      // the access token happens to expire.
      await execute(
        `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP(3)
          WHERE user_id = :id AND revoked_at IS NULL`,
        { id: userId },
        tx,
      );
      return 'suspended the account and ended its sessions';
    }

    case 'permanent_ban': {
      const userId = await resolveOwner(tx, input.targetType, input.targetId);
      await execute("UPDATE users SET status = 'banned' WHERE id = :id", { id: userId }, tx);
      await execute(
        `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP(3)
          WHERE user_id = :id AND revoked_at IS NULL`,
        { id: userId },
        tx,
      );
      // A ban does not delete anything. The account's content, wallet and
      // history stay exactly where they are — a ban is a loss of access, and
      // reversing one has to be possible.
      return 'banned the account and ended its sessions';
    }

    case 'reinstate': {
      const userId = await resolveOwner(tx, input.targetType, input.targetId);
      await execute(
        "UPDATE users SET status = 'active' WHERE id = :id AND status <> 'active'",
        { id: userId },
        tx,
      );
      return 'restored the account';
    }

    default:
      return 'nothing';
  }
}

/** The account behind a target, so an action on content can restrict its owner. */
async function resolveOwner(
  tx: PoolConnection,
  targetType: ReportTargetType,
  targetId: number,
): Promise<number> {
  if (targetType === 'user') return targetId;

  const table =
    targetType === 'video' ? 'videos' : targetType === 'comment' ? 'comments' : null;
  if (!table) {
    throw new AppError('bad_request', `Cannot resolve an account from a ${targetType}.`);
  }

  const row = await queryOne<{ user_id: number }>(
    `SELECT user_id FROM ${table} WHERE id = :id`,
    { id: targetId },
    tx,
  );
  if (!row) throw new AppError('not_found', 'The reported content was not found.');
  return row.user_id;
}

/**
 * Undoes a moderation action.
 *
 * Reverting restores what the action changed rather than only marking the row,
 * because a "reverted" suspension that leaves the account suspended is a lie
 * told to whoever reads the record next.
 */
export async function revert(
  adminUserId: number,
  actionId: number,
  reason: string,
): Promise<{ reverted: true; restored: string }> {
  const row = await queryOne<{
    id: number;
    target_type: ReportTargetType;
    target_id: number;
    action: ModerationAction;
    reverted_at: Date | null;
  }>(
    'SELECT id, target_type, target_id, action, reverted_at FROM moderation_actions WHERE id = :id',
    { id: actionId },
  );
  if (!row) throw new AppError('not_found', 'That action was not found.');
  if (row.reverted_at !== null) {
    throw new AppError('invalid_state_transition', 'That action has already been reverted.');
  }

  let restored = 'nothing';

  await transaction(async (tx) => {
    const claimed = await execute(
      'UPDATE moderation_actions SET reverted_at = CURRENT_TIMESTAMP(3) WHERE id = :id AND reverted_at IS NULL',
      { id: actionId },
      tx,
    );
    if (claimed.affectedRows === 0) {
      throw new AppError('invalid_state_transition', 'That action has already been reverted.');
    }

    switch (row.action) {
      case 'content_removal':
        if (row.target_type === 'video') {
          await execute(
            "UPDATE videos SET deleted_at = NULL, status = 'published' WHERE id = :id",
            { id: row.target_id },
            tx,
          );
          restored = 'restored the video';
        } else if (row.target_type === 'comment') {
          await execute('UPDATE comments SET deleted_at = NULL WHERE id = :id', {
            id: row.target_id,
          }, tx);
          restored = 'restored the comment';
        }
        break;

      case 'restrict_distribution':
        await execute(
          "UPDATE videos SET status = 'published' WHERE id = :id AND status = 'restricted'",
          { id: row.target_id },
          tx,
        );
        restored = 'resumed recommending the video';
        break;

      case 'temporary_restriction':
      case 'suspension':
      case 'permanent_ban': {
        const userId = await resolveOwner(tx, row.target_type, row.target_id);
        await execute("UPDATE users SET status = 'active' WHERE id = :id", { id: userId }, tx);
        restored = 'restored the account';
        break;
      }

      default:
        break;
    }

    await execute(
      `INSERT INTO moderation_actions
         (admin_id, target_type, target_id, action, reason)
       VALUES (:adminId, :targetType, :targetId, 'reinstate', :reason)`,
      {
        adminId: adminUserId,
        targetType: row.target_type,
        targetId: row.target_id,
        reason: `Reverted action ${actionId}: ${reason}`,
      },
      tx,
    );
  });

  logger.info({ actionId, adminUserId, restored }, 'moderation action reverted');
  return { reverted: true, restored };
}

/**
 * Lifts restrictions whose time has run out.
 *
 * A temporary restriction that nobody lifts is a permanent one, so this runs on
 * a schedule. Idempotent — an already-lifted action matches nothing.
 */
export async function expireRestrictions(now = new Date()): Promise<{ lifted: number }> {
  const due = await query<{ id: number; target_type: ReportTargetType; target_id: number }>(
    `SELECT id, target_type, target_id FROM moderation_actions
      WHERE expires_at IS NOT NULL
        AND expires_at <= :now
        AND reverted_at IS NULL
        AND action IN ('temporary_restriction', 'suspension')
      LIMIT 500`,
    { now },
  );

  let lifted = 0;
  for (const action of due) {
    try {
      await transaction(async (tx) => {
        const claimed = await execute(
          'UPDATE moderation_actions SET reverted_at = :now WHERE id = :id AND reverted_at IS NULL',
          { now, id: action.id },
          tx,
        );
        if (claimed.affectedRows === 0) return;

        const userId = await resolveOwner(tx, action.target_type, action.target_id);
        // Only lifts what this action imposed: a separately banned account is
        // not released because an unrelated suspension expired.
        await execute(
          "UPDATE users SET status = 'active' WHERE id = :id AND status IN ('suspended', 'frozen')",
          { id: userId },
          tx,
        );
        lifted += 1;
      });
    } catch (err) {
      logger.error({ err, actionId: action.id }, 'could not lift expired restriction');
    }
  }

  return { lifted };
}

/**
 * What the reporter is told.
 *
 * The outcome, and nothing else. Not who decided it, not what else that account
 * has done, not the internal note — a report is not a window into someone
 * else's record.
 */
export async function reporterOutcome(
  reporterId: number,
  reportPublicId: string,
): Promise<{ status: string; outcome: string }> {
  const row = await queryOne<{ status: string; target_type: string; target_id: number }>(
    `SELECT status, target_type, target_id FROM reports
      WHERE public_id = :publicId AND reporter_id = :reporterId AND deleted_at IS NULL`,
    { publicId: reportPublicId, reporterId },
  );
  if (!row) throw new AppError('not_found', 'Report not found.');

  if (row.status === 'pending' || row.status === 'reviewing') {
    return { status: row.status, outcome: 'This report is still being reviewed.' };
  }
  if (row.status === 'dismissed') {
    return {
      status: row.status,
      outcome: 'We reviewed this and did not find a breach of our guidelines.',
    };
  }

  return {
    status: row.status,
    outcome: 'We reviewed this and took action. Thank you for reporting it.',
  };
}
