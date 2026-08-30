/**
 * The single place an error becomes a response.
 *
 * 5xx details are logged but never sent: an internal message can leak a table
 * name, a file path or a query. Clients get the stable code and a neutral
 * message, plus a request id they can quote to support.
 */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { isAppError, AppError } from '../core/errors.ts';
import { logger } from '../core/logger.ts';
import { config } from '../core/config.ts';
import { ERROR_STATUS, type ApiFailure } from '../../../shared/contracts/http.ts';

/** Anything that reaches here matched no route. */
export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiFailure = {
    ok: false,
    error: { code: 'not_found', message: `No route matches ${req.method} ${req.path}.` },
  };
  res.status(404).json(body);
};

function fromZod(err: ZodError): AppError {
  const details: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    (details[path] ??= []).push(issue.message);
  }
  return new AppError('validation_failed', 'The request failed validation.', { details });
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = res.getHeader('x-request-id');
  const appErr = isAppError(err)
    ? err
    : err instanceof ZodError
      ? fromZod(err)
      : new AppError('internal_error', 'Something went wrong on our end.', { cause: err });

  const logPayload = {
    err,
    requestId,
    method: req.method,
    path: req.path,
    code: appErr.code,
    userId: (req as { userId?: number }).userId,
  };

  if (appErr.status >= 500) logger.error(logPayload, appErr.message);
  else logger.warn(logPayload, appErr.message);

  const body: ApiFailure = {
    ok: false,
    error: {
      code: appErr.code,
      // Internal messages stay in the logs.
      message: appErr.expose ? appErr.message : 'Something went wrong on our end.',
      ...(appErr.details ? { details: appErr.details } : {}),
      ...(appErr.retryAfter !== undefined ? { retryAfter: appErr.retryAfter } : {}),
    },
  };

  // A stack in a response is an information leak in production, and the single
  // most useful thing to have in development.
  if (!config.isProduction && appErr.status >= 500 && err instanceof Error) {
    (body.error as unknown as Record<string, unknown>).stack = err.stack;
  }

  if (appErr.retryAfter !== undefined) res.setHeader('retry-after', String(appErr.retryAfter));
  res.status(appErr.status || ERROR_STATUS.internal_error).json(body);
};
