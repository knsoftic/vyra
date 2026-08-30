/**
 * Releases gift earnings whose holding period has elapsed.
 *
 * In production this runs on a schedule. It is a script rather than a timer
 * inside the API process so that it can be run on demand — during a support
 * investigation, or after a clearing period is changed — and so that a restart
 * of the API never skips a release or performs one twice. `releaseCleared` is
 * idempotent either way.
 */

import { releaseCleared } from '../src/modules/live/gifts.service.ts';
import { closeDb } from '../src/core/db.ts';
import { closeRedis } from '../src/core/redis.ts';

async function main(): Promise<void> {
  const result = await releaseCleared();
  console.log(
    `\n  ${result.rows} clearing row(s) released, ${result.released} made withdrawable\n`,
  );
}

main()
  .catch((err: unknown) => {
    console.error('  Clearing failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    await closeRedis();
  });
