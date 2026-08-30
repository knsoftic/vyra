/**
 * Rate limiting, backed by Redis so the limit holds across every API instance.
 *
 * Uses a fixed window with an atomic INCR + EXPIRE. Simple, and correct under
 * concurrency because both operations run in one pipeline against one key.
 *
 * Limits are keyed by user where possible and by IP otherwise, so one abusive
 * client cannot exhaust the quota of everyone behind the same NAT.
 */

import type { Request, RequestHandler } from 'express';
import { redis, keys } from '../core/redis.ts';
import { config } from '../core/config.ts';
import { AppError } from '../core/errors.ts';
import { logger } from '../core/logger.ts';
import { withTimeout } from '../core/timeout.ts';
import { currentUserId } from './auth.ts';

export interface RateLimitOptions {
  /** Namespace, so two routes never share a counter. */
  bucket: string;
  limit: number;
  windowSeconds: number;
  /** Override the identity used for the counter. */
  keyBy?: (req: Request) => string;
}

const identify = (req: Request): string => {
  const userId = currentUserId(req);
  if (userId !== undefined) return `u:${userId}`;
  return `ip:${req.ip ?? 'unknown'}`;
};


/** Consecutive limiter failures before Redis is skipped entirely. */
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;
/** A limiter that has not answered in this long is not worth waiting for. */
const CHECK_TIMEOUT_MS = 150;

let consecutiveFailures = 0;
let openedAt = 0;

function breakerIsOpen(): boolean {
  if (openedAt === 0) return false;
  if (Date.now() - openedAt < COOLDOWN_MS) return true;
  openedAt = 0;
  consecutiveFailures = 0;
  return false;
}

type LimiterReplies = [Error | null, unknown][] | null;

/**
 * Runs the counter pipeline, bounded, and gives up entirely once Redis has
 * failed repeatedly. Returning null means "no limit information" — the caller
 * then allows the request.
 */
async function limiterCheck(key: string, windowSeconds: number): Promise<LimiterReplies> {
  if (breakerIsOpen()) return null;

  try {
    const replies = await withTimeout(
      redis.multi().incr(key).expire(key, windowSeconds, 'NX').ttl(key).exec(),
      CHECK_TIMEOUT_MS,
      'rate limit',
    );
    if (consecutiveFailures > 0 || openedAt !== 0) {
      logger.info('rate limiter is counting again');
    }
    consecutiveFailures = 0;
    openedAt = 0;
    return replies as LimiterReplies;
  } catch (err) {
    consecutiveFailures += 1;
    if (consecutiveFailures >= FAILURE_THRESHOLD && openedAt === 0) {
      openedAt = Date.now();
      logger.warn(
        { err, cooldownMs: COOLDOWN_MS },
        'rate limiter unreachable — failing open until the cooldown elapses',
      );
    }
    return null;
  }
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    if (!config.RATE_LIMIT_ENABLED) return next();

    const id = (opts.keyBy ?? identify)(req);
    const key = keys.rateLimit(opts.bucket, id);

    // Bounded and breaker-aware, for the same reason the cache is (ADR-023):
    // ioredis retries with backoff, so an unreachable server turns a limiter
    // check into a ten-second stall on every request. Catching the error is not
    // enough — the time is already spent. A limiter that cannot count must fail
    // open *quickly*, not eventually.
    void limiterCheck(key, opts.windowSeconds)
      .then((replies) => {
        if (replies === null) {
          next();
          return;
        }
        const count = Number(replies[0]?.[1] ?? 0);
        const ttl = Number(replies[2]?.[1] ?? opts.windowSeconds);
        const remaining = Math.max(0, opts.limit - count);

        res.setHeader('x-ratelimit-limit', String(opts.limit));
        res.setHeader('x-ratelimit-remaining', String(remaining));
        res.setHeader('x-ratelimit-reset', String(ttl));

        if (count > opts.limit) {
          next(
            new AppError('rate_limited', 'Too many requests. Please slow down.', {
              retryAfter: ttl > 0 ? ttl : opts.windowSeconds,
            }),
          );
          return;
        }
        next();
      })
      .catch((err: unknown) => {
        // Redis being unavailable must not take the API down with it. Log and
        // allow — a brief unlimited window beats a total outage.
        logger.debug({ err, bucket: opts.bucket }, 'rate limit check skipped');
        next();
      });
  };
}

/** Presets. Tight on anything that costs money or sends a message. */
export const limits = {
  auth: rateLimit({ bucket: 'auth', limit: 10, windowSeconds: 60 }),
  otp: rateLimit({ bucket: 'otp', limit: 5, windowSeconds: 300 }),
  read: rateLimit({ bucket: 'read', limit: 300, windowSeconds: 60 }),
  write: rateLimit({ bucket: 'write', limit: 60, windowSeconds: 60 }),
  upload: rateLimit({ bucket: 'upload', limit: 20, windowSeconds: 3600 }),
  money: rateLimit({ bucket: 'money', limit: 20, windowSeconds: 60 }),
  message: rateLimit({ bucket: 'message', limit: 120, windowSeconds: 60 }),
  signals: rateLimit({ bucket: 'signals', limit: 600, windowSeconds: 60 }),
} as const;
