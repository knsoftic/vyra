/**
 * Seeds the audience segments and the matching content categories.
 *
 * They share slugs on purpose: interest weights are keyed by category slug, and
 * segment membership is derived from those weights, so the two vocabularies have
 * to agree. Admins can add more of either later — this is a starting set, not a
 * fixed list.
 */

import { execute, query } from '../src/core/db.ts';
import { pool } from '../src/core/db.ts';
import { redis } from '../src/core/redis.ts';

const SEGMENTS: { slug: string; name: string }[] = [
  { slug: 'ai', name: 'AI' },
  { slug: 'technology', name: 'Technology' },
  { slug: 'gaming', name: 'Gaming' },
  { slug: 'business', name: 'Business' },
  { slug: 'education', name: 'Education' },
  { slug: 'sports', name: 'Sports' },
  { slug: 'comedy', name: 'Comedy' },
  { slug: 'fashion', name: 'Fashion' },
  { slug: 'beauty', name: 'Beauty' },
  { slug: 'cars', name: 'Cars' },
  { slug: 'food', name: 'Food' },
  { slug: 'travel', name: 'Travel' },
  { slug: 'entertainment', name: 'Entertainment' },
  { slug: 'music', name: 'Music' },
  { slug: 'fitness', name: 'Fitness' },
  { slug: 'diy', name: 'DIY' },
  { slug: 'pets', name: 'Pets' },
  { slug: 'art', name: 'Art' },
];

async function main(): Promise<void> {
  console.log('\n  Seeding audience segments and categories\n');

  for (const [index, segment] of SEGMENTS.entries()) {
    await execute(
      `INSERT INTO audience_segments (slug, name, is_enabled) VALUES (:slug, :name, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      segment,
    );
    await execute(
      `INSERT INTO categories (slug, name, sort_order, is_enabled) VALUES (:slug, :name, :order, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      { ...segment, order: index },
    ).catch(() => undefined);
  }

  const counts = await query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM audience_segments WHERE is_enabled = 1',
  );
  console.log(`  ${SEGMENTS.length} segments defined, ${counts[0]?.n ?? 0} enabled\n`);
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
