/**
 * Verification.
 *
 * People send identity documents here — passports, national ID cards, business
 * registrations. That single fact determines almost every decision in this file.
 *
 * **Documents are never returned to the client.** Not to the applicant, not in
 * a list, not as a URL. The only way to view one is a short-lived signed link
 * issued to a named reviewer for a named document, and issuing it is recorded.
 * A storage key in a JSON response is a permanent, shareable link to someone's
 * passport.
 *
 * **They are deleted when the decision is made.** A copy of an ID kept
 * indefinitely is a breach waiting for a date. The row survives so the decision
 * remains auditable; the file does not.
 *
 * **A verified badge is a statement the platform makes about a person.** It is
 * granted by a reviewer looking at evidence, never by a payment, a follower
 * count or a request.
 */

import { ulid } from 'ulid';
import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import { storage } from '../../core/storage.ts';
import { signMediaUrl } from '../../core/signed-url.ts';
import { recordSecurityEvent } from '../../core/security-log.ts';
import { assertOwnedKeys } from '../upload/upload.service.ts';
import type { Request } from 'express';

export type VerificationTier = 'individual' | 'creator' | 'business';
export type VerificationStatus = 'pending' | 'reviewing' | 'more_info' | 'approved' | 'rejected';

export interface VerificationRequest {
  id: string;
  tier: VerificationTier;
  status: VerificationStatus;
  note?: string;
  /** How many documents were submitted — never what or where they are. */
  documentCount: number;
  createdAt: string;
  decidedAt?: string;
}

interface RequestRow {
  public_id: string;
  tier: VerificationTier;
  status: VerificationStatus;
  note: string | null;
  created_at: Date;
  decided_at: Date | null;
  document_count: number;
}

function toRequest(row: RequestRow): VerificationRequest {
  const request: VerificationRequest = {
    id: row.public_id,
    tier: row.tier,
    status: row.status,
    documentCount: Number(row.document_count),
    createdAt: new Date(row.created_at).toISOString(),
  };
  // The note is written for the applicant — "we could not read the date of
  // birth" — so it is theirs to see.
  if (row.note) request.note = row.note;
  if (row.decided_at) request.decidedAt = new Date(row.decided_at).toISOString();
  return request;
}

const REQUEST_SELECT = `
  SELECT r.public_id, r.tier, r.status, r.note, r.created_at, r.decided_at,
         (SELECT COUNT(*) FROM verification_documents d
           WHERE d.request_id = r.id AND d.deleted_at IS NULL) AS document_count
    FROM verification_requests r
   WHERE r.deleted_at IS NULL
`;

/**
 * Submits a verification request.
 *
 * One open request at a time. Someone who submits five is not five times more
 * verified; they are a reviewer's afternoon.
 */
export async function submitRequest(
  userId: number,
  input: { tier: VerificationTier; documentKeys: string[] },
): Promise<VerificationRequest> {
  const open = await queryOne<{ public_id: string }>(
    `SELECT public_id FROM verification_requests
      WHERE user_id = :userId AND deleted_at IS NULL
        AND status IN ('pending', 'reviewing', 'more_info')
      LIMIT 1`,
    { userId },
  );
  if (open) {
    throw new AppError(
      'invalid_state_transition',
      'You already have a verification request being reviewed.',
    );
  }

  if (input.documentKeys.length === 0) {
    throw new AppError('bad_request', 'At least one document is needed.');
  }
  if (input.documentKeys.length > 5) {
    throw new AppError('bad_request', 'Send at most five documents.');
  }

  // Every key must belong to this user's own completed uploads. Without this
  // an applicant could reference somebody else's storage key and have a
  // reviewer open a stranger's document.
  await assertOwnedKeys(userId, input.documentKeys);

  const publicId = ulid();

  await transaction(async (tx) => {
    const result = await execute(
      `INSERT INTO verification_requests (public_id, user_id, tier, status)
       VALUES (:publicId, :userId, :tier, 'pending')`,
      { publicId, userId, tier: input.tier },
      tx,
    );

    for (const key of input.documentKeys) {
      await execute(
        `INSERT INTO verification_documents (request_id, kind, storage_key)
         VALUES (:requestId, :kind, :key)`,
        { requestId: result.insertId, kind: 'identity', key },
        tx,
      );
    }
  });

  logger.info({ publicId, userId, tier: input.tier }, 'verification requested');

  const row = await queryOne<RequestRow>(`${REQUEST_SELECT} AND r.public_id = :publicId`, {
    publicId,
  });
  if (!row) throw new AppError('internal_error', 'The request could not be read back.');
  return toRequest(row);
}

