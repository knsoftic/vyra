/**
 * The gift catalogue.
 *
 * Admin-editable like every other list in the product (ADR-015): the values here
 * are starting points, not constants the code depends on. `coins` is what the
 * sender pays; what the creator receives is `gift_platform_share` applied at
 * send time and recorded on the transaction.
 *
 * Idempotent — re-running updates the presentation of an existing gift but never
 * its price, because changing what a gift costs underneath people who are
 * mid-purchase is a different operation with different consequences.
 */

import { execute, query, closeDb } from '../src/core/db.ts';
import { closeRedis } from '../src/core/redis.ts';

interface GiftSeed {
  slug: string;
  name: string;
  icon: string;
  coins: number;
  featured?: boolean;
}

const GIFTS: GiftSeed[] = [
  { slug: 'rose', name: 'Rose', icon: '🌹', coins: 1, featured: true },
  { slug: 'clap', name: 'Applause', icon: '👏', coins: 5 },
  { slug: 'heart', name: 'Heart', icon: '❤️', coins: 10, featured: true },
  { slug: 'star', name: 'Star', icon: '⭐', coins: 25 },
  { slug: 'coffee', name: 'Coffee', icon: '☕', coins: 50 },
  { slug: 'cake', name: 'Cake', icon: '🎂', coins: 100, featured: true },
  { slug: 'fireworks', name: 'Fireworks', icon: '🎆', coins: 250 },
  { slug: 'guitar', name: 'Guitar', icon: '🎸', coins: 500 },
  { slug: 'crown', name: 'Crown', icon: '👑', coins: 1000, featured: true },
  { slug: 'rocket', name: 'Rocket', icon: '🚀', coins: 2500 },
  { slug: 'sportscar', name: 'Sports car', icon: '🏎️', coins: 5000 },
  { slug: 'castle', name: 'Castle', icon: '🏰', coins: 10000, featured: true },
];

async function main(): Promise<void> {
  console.log('\n  Seeding the gift catalogue\n');

  let created = 0;
  let updated = 0;

  for (const [index, gift] of GIFTS.entries()) {
    const existing = await query<{ id: number }>('SELECT id FROM gifts WHERE slug = :slug', {
      slug: gift.slug,
    });

    if (existing.length > 0) {
      // Presentation only. The price of an existing gift is left alone.
      await execute(
        `UPDATE gifts
            SET name = :name, icon = :icon, is_featured = :featured, sort_order = :sortOrder
          WHERE slug = :slug`,
        {
          name: gift.name,
          icon: gift.icon,
          featured: gift.featured ? 1 : 0,
          sortOrder: index,
          slug: gift.slug,
        },
      );
      updated += 1;
      continue;
    }

    await execute(
      `INSERT INTO gifts (slug, name, icon, coins, is_featured, is_active, sort_order)
       VALUES (:slug, :name, :icon, :coins, :featured, 1, :sortOrder)`,
      {
        slug: gift.slug,
        name: gift.name,
        icon: gift.icon,
        coins: gift.coins,
        featured: gift.featured ? 1 : 0,
        sortOrder: index,
      },
    );
    created += 1;
  }

  console.log(`  ${created} gift(s) created, ${updated} updated`);
  console.log(`  ${GIFTS.length} gifts in the catalogue\n`);
}

main()
  .catch((err: unknown) => {
    console.error('  Gift seeding failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    await closeRedis();
  });
