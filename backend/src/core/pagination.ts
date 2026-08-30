/**
 * Cursor pagination.
 *
 * A cursor is a base64url payload carrying the sort position plus an HMAC. The
 * signature means a client cannot hand-craft one to page through data it should
 * not see, and a cursor issued for one query cannot be replayed against another.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';
import { AppError } from './errors.ts';
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, type Page } from '../../../shared/contracts/http.ts';

export interface CursorPayload {
  /** Primary sort value — usually a timestamp in ms or a score. */
  k: string | number;
  /** Tiebreaker id, so rows sharing a sort value paginate deterministically. */
  id: string;
  /** Scope tag; a cursor from the "for_you" feed is rejected by "following". */
  s: string;
}

function sign(body: string): string {
  return createHmac('sha256', config.JWT_ACCESS_SECRET).update(body).digest('base64url');
}

export function encodeCursor(payload: CursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function decodeCursor(cursor: string, scope: string): CursorPayload {
  const [body, mac] = cursor.split('.');
  if (!body || !mac) throw new AppError('bad_request', 'Malformed pagination cursor.');

  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('bad_request', 'Invalid pagination cursor.');
  }

  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload;
  } catch {
    throw new AppError('bad_request', 'Malformed pagination cursor.');
  }

  if (payload.s !== scope) {
    throw new AppError('bad_request', 'This cursor belongs to a different query.');
  }
  return payload;
}

export function normaliseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return PAGE_LIMIT_DEFAULT;
  return Math.min(Math.floor(n), PAGE_LIMIT_MAX);
}

/**
 * Builds a page from `limit + 1` rows: the extra row proves there is a next page
 * without a second COUNT query.
 */
export function buildPage<T>(
  rows: T[],
  limit: number,
  scope: string,
  cursorOf: (row: T) => CursorPayload,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const page: Page<T> = { items, hasMore };
  if (hasMore && last !== undefined) {
    page.nextCursor = encodeCursor({ ...cursorOf(last), s: scope });
  }
  return page;
}
