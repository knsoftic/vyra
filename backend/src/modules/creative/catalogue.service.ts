/**
 * The creative catalogue — filters, effects, sticker packs and fonts.
 *
 * PHASE_04 requires that an admin can add a filter and have it appear in the app
 * without an app release. That works because a filter is data: a row in
 * `creative_assets` whose `params` holds a `ColorGrade`. Both renderers already
 * know how to interpret any grade, so a new row needs no new code on either side.
 *
 * The catalogue is cached in Redis and carries a version string derived from the
 * newest update time, so a client can ask "has anything changed?" cheaply and
 * skip the download when it has not.
 */

import { createHash } from 'node:crypto';
import { execute, query, queryOne } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import { cache } from '../../core/cache.ts';
import { NEUTRAL_GRADE, ADJUSTMENT_CONTROLS } from '../../../../shared/contracts/creative.ts';
import type {
  ColorGrade,
  CreativeCatalogue,
  EffectCategory,
  FontOption,
  StickerPack,
  VideoEffect,
  VideoFilter,
} from '../../../../shared/contracts/creative.ts';

const CACHE_KEY = 'cfg:catalogue';
const CACHE_TTL_SECONDS = 300;

interface AssetRow {
  id: number;
  kind: string;
  slug: string;
  name: string;
  category: string | null;
  params: string | null;
  sort_order: number;
  is_enabled: number;
  is_trending: number;
  is_new: number;
  is_premium: number;
  updated_at: Date;
}

function parseParams(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Reads a grade from stored params, filling any gaps with neutral values. */
function gradeFrom(params: Record<string, unknown>): ColorGrade {
  const raw = (params.grade ?? {}) as Partial<Record<keyof ColorGrade, unknown>>;
  const grade = { ...NEUTRAL_GRADE };
  for (const key of Object.keys(NEUTRAL_GRADE) as (keyof ColorGrade)[]) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) grade[key] = value;
  }
  return grade;
}

const flags = (row: AssetRow) => ({
  isEnabled: row.is_enabled === 1,
  isTrending: row.is_trending === 1,
  isNew: row.is_new === 1,
  isPremium: row.is_premium === 1,
  sortOrder: Number(row.sort_order),
});

function toFilter(row: AssetRow): VideoFilter {
  const params = parseParams(row.params);
  return {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    category: row.category ?? 'basic',
    grade: gradeFrom(params),
    previewColor: typeof params.previewColor === 'string' ? params.previewColor : 'rgba(0,0,0,0)',
    defaultIntensity:
      typeof params.defaultIntensity === 'number' ? params.defaultIntensity : 100,
    ...flags(row),
  };
}

function toEffect(row: AssetRow): VideoEffect {
  const params = parseParams(row.params);
  const { icon, ...rest } = params;
  return {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    category: (row.category ?? 'motion') as EffectCategory,
    icon: typeof icon === 'string' ? icon : 'sparkles-outline',
    params: rest as Record<string, number | string>,
    ...flags(row),
  };
}

function toStickerPack(row: AssetRow): StickerPack {
  const params = parseParams(row.params);
  const stickers = Array.isArray(params.stickers)
    ? (params.stickers as StickerPack['stickers'])
    : [];
  return { id: String(row.id), slug: row.slug, name: row.name, stickers, ...flags(row) };
}

function toFont(row: AssetRow): FontOption {
  const params = parseParams(row.params);
  const font: FontOption = { id: String(row.id), slug: row.slug, name: row.name, ...flags(row) };
  if (typeof params.fileKey === 'string') font.fileKey = params.fileKey;
  return font;
}

/**
 * Loads the enabled catalogue.
 *
 * Disabled items are filtered out here rather than in the client, so retiring a
 * filter takes effect immediately for everyone.
 */
async function loadFromDb(): Promise<CreativeCatalogue> {
  const rows = await query<AssetRow>(
    `SELECT id, kind, slug, name, category, params, sort_order,
            is_enabled, is_trending, is_new, is_premium, updated_at
       FROM creative_assets
      WHERE is_enabled = 1
      ORDER BY sort_order, id`,
  );

  const newest = rows.reduce(
    (max, r) => Math.max(max, new Date(r.updated_at).getTime()),
    0,
  );
  const version = createHash('sha1')
    .update(`${rows.length}:${newest}`)
    .digest('hex')
    .slice(0, 12);

  return {
    filters: rows.filter((r) => r.kind === 'filter').map(toFilter),
    effects: rows.filter((r) => r.kind === 'effect').map(toEffect),
    stickerPacks: rows.filter((r) => r.kind === 'sticker_pack').map(toStickerPack),
    fonts: rows.filter((r) => r.kind === 'font').map(toFont),
    adjustments: ADJUSTMENT_CONTROLS,
    version,
  };
}

