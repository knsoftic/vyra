/**
 * Idempotency for money routes.
 *
 * A retried request — a flaky connection, an impatient double-tap — must not
 * charge twice. The first request stores its response against the key; a repeat
 * with the same key returns that stored response without re-executing.
 *
 * Reusing a key with a *different* body is rejected outright, because that means
 * the client has a bug and honouring either interpretation would be wrong.
 *
 * **The header is always required**, whatever the cache is doing. That is the
 * part clients must not be able to skip.
 *
 * **What happens when Redis is unavailable depends on the route.** ADR-020 made
 * this layer fail closed, which is right when it is the only protection: better
 * to refuse than to risk a double charge. But an operation that carries its own
 * durable idempotency key in the database is already protected, and refusing it
 * makes the product unavailable to guard against something that cannot happen.
 * So a route declares which it is, at the point it is mounted, where the
 * decision is visible.
 *
 * Either way the wait is bounded. The original implementation called Redis with
 * no timeout, so a dead cache added its full connect-retry backoff — about
 * twelve seconds — to every money request before failing.
 */

import { createHash } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { redis, keys } from '../core/redis.ts';
import { AppError } from '../core/errors.ts';
import { logger } from '../core/logger.ts';
import { withTimeout } from '../core/timeout.ts';
import { IDEMPOTENCY_HEADER } from '../../../shared/contracts/http.ts';
import { currentUserId } from './auth.ts';

const TTL_SECONDS = 24 * 60 * 60;
/** A replay lookup that takes longer than this is not worth waiting for. */
const LOOKUP_TIMEOUT_MS = 250;

interface StoredResult {
  fingerprint: string;
  status: number;
  body: unknown;
}

const fingerprintOf = (body: unknown): string =>
  createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');

export interface IdempotencyOptions {
  /**
   * True when the handler enforces idempotency itself, in the database.
   *
   * Such a route continues when the cache is unreachable — the guarantee has
   * not gone anywhere. Leave it false for a handler whose only protection is
   * this middleware.
   */
  durable?: boolean;
}

export function idempotency(options: IdempotencyOptions = {}): RequestHandler {
  const { durable = false } = options;

  return (req, res, next) => {
    const key = req.header(IDEMPOTENCY_HEADER);
    if (!key) {
      next(
        new AppError(
          'bad_request',
          `This request must include an ${IDEMPOTENCY_HEADER} header so a retry cannot be charged twice.`,
        ),
      );
      return;
    }

    const userId = currentUserId(req);
    if (userId === undefined) {
      next(new AppError('unauthenticated', 'Authentication required.'));
      return;
    }

    const cacheKey = keys.idempotency(String(userId), key);
    const fingerprint = fingerprintOf(req.body);

    void withTimeout(redis.get(cacheKey), LOOKUP_TIMEOUT_MS, 'idempotency lookup')
      .then((raw) => {
        if (raw) {
          const stored = JSON.parse(raw) as StoredResult;
          if (stored.fingerprint !== fingerprint) {
            throw new AppError(
              'idempotency_key_reused',
              'This idempotency key was already used for a different request.',
            );
          }
          // Replay the original outcome verbatim.
          res.status(stored.status).json(stored.body);
          return;
        }

        capture(res, cacheKey, fingerprint);
        next();
      })
      .catch((err: unknown) => {
        // A reused key is a client bug, not a cache failure — never swallowed.
        if (err instanceof AppError) {
          next(err);
          return;
        }

        if (!durable) {
          logger.error({ err, cacheKey }, 'idempotency store unreachable — refusing money request');
          next(
            new AppError(
              'dependency_unavailable',
              'This request cannot be processed safely right now. Please try again.',
            ),
          );
          return;
        }

        logger.warn(
          { err, cacheKey },
          'idempotency store unreachable — continuing on the handler own database key',
        );
        capture(res, cacheKey, fingerprint);
        next();
      });
  };
}

/** Stores the response so a later retry can replay it. */
function capture(res: Response, cacheKey: string, fingerprint: string): void {
  const originalJson = res.json.bind(res) as Response['json'];
  res.json = ((body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const payload: StoredResult = { fingerprint, status: res.statusCode, body };
      void withTimeout(
        redis.setex(cacheKey, TTL_SECONDS, JSON.stringify(payload)),
        LOOKUP_TIMEOUT_MS,
        'idempotency store',
      ).catch((err: unknown) => logger.warn({ err, cacheKey }, 'could not store idempotent response'));
    }
    return originalJson(body);
  }) as Response['json'];
}

/**
 * The default: this middleware is the only protection, so it fails closed.
 * Mount on every route in IDEMPOTENT_ROUTES that does not carry its own key.
 */
export const idempotent: RequestHandler = idempotency();
