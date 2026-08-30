/**
 * Transport contract — shared by the API, the mobile app and the admin panel.
 *
 * Every response on every route uses the same envelope. Clients therefore need
 * exactly one response handler and one error path, and adding a route can never
 * introduce a new error shape.
 */

/** Success envelope. `meta` carries pagination when the payload is a page. */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: PageMeta;
}

/** Failure envelope. Never carries `data`. */
export interface ApiFailure {
  ok: false;
  error: ApiError;
}

export interface ApiError {
  /** Stable, machine-readable. Clients branch on this, never on `message`. */
  code: ApiErrorCode;
  /** Human-readable, English, safe to log. Not for direct display — clients localise from `code`. */
  message: string;
  /** Field-level detail for validation failures: path → messages. */
  details?: Record<string, string[]>;
  /** Present when the caller may retry, in seconds. */
  retryAfter?: number;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const API_ERROR_CODES = [
  // 400
  'bad_request',
  'validation_failed',
  'idempotency_key_reused',
  // 401 / 403
  'unauthenticated',
  'token_expired',
  'token_invalid',
  'forbidden',
  'insufficient_permission',
  'account_suspended',
  'account_banned',
  // 404 / 409
  'not_found',
  'conflict',
  'already_exists',
  // 422 — money and state machines
  'insufficient_balance',
  'wallet_frozen',
  'wallet_not_payable',
  'below_minimum_amount',
  'monetization_not_enabled',
  'already_claimed',
  'task_not_complete',
  'invalid_state_transition',
  // 429
  'rate_limited',
  // 451
  'region_unavailable',
  // 500+
  'internal_error',
  'dependency_unavailable',
  'not_implemented',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Default HTTP status for each code. The server may not deviate from this map. */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  validation_failed: 400,
  idempotency_key_reused: 400,
  unauthenticated: 401,
  token_expired: 401,
  token_invalid: 401,
  forbidden: 403,
  insufficient_permission: 403,
  account_suspended: 403,
  account_banned: 403,
  not_found: 404,
  conflict: 409,
  already_exists: 409,
  insufficient_balance: 422,
  wallet_frozen: 422,
  wallet_not_payable: 422,
  below_minimum_amount: 422,
  monetization_not_enabled: 422,
  already_claimed: 422,
  task_not_complete: 422,
  invalid_state_transition: 422,
  rate_limited: 429,
  region_unavailable: 451,
  internal_error: 500,
  dependency_unavailable: 503,
  not_implemented: 501,
};

/**
 * Cursor pagination everywhere. Offsets are not used: the feed and every
 * activity list mutate constantly, and offsets duplicate or skip rows as they do.
 * A cursor is an opaque, server-signed string — clients must not parse it.
 */
export interface PageQuery {
  cursor?: string;
  limit?: number;
}

export interface PageMeta {
  /** Pass back as `cursor` for the next page. Absent means the end. */
  nextCursor?: string;
  hasMore: boolean;
  /**
   * True when the caller was shown a deliberately narrowed list rather than the
   * whole thing — a community roster served to a non-staff member (ADR-014).
   * The client must label such a list, never present it as complete.
   */
  restricted?: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 50;

/**
 * Every route that moves money requires this header. The server stores the key
 * against the resulting ledger row, so a retried request returns the original
 * result instead of charging twice (ADR-013).
 */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Helpers so the server never hand-builds an envelope. */
export const ok = <T>(data: T, meta?: PageMeta): ApiSuccess<T> =>
  meta ? { ok: true, data, meta } : { ok: true, data };

export const fail = (
  code: ApiErrorCode,
  message: string,
  extra?: Pick<ApiError, 'details' | 'retryAfter'>,
): ApiFailure => ({ ok: false, error: { code, message, ...extra } });

export const isSuccess = <T>(r: ApiResponse<T>): r is ApiSuccess<T> => r.ok;
