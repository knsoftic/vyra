/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 * Express 5 forwards rejections automatically, but wrapping keeps the typing
 * explicit and means handlers never need a try/catch purely to call `next(err)`.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AsyncHandler<Req extends Request = Request> = (
  req: Req,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export const asyncHandler =
  <Req extends Request = Request>(fn: AsyncHandler<Req>): RequestHandler =>
  (req, res, next) => {
    void fn(req as Req, res, next).catch(next);
  };
