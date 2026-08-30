/**
 * The one error type the application throws.
 *
 * Handlers throw `AppError`; the error middleware turns it into the shared
 * envelope. Nothing else in the codebase writes an error response by hand, so
 * every failure the clients see has the same shape and a stable code.
 */

import { ERROR_STATUS, type ApiErrorCode } from '../../../shared/contracts/http.ts';

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;
  readonly retryAfter?: number;
  /** True when the message is safe to show a user. Otherwise it is logged only. */
  readonly expose: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { details?: Record<string, string[]>; retryAfter?: number; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    if (opts.details) this.details = opts.details;
    if (opts.retryAfter !== undefined) this.retryAfter = opts.retryAfter;
    this.expose = this.status < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

/** Shorthands for the codes used most often. */
export const errors = {
  notFound: (what = 'Resource') => new AppError('not_found', `${what} not found.`),
  unauthenticated: (msg = 'Authentication required.') => new AppError('unauthenticated', msg),
  forbidden: (msg = 'You do not have access to this resource.') => new AppError('forbidden', msg),
  validation: (details: Record<string, string[]>) =>
    new AppError('validation_failed', 'The request failed validation.', { details }),
  conflict: (msg: string) => new AppError('conflict', msg),
  insufficientBalance: (msg = 'Not enough balance for this operation.') =>
    new AppError('insufficient_balance', msg),
  internal: (msg = 'Something went wrong on our end.', cause?: unknown) =>
    new AppError('internal_error', msg, { cause }),
} as const;

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
