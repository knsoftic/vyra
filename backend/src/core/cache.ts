/**
 * Cache access with a circuit breaker.
 *
 * Redis is a cache and a rate-limit counter, never a system of record — so when
 * it is unavailable the application must degrade to "no cache", not to "slow".
 *
 * Two problems make that harder than it sounds. First, ioredis retries with
 * backoff, so a single `get` against a dead server can take ten seconds or more
 * before it rejects; catching the error is not enough, because the time is
 * already spent. Second, every call pays that cost independently, so an outage
 * turns a fast path into a crawl.
 *
 * This module solves both: every operation is bounded by a short timeout, and
 * after a few consecutive failures the breaker opens and calls return
 * immediately without touching Redis at all. A single probe after the cooldown
 * closes it again once Redis is back.
 */

import { redis } from './redis.ts';
import { logger } from './logger.ts';
import { withTimeout } from './timeout.ts';

/** A cache lookup that takes longer than this is not worth waiting for. */
const OPERATION_TIMEOUT_MS = 250;
/** Consecutive failures before the breaker opens. */
const FAILURE_THRESHOLD = 3;
/** How long to skip Redis entirely once the breaker is open. */
const COOLDOWN_MS = 30_000;

let consecutiveFailures = 0;
let openedAt = 0;

function breakerIsOpen(): boolean {
  if (openedAt === 0) return false;
  if (Date.now() - openedAt < COOLDOWN_MS) return true;
  // Cooldown elapsed: half-open, so the next call probes the connection.
  openedAt = 0;
  consecutiveFailures = 0;
  return false;
}

function recordSuccess(): void {
  if (consecutiveFailures > 0 || openedAt !== 0) {
    logger.info('cache is reachable again');
  }
  consecutiveFailures = 0;
  openedAt = 0;
}

function recordFailure(err: unknown): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD && openedAt === 0) {
    openedAt = Date.now();
    logger.warn(
      { err, cooldownMs: COOLDOWN_MS },
      'cache unreachable — skipping it until the cooldown elapses',
    );
  }
}

/**
 * Runs a Redis operation, bounded and breaker-aware.
 * Returns `fallback` rather than throwing: no caller should fail because a
 * cache did.
 */
async function guarded<T>(
  label: string,
  op: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (breakerIsOpen()) return fallback;
  try {
    const result = await withTimeout(op(), OPERATION_TIMEOUT_MS, `cache ${label}`);
    recordSuccess();
    return result;
  } catch (err) {
    recordFailure(err);
    return fallback;
  }
}

export const cache = {
  async get(key: string): Promise<string | null> {
    return guarded('get', () => redis.get(key), null);
  },

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await guarded('set', async () => {
      await redis.setex(key, ttlSeconds, value);
    }, undefined);
  },

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await guarded('del', async () => {
      await redis.del(...keys);
    }, undefined);
  },

  /** JSON convenience. A corrupt entry is dropped rather than thrown. */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await cache.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      await cache.del(key);
      return null;
    }
  },

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await cache.set(key, JSON.stringify(value), ttlSeconds);
  },

  /**
   * Set membership, for presence and viewer counts.
   *
   * These go through the same breaker as everything else. They were being
   * called directly on the client, which meant a dead Redis added its full
   * connect-retry backoff to whatever was asking — the same failure that made
   * sign-in take twelve seconds twice before.
   */
  async sadd(key: string, member: string | number): Promise<void> {
    await guarded('sadd', async () => {
      await redis.sadd(key, member);
    }, undefined);
  },

  async srem(key: string, member: string | number): Promise<void> {
    await guarded('srem', async () => {
      await redis.srem(key, member);
    }, undefined);
  },

  /** An empty set is the safe answer: nobody is shown as online in error. */
  async smembers(key: string): Promise<string[]> {
    return guarded('smembers', () => redis.smembers(key), [] as string[]);
  },

  /** Exposed for health reporting and tests. */
  status(): { available: boolean; consecutiveFailures: number } {
    return { available: !breakerIsOpen(), consecutiveFailures };
  },

  /** Test seam. */
  __reset(): void {
    consecutiveFailures = 0;
    openedAt = 0;
  },
};
