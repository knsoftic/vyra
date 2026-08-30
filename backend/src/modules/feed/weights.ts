/**
 * Ranking weights.
 *
 * Every number that shapes the feed lives in `ranking_weights` and is editable
 * from the admin panel (ADR-015). None of them is a constant in this file — a
 * constant would mean changing what people see requires a deploy, and it would
 * make the effect of a change untestable.
 *
 * Each weight carries a min and max. That is not decoration: a mistyped
 * `newCreatorExploration` of 100 instead of 0.10 would hand the entire feed to
 * untested videos, and there would be no way to tell it was wrong from the
 * value alone. The bounds make the mistake impossible to save.
 */

import { execute, query } from '../../core/db.ts';
import { cache } from '../../core/cache.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import {
  WEIGHT_DEFAULTS,
  SPEC_BY_KEY,
  DEFAULT_MAP,
  type WeightSpec,
  type Weights,
} from './weight-defaults.ts';

const CACHE_KEY = 'cfg:ranking-weights';
const CACHE_TTL_SECONDS = 120;




/**
 * Current weights, cached briefly.
 *
 * The short TTL is the compromise that makes exit criterion 5 true: an admin
 * change reaches the feed quickly, and a save also drops the cache so it is
 * immediate rather than eventual.
 */
export async function getWeights(): Promise<Weights> {
  const cached = await cache.getJson<Weights>(CACHE_KEY);
  if (cached) return cached;

  const rows = await query<{ weight_key: string; value: string }>(
    'SELECT weight_key, value FROM ranking_weights',
  ).catch((err: unknown) => {
    logger.error({ err }, 'could not load ranking weights; using defaults');
    return [] as { weight_key: string; value: string }[];
  });

  // Defaults underneath, so a weight added in code but not yet seeded still works.
  const weights: Weights = { ...DEFAULT_MAP };
  for (const row of rows) weights[row.weight_key] = Number(row.value);

  await cache.setJson(CACHE_KEY, weights, CACHE_TTL_SECONDS);
  return weights;
}

export async function invalidateWeights(): Promise<void> {
  await cache.del(CACHE_KEY);
}

/**
 * Updates one weight after checking it against its bounds.
 *
 * Returns the previous value so the caller can write a meaningful audit record —
 * "changed" is not useful; "0.10 → 0.35" is.
 */
export async function setWeight(
  key: string,
  value: number,
  adminId: number | null,
): Promise<{ previous: number; next: number }> {
  const spec = SPEC_BY_KEY.get(key);
  if (!spec) throw new AppError('not_found', `No ranking weight named "${key}".`);

  if (!Number.isFinite(value)) {
    throw new AppError('validation_failed', 'A weight must be a finite number.');
  }
  if (value < spec.min || value > spec.max) {
    throw new AppError(
      'validation_failed',
      `${spec.label} must be between ${spec.min} and ${spec.max}.`,
      { details: { value: [`Received ${value}.`] } },
    );
  }

  const current = await getWeights();
  const previous = current[key] ?? spec.value;

  await execute(
    `INSERT INTO ranking_weights (weight_key, value, min_value, max_value, updated_by)
     VALUES (:key, :value, :min, :max, :adminId)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
    { key, value, min: spec.min, max: spec.max, adminId },
  );

  // Dropped rather than left to expire, so the change is immediate.
  await invalidateWeights();
  logger.info({ key, previous, next: value, adminId }, 'ranking weight changed');

  return { previous, next: value };
}

/** Every weight with its bounds and current value, for the admin panel. */
export async function listWeights(): Promise<WeightSpec[]> {
  const current = await getWeights();
  return WEIGHT_DEFAULTS.map((spec) => ({
    ...spec,
    value: current[spec.key] ?? spec.value,
  }));
}

/** Writes the defaults. Existing values are left alone unless `force` is set. */
export async function seedWeights(force = false): Promise<number> {
  let written = 0;
  for (const spec of WEIGHT_DEFAULTS) {
    const result = await execute(
      force
        ? `INSERT INTO ranking_weights (weight_key, value, min_value, max_value)
           VALUES (:key, :value, :min, :max)
           ON DUPLICATE KEY UPDATE value = VALUES(value),
             min_value = VALUES(min_value), max_value = VALUES(max_value)`
        : `INSERT IGNORE INTO ranking_weights (weight_key, value, min_value, max_value)
           VALUES (:key, :value, :min, :max)`,
      { key: spec.key, value: spec.value, min: spec.min, max: spec.max },
    );
    if (result.affectedRows > 0) written += 1;
  }
  await invalidateWeights();
  return written;
}

export const weightSpec = (key: string): WeightSpec | undefined => SPEC_BY_KEY.get(key);

export { WEIGHT_DEFAULTS };
export type { WeightSpec, Weights };