/** The applicant's own requests. Counts only — never the documents themselves. */
export async function myRequests(userId: number): Promise<VerificationRequest[]> {
  const rows = await query<RequestRow>(
    `${REQUEST_SELECT} AND r.user_id = :userId ORDER BY r.created_at DESC LIMIT 20`,
    { userId },
  );
  return rows.map(toRequest);
}

export interface QueuedRequest extends VerificationRequest {
  username: string;
  displayName: string;
  followers: number;
  accountCreatedAt: string;
  /** Document ids a reviewer can request a viewing link for. */
  documentIds: string[];
}

/** The review queue. Still no document contents — only their ids. */
export async function reviewQueue(limit = 100): Promise<QueuedRequest[]> {
  const rows = await query<
    RequestRow & {
      id: number;
      username: string;
      display_name: string;
      follower_count: number;
      account_created: Date;
    }
  >(
    `SELECT r.id, r.public_id, r.tier, r.status, r.note, r.created_at, r.decided_at,
            u.username, u.created_at AS account_created,
            p.display_name, p.follower_count,
            (SELECT COUNT(*) FROM verification_documents d
              WHERE d.request_id = r.id AND d.deleted_at IS NULL) AS document_count
       FROM verification_requests r
       JOIN users u ON u.id = r.user_id
       JOIN user_profiles p ON p.user_id = r.user_id
      WHERE r.deleted_at IS NULL
        AND r.status IN ('pending', 'reviewing', 'more_info')
      ORDER BY r.created_at
      LIMIT :limit`,
    { limit },
  );
  if (rows.length === 0) return [];

  const docs = await query<{ id: number; request_id: number }>(
    `SELECT id, request_id FROM verification_documents
      WHERE request_id IN (${rows.map(() => '?').join(',')}) AND deleted_at IS NULL`,
    rows.map((r) => r.id),
  );
  const byRequest = new Map<number, string[]>();
  for (const doc of docs) {
    const list = byRequest.get(doc.request_id) ?? [];
    list.push(String(doc.id));
    byRequest.set(doc.request_id, list);
  }

  return rows.map((row) => ({
    ...toRequest(row),
    username: row.username,
    displayName: row.display_name,
    followers: Number(row.follower_count),
    accountCreatedAt: new Date(row.account_created).toISOString(),
    documentIds: byRequest.get(row.id) ?? [],
  }));
}

/**
 * Issues a short-lived link to one document, for one reviewer.
 *
 * This is the only way a document is ever readable, and every issue is written
 * to the security log with the reviewer's id. Looking at someone's passport
 * should leave a trace that names who looked.
 */
export async function documentViewingLink(
  req: Request,
  adminUserId: number,
  documentId: number,
): Promise<{ url: string; expiresInSeconds: number }> {
  const doc = await queryOne<{ storage_key: string; request_id: number; user_id: number }>(
    `SELECT d.storage_key, d.request_id, r.user_id
       FROM verification_documents d
       JOIN verification_requests r ON r.id = d.request_id
      WHERE d.id = :id AND d.deleted_at IS NULL AND r.deleted_at IS NULL`,
    { id: documentId },
  );
  if (!doc) throw new AppError('not_found', 'That document is no longer available.');

  // Five minutes: long enough to open and read, short enough that a link
  // pasted into a chat is dead before anyone follows it. Signed to the
  // reviewer, so it is not transferable to a colleague either.
  const expiresInSeconds = 300;
  const url = signMediaUrl(doc.storage_key, `admin:${adminUserId}`, expiresInSeconds);

  await recordSecurityEvent(req, {
    userId: doc.user_id,
    event: 'verification_document_viewed',
    detail: `Reviewer ${adminUserId} opened document ${documentId}.`,
  });

  logger.info(
    { adminUserId, documentId, subjectUserId: doc.user_id },
    'verification document viewing link issued',
  );

  return { url, expiresInSeconds };
}

/**
 * A reviewer's decision.
 *
 * Approving sets the badge. Rejecting or asking for more information does not.
 * Either way the documents are destroyed once the decision is final — there is
 * no reason to keep an identity document after the question it answered has
 * been answered.
 */