export async function getCatalogue(): Promise<CreativeCatalogue> {
  const cached = await cache.getJson<CreativeCatalogue>(CACHE_KEY);
  if (cached) return cached;

  const catalogue = await loadFromDb();
  await cache.setJson(CACHE_KEY, catalogue, CACHE_TTL_SECONDS);
  return catalogue;
}

export async function invalidateCatalogue(): Promise<void> {
  await cache.del(CACHE_KEY);
}

/** Resolves a filter slug to its stored grade. Used by the render worker. */
export async function getFilterGrade(slug: string): Promise<ColorGrade | null> {
  const row = await queryOne<AssetRow>(
    "SELECT * FROM creative_assets WHERE kind = 'filter' AND slug = :slug AND is_enabled = 1",
    { slug },
  );
  return row ? gradeFrom(parseParams(row.params)) : null;
}

export interface UpsertAssetInput {
  kind: 'filter' | 'effect' | 'sticker_pack' | 'font' | 'transition';
  slug: string;
  name: string;
  category?: string;
  params: Record<string, unknown>;
  sortOrder?: number;
  isEnabled?: boolean;
  isTrending?: boolean;
  isNew?: boolean;
  isPremium?: boolean;
}

/**
 * Creates or updates a catalogue item and drops the cache.
 *
 * Dropping the cache rather than waiting for its TTL is what makes "the admin
 * saved a filter and it appeared in the app" true rather than eventually true.
 */
export async function upsertAsset(input: UpsertAssetInput): Promise<void> {
  if (!/^[a-z0-9_]{1,40}$/.test(input.slug)) {
    throw new AppError('validation_failed', 'Slugs may use lowercase letters, digits and underscores.');
  }

  await execute(
    `INSERT INTO creative_assets
       (kind, slug, name, category, params, sort_order, is_enabled, is_trending, is_new, is_premium)
     VALUES (:kind, :slug, :name, :category, :params, :sortOrder,
             :isEnabled, :isTrending, :isNew, :isPremium)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       category = VALUES(category),
       params = VALUES(params),
       sort_order = VALUES(sort_order),
       is_enabled = VALUES(is_enabled),
       is_trending = VALUES(is_trending),
       is_new = VALUES(is_new),
       is_premium = VALUES(is_premium)`,
    {
      kind: input.kind,
      slug: input.slug,
      name: input.name,
      category: input.category ?? null,
      params: JSON.stringify(input.params),
      sortOrder: input.sortOrder ?? 0,
      isEnabled: input.isEnabled === false ? 0 : 1,
      isTrending: input.isTrending ? 1 : 0,
      isNew: input.isNew ? 1 : 0,
      isPremium: input.isPremium ? 1 : 0,
    },
  );

  await invalidateCatalogue();
  logger.info({ kind: input.kind, slug: input.slug }, 'catalogue asset saved');
}

/**
 * Disables an item. There is deliberately no delete: a retired filter may still
 * be referenced by a published video's edit list, and removing the row would
 * make that video impossible to re-render.
 */
export async function setAssetEnabled(
  kind: string,
  slug: string,
  enabled: boolean,
): Promise<void> {
  const result = await execute(
    'UPDATE creative_assets SET is_enabled = :enabled WHERE kind = :kind AND slug = :slug',
    { enabled: enabled ? 1 : 0, kind, slug },
  );
  if (result.affectedRows === 0) throw new AppError('not_found', 'Catalogue item not found.');
  await invalidateCatalogue();
}

export async function recordAssetUsage(kind: string, slug: string): Promise<void> {
  await execute(
    'UPDATE creative_assets SET usage_count = usage_count + 1 WHERE kind = :kind AND slug = :slug',
    { kind, slug },
  ).catch((err: unknown) => logger.warn({ err, kind, slug }, 'usage count update failed'));
}
