/**
 * Seeds ranking weights and the v1 model row.
 *
 * Idempotent: existing values are left alone unless `--force` is passed, so
 * running this never silently reverts an admin's tuning.
 */

import { execute, pool, query } from '../src/core/db.ts';
import { redis } from '../src/core/redis.ts';
import { seedWeights, WEIGHT_DEFAULTS } from '../src/modules/feed/weights.ts';

const force = process.argv.includes('--force');

async function main(): Promise<void> {
  console.log('\n  Seeding ranking configuration\n');

  const written = await seedWeights(force);
  console.log(`  ${WEIGHT_DEFAULTS.length} weights defined, ${written} written`);

  await execute(
    `INSERT INTO ranking_models (version, approach, status, notes, activated_at)
     VALUES ('v1', 'rules', 'active', 'Rules and weighted ranking. The production fallback.', NOW(3))
     ON DUPLICATE KEY UPDATE status = VALUES(status)`,
  );

  const models = await query<{ n: number }>('SELECT COUNT(*) AS n FROM ranking_models');
  console.log(`  ${models[0]?.n ?? 0} ranking model(s) registered\n`);
}

main()
  .then(async () => {
    await pool.end();
    await redis.quit().catch(() => undefined);
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('\n  Seeding failed:', err instanceof Error ? err.message : err, '\n');
    await pool.end().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    process.exit(1);
  });
