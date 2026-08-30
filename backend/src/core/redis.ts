/** Redis: caching, rate limit counters, socket fan-out and idempotency records. */

import { Redis } from 'ioredis';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { withTimeout } from './timeout.ts';

/**
 * Set while shutting down so the retry strategy stops rescheduling.
 *
 * Returning null from `retryStrategy` is the only thing that actually stops
 * ioredis reconnecting; without it a `disconnect()` is immediately undone by the
 * next scheduled attempt, and the pending socket keeps the event loop alive.
 */
let closing = false;

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
  retryStrategy: (times) => (closing ? null : Math.min(times * 200, 3000)),
});

redis.on('error', (err) => logger.error({ err }, 'redis error'));
redis.on('connect', () => logger.info('redis connected'));

/** Key namespace. Centralised so a rename cannot miss a call site. */
export const keys = {
  settings: () => 'cfg:settings',
  rankingWeights: () => 'cfg:ranking',
  session: (id: string) => `sess:${id}`,
  rateLimit: (bucket: string, id: string) => `rl:${bucket}:${id}`,
  idempotency: (userId: string, key: string) => `idem:${userId}:${key}`,
  feedSeen: (userId: string) => `feed:seen:${userId}`,
  liveViewers: (streamId: string) => `live:viewers:${streamId}`,
  onlineUsers: () => 'presence:online',
} as const;

/** Bounded, for the same reason as pingDb: a probe must never hang. */
export async function pingRedis(timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await withTimeout(redis.ping(), timeoutMs, 'redis ping');
    return res === 'PONG';
  } catch (err) {
    logger.error({ err }, 'redis ping failed');
    return false;
  }
}

/**
 * Closes the connection and stops it coming back.
 *
 * `quit()` alone is not enough: while the client is still connecting it queues
 * the QUIT behind a connection that never opens, so the call never settles and
 * shutdown hangs. Retries are disabled first, then the socket is torn down
 * locally, with `quit()` given a brief chance to close things politely when the
 * connection is actually up.
 */
export async function closeRedis(timeoutMs = 500): Promise<void> {
  closing = true;
  if (redis.status === 'ready') {
    try {
      await Promise.race([
        redis.quit(),
        new Promise((_r, reject) => setTimeout(() => reject(new Error('quit timed out')), timeoutMs)),
      ]);
      return;
    } catch {
      // Fall through to a forced disconnect.
    }
  }
  redis.disconnect();
}