export async function decide(
  adminUserId: number,
  publicId: string,
  decision: 'approved' | 'rejected' | 'more_info',
  note: string,
): Promise<VerificationRequest> {
  const row = await queryOne<{ id: number; user_id: number; tier: VerificationTier; status: string }>(
    `SELECT id, user_id, tier, status FROM verification_requests
      WHERE public_id = :publicId AND deleted_at IS NULL`,
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Request not found.');
  if (row.status === 'approved' || row.status === 'rejected') {
    throw new AppError('invalid_state_transition', 'That request has already been decided.');
  }

  await transaction(async (tx) => {
    const claimed = await execute(
      `UPDATE verification_requests
          SET status = :status, note = :note, decided_by = :adminId,
              decided_at = CURRENT_TIMESTAMP(3)
        WHERE id = :id AND status IN ('pending', 'reviewing', 'more_info')`,
      { status: decision, note, adminId: adminUserId, id: row.id },
      tx,
    );
    if (claimed.affectedRows === 0) {
      throw new AppError('invalid_state_transition', 'That request has already been decided.');
    }

    if (decision === 'approved') {
      await execute('UPDATE users SET verification_tier = :tier WHERE id = :userId', {
        tier: row.tier,
        userId: row.user_id,
      }, tx);
    }

    // `more_info` keeps the documents, because the applicant is being asked to
    // add to them. A final decision does not need them any more.
    if (decision !== 'more_info') {
      await execute(
        `UPDATE verification_documents SET deleted_at = CURRENT_TIMESTAMP(3)
          WHERE request_id = :requestId AND deleted_at IS NULL`,
        { requestId: row.id },
        tx,
      );
    }
  });

  // Deleting the rows is the record; deleting the files is the point. Done
  // outside the transaction because object storage is not transactional, and a
  // file that outlives its row is caught by the sweep below.
  if (decision !== 'more_info') {
    const keys = await query<{ storage_key: string }>(
      'SELECT storage_key FROM verification_documents WHERE request_id = :requestId',
      { requestId: row.id },
    );
    for (const doc of keys) {
      await storage.remove(doc.storage_key).catch((err: unknown) => {
        logger.error({ err, key: doc.storage_key }, 'could not delete a verification document');
      });
    }
  }

  logger.info({ publicId, decision, adminUserId }, 'verification decided');

  const updated = await queryOne<RequestRow>(`${REQUEST_SELECT} AND r.public_id = :publicId`, {
    publicId,
  });
  if (!updated) throw new AppError('internal_error', 'The request could not be read back.');
  return toRequest(updated);
}

/**
 * Removes documents whose files outlived their rows.
 *
 * Object storage is not transactional, so a delete can fail after the row was
 * marked. This sweep is what makes "documents are destroyed on decision" true
 * rather than usually true. Safe to run repeatedly.
 */
export async function sweepOrphanedDocuments(): Promise<{ removed: number }> {
  const orphans = await query<{ id: number; storage_key: string }>(
    `SELECT id, storage_key FROM verification_documents
      WHERE deleted_at IS NOT NULL
        AND deleted_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)
        AND storage_key <> ''
      LIMIT 500`,
  );

  let removed = 0;
  for (const doc of orphans) {
    try {
      await storage.remove(doc.storage_key);
      // The key is cleared so a later sweep does not try again, and so the row
      // stops naming a file that no longer exists.
      await execute("UPDATE verification_documents SET storage_key = '' WHERE id = :id", {
        id: doc.id,
      });
      removed += 1;
    } catch (err) {
      logger.warn({ err, key: doc.storage_key }, 'orphaned document could not be removed');
    }
  }

  return { removed };
}

/**
 * Removes a badge.
 *
 * Verification is a statement the platform makes; when it stops being true the
 * statement has to be withdrawn. Separate from moderation because it is not a
 * punishment — an account can lose a business badge by ceasing to be a
 * business.
 */
export async function revokeBadge(
  adminUserId: number,
  username: string,
  reason: string,
): Promise<{ revoked: true }> {
  const user = await queryOne<{ id: number; verification_tier: string }>(
    'SELECT id, verification_tier FROM users WHERE username = :username AND deleted_at IS NULL',
    { username: username.toLowerCase() },
  );
  if (!user) throw new AppError('not_found', 'Account not found.');
  if (user.verification_tier === 'none') {
    throw new AppError('invalid_state_transition', 'That account is not verified.');
  }

  await execute("UPDATE users SET verification_tier = 'none' WHERE id = :id", { id: user.id });

  logger.info({ adminUserId, username, reason }, 'verification badge revoked');
  return { revoked: true };
}
