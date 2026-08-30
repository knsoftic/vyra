/**
 * Seeds the creative catalogue.
 *
 * Idempotent by design — it upserts by slug, so running it twice changes
 * nothing and running it after an admin has edited a filter does not silently
 * revert their work unless `--force` is passed.
 *
 * This is seed data, not the source of truth. Once seeded, the database is
 * authoritative and the admin panel is how the catalogue changes.
 */

import { FILTER_PRESETS } from '../../shared/contracts/filter-presets.ts';
import { pool, query } from '../src/core/db.ts';
import { redis } from '../src/core/redis.ts';
import { upsertAsset } from '../src/modules/creative/catalogue.service.ts';

const force = process.argv.includes('--force');

/** The effects catalogue required by PHASE_04. */
const EFFECTS: {
  slug: string;
  name: string;
  category: 'motion' | 'light' | 'color' | 'transition' | 'background' | 'time';
  icon: string;
  params: Record<string, number | string>;
}[] = [
  { slug: 'blur', name: 'Blur', category: 'motion', icon: 'water-outline', params: { sigma: 8 } },
  { slug: 'zoom', name: 'Zoom', category: 'motion', icon: 'scan-outline', params: { scale: 1.3 } },
  { slug: 'shake', name: 'Shake', category: 'motion', icon: 'move-outline', params: { amplitude: 12 } },
  { slug: 'flash', name: 'Flash', category: 'light', icon: 'flash-outline', params: { intensity: 70 } },
  { slug: 'glitch', name: 'Glitch', category: 'color', icon: 'pulse-outline', params: { intensity: 50 } },
  { slug: 'slow_motion', name: 'Slow Motion', category: 'time', icon: 'hourglass-outline', params: { speed: 0.5 } },
  { slug: 'fast_motion', name: 'Fast Motion', category: 'time', icon: 'speedometer-outline', params: { speed: 2 } },
  { slug: 'reverse', name: 'Reverse', category: 'time', icon: 'play-back-outline', params: {} },
  { slug: 'fade_transition', name: 'Fade', category: 'transition', icon: 'contrast-outline', params: { durationMs: 500 } },
  { slug: 'slide_transition', name: 'Slide', category: 'transition', icon: 'swap-horizontal-outline', params: { durationMs: 400 } },
  { slug: 'light_leak', name: 'Light Leak', category: 'light', icon: 'sunny-outline', params: { intensity: 40 } },
  { slug: 'colour_shift', name: 'Colour Shift', category: 'color', icon: 'color-palette-outline', params: { hue: 20 } },
  { slug: 'background_blur', name: 'Background Blur', category: 'background', icon: 'image-outline', params: { sigma: 10 } },
];

const STICKER_PACKS = [
  {
    slug: 'reactions',
    name: 'Reactions',
    stickers: [
      { id: 'love', label: 'Love', emoji: '❤️' },
      { id: 'laugh', label: 'Laugh', emoji: '😂' },
      { id: 'wow', label: 'Wow', emoji: '😮' },
      { id: 'fire', label: 'Fire', emoji: '🔥' },
      { id: 'clap', label: 'Clap', emoji: '👏' },
      { id: 'hundred', label: 'Hundred', emoji: '💯' },
    ],
  },
  {
    slug: 'essentials',
    name: 'Essentials',
    stickers: [
      { id: 'star', label: 'Star', emoji: '⭐' },
      { id: 'sparkles', label: 'Sparkles', emoji: '✨' },
      { id: 'party', label: 'Party', emoji: '🎉' },
      { id: 'music', label: 'Music', emoji: '🎵' },
      { id: 'camera', label: 'Camera', emoji: '📸' },
      { id: 'check', label: 'Check', emoji: '✅' },
    ],
  },
];

const FONTS = [
  { slug: 'inter', name: 'Inter' },
  { slug: 'classic', name: 'Classic' },
  { slug: 'typewriter', name: 'Typewriter' },
  { slug: 'handwriting', name: 'Handwriting' },
  { slug: 'display', name: 'Display' },
  { slug: 'serif', name: 'Serif' },
];

async function existingSlugs(kind: string): Promise<Set<string>> {
  const rows = await query<{ slug: string }>(
    'SELECT slug FROM creative_assets WHERE kind = :kind',
    { kind },
  );
  return new Set(rows.map((r) => r.slug));
}

async function main(): Promise<void> {
  console.log('\n  Seeding the creative catalogue\n');

  let created = 0;
  let skipped = 0;

  const seedGroup = async <T extends { slug: string }>(
    kind: 'filter' | 'effect' | 'sticker_pack' | 'font',
    items: readonly T[],
    build: (item: T, index: number) => Parameters<typeof upsertAsset>[0],
  ) => {
    const existing = await existingSlugs(kind);
    for (const [index, item] of items.entries()) {
      if (existing.has(item.slug) && !force) {
        skipped += 1;
        continue;
      }
      await upsertAsset(build(item, index));
      created += 1;
    }
    console.log(`  ${kind.padEnd(13)} ${items.length} defined`);
  };

  await seedGroup('filter', FILTER_PRESETS, (preset, index) => ({
    kind: 'filter',
    slug: preset.slug,
    name: preset.name,
    category: preset.category,
    params: {
      grade: preset.grade,
      previewColor: preset.previewColor,
      defaultIntensity: preset.defaultIntensity,
    },
    sortOrder: index,
    isEnabled: true,
  }));

  await seedGroup('effect', EFFECTS, (effect, index) => ({
    kind: 'effect',
    slug: effect.slug,
    name: effect.name,
    category: effect.category,
    params: { icon: effect.icon, ...effect.params },
    sortOrder: index,
    isEnabled: true,
  }));

  await seedGroup('sticker_pack', STICKER_PACKS, (pack, index) => ({
    kind: 'sticker_pack',
    slug: pack.slug,
    name: pack.name,
    category: 'general',
    params: { stickers: pack.stickers },
    sortOrder: index,
    isEnabled: true,
  }));

  await seedGroup('font', FONTS, (font, index) => ({
    kind: 'font',
    slug: font.slug,
    name: font.name,
    category: 'text',
    params: {},
    sortOrder: index,
    isEnabled: true,
  }));

  console.log(`\n  ${created} written, ${skipped} left untouched`);
  if (skipped > 0 && !force) {
    console.log('  Pass --force to overwrite items that already exist.\n');
  } else {
    console.log('');
  }
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
