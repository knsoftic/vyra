/**
 * Drafts.
 *
 * PHASE_04 is explicit: drafts are stored server-side as well as locally, they
 * are private, and **they survive app updates — never cleared by a version
 * upgrade or cache purge**. That requirement is the reason they live in the
 * database at all. A draft held only in app storage dies with a reinstall, and
 * losing someone's unfinished video is the kind of thing people do not forgive.
 *
 * Consistent with the project's standing rule, deleting a draft is a soft delete.
 * Nothing here issues a `DELETE`.
 */

import { ulid } from 'ulid';
import { execute, query, queryOne } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { storage } from '../../core/storage.ts';
import { buildPage, decodeCursor, normaliseLimit } from '../../core/pagination.ts';
import { timelineDurationMs } from '../creative/edl.ts';
import type { EditDecisionList, VideoDraft } from '../../../../shared/contracts/creative.ts';
import type { Page } from '../../../../shared/contracts/http.ts';

const MAX_DRAFTS_PER_USER = 200;

interface DraftRow {
  id: number;
  public_id: string;
  user_id: number;
  caption: string;
  edit_list: string;
  clip_count: number;
  duration_sec: number;
  cover_key: string | null;
  created_at: Date;
  updated_at: Date;
}

function parseEditList(raw: string): EditDecisionList {
  try {
    return JSON.parse(raw) as EditDecisionList;
  } catch {
    // A corrupt edit list must not make the whole drafts list unreadable.
    return {
      version: 1, clips: [], effects: [], texts: [], stickers: [], audio: [], aspect: '9:16',
    };
  }
}

function toDraft(row: DraftRow): VideoDraft {
  const draft: VideoDraft = {
    id: row.public_id,
    caption: row.caption,
    durationSec: Number(row.duration_sec),
    clipCount: Number(row.clip_count),
    editList: parseEditList(row.edit_list),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
  if (row.cover_key) draft.coverUrl = storage.url(row.cover_key);
  return draft;
}

export interface SaveDraftInput {
  id?: string;
  caption?: string;
  coverKey?: string;
  editList: EditDecisionList;
}

/**
 * Creates or updates a draft.
 *
 * Update is scoped by user id as well as public id, so knowing another user's
 * draft id is not enough to overwrite it.
 */
export async function saveDraft(userId: number, input: SaveDraftInput): Promise<VideoDraft> {
  const durationSec = Math.round(timelineDurationMs(input.editList) / 1000);
  const clipCount = input.editList.clips.length;
  const editList = JSON.stringify(input.editList);
  const caption = (input.caption ?? '').slice(0, 2200);

  if (input.id) {
    const existing = await queryOne<DraftRow>(
      'SELECT * FROM video_drafts WHERE public_id = :publicId AND user_id = :userId AND deleted_at IS NULL',
      { publicId: input.id, userId },
    );
    if (!existing) throw new AppError('not_found', 'Draft not found.');

    await execute(
      `UPDATE video_drafts
          SET caption = :caption, edit_list = :editList, clip_count = :clipCount,
              duration_sec = :durationSec, cover_key = COALESCE(:coverKey, cover_key)
        WHERE id = :id`,
      {
        id: existing.id,
        caption,
        editList,
        clipCount,
        durationSec,
        coverKey: input.coverKey ?? null,
      },
    );
    return getDraft(userId, input.id);
  }

  const count = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM video_drafts WHERE user_id = :userId AND deleted_at IS NULL',
    { userId },
  );
  if (Number(count?.c ?? 0) >= MAX_DRAFTS_PER_USER) {
    throw new AppError(
      'conflict',
      `You have reached the maximum of ${MAX_DRAFTS_PER_USER} drafts. Publish or remove one to save another.`,
    );
  }

  const publicId = ulid();
  await execute(
    `INSERT INTO video_drafts
       (public_id, user_id, caption, edit_list, clip_count, duration_sec, cover_key)
     VALUES (:publicId, :userId, :caption, :editList, :clipCount, :durationSec, :coverKey)`,
    { publicId, userId, caption, editList, clipCount, durationSec, coverKey: input.coverKey ?? null },
  );

  return getDraft(userId, publicId);
}

export async function getDraft(userId: number, publicId: string): Promise<VideoDraft> {
  const row = await queryOne<DraftRow>(
    'SELECT * FROM video_drafts WHERE public_id = :publicId AND user_id = :userId AND deleted_at IS NULL',
    { publicId, userId },
  );
  if (!row) throw new AppError('not_found', 'Draft not found.');
  return toDraft(row);
}

export async function listDrafts(
  userId: number,
  cursor: string | undefined,
  limitRaw: unknown,
): Promise<Page<VideoDraft>> {
  const limit = normaliseLimit(limitRaw);
  const scope = `drafts:${userId}`;
  const after = cursor ? decodeCursor(cursor, scope) : undefined;

  const rows = await query<DraftRow>(
    `SELECT * FROM video_drafts
      WHERE user_id = :userId AND deleted_at IS NULL
        ${after ? 'AND updated_at < :afterAt' : ''}
      ORDER BY updated_at DESC
      LIMIT :limit`,
    {
      userId,
      limit: limit + 1,
      ...(after ? { afterAt: new Date(Number(after.k)) } : {}),
    },
  );

  const page = buildPage(rows, limit, scope, (row) => ({
    k: new Date(row.updated_at).getTime(),
    id: row.public_id,
    s: scope,
  }));

  return {
    items: page.items.map(toDraft),
    hasMore: page.hasMore,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

/** Soft delete. The row stays so an accidental removal can be reversed. */
export async function deleteDraft(userId: number, publicId: string): Promise<void> {
  const result = await execute(
    `UPDATE video_drafts SET deleted_at = NOW(3)
      WHERE public_id = :publicId AND user_id = :userId AND deleted_at IS NULL`,
    { publicId, userId },
  );
  if (result.affectedRows === 0) throw new AppError('not_found', 'Draft not found.');
}

/** Called after a draft has been published, so it leaves the drafts list. */
export async function consumeDraft(userId: number, publicId: string): Promise<void> {
  await execute(
    `UPDATE video_drafts SET deleted_at = NOW(3)
      WHERE public_id = :publicId AND user_id = :userId AND deleted_at IS NULL`,
    { publicId, userId },
  );
}
