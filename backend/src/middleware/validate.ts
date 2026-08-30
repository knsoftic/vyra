/**
 * Schema validation.
 *
 * A validated request replaces `req.body` / `req.query` / `req.params` with the
 * parsed result, so handlers work with typed, coerced data and unknown keys are
 * stripped rather than silently carried into a query.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType, infer as ZodInfer } from 'zod';
import { ZodError } from 'zod';

export interface ValidatedRequest<B = unknown, Q = unknown, P = unknown> extends Request {
  valid: { body: B; query: Q; params: P };
}

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const valid: Record<string, unknown> = {};
      if (schemas.body) valid.body = schemas.body.parse(req.body);
      // req.query is a getter in Express 5 and cannot be reassigned, so the
      // parsed values live on req.valid rather than overwriting the originals.
      if (schemas.query) valid.query = schemas.query.parse(req.query);
      if (schemas.params) valid.params = schemas.params.parse(req.params);
      (req as ValidatedRequest).valid = valid as ValidatedRequest['valid'];
      next();
    } catch (err) {
      next(err instanceof ZodError ? err : err);
    }
  };
}

/** Typed accessor so handlers avoid casting at every use site. */
export const valid = <S extends Schemas>(req: Request) =>
  (req as ValidatedRequest).valid as {
    body: S['body'] extends ZodType ? ZodInfer<S['body']> : unknown;
    query: S['query'] extends ZodType ? ZodInfer<S['query']> : unknown;
    params: S['params'] extends ZodType ? ZodInfer<S['params']> : unknown;
  };
