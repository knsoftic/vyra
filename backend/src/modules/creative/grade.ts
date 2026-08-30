/**
 * `ColorGrade` → FFmpeg filter graph.
 *
 * This is the server half of the "preview matches render" guarantee. The device
 * runs a GPU shader from the same `ColorGrade`; this turns those numbers into
 * FFmpeg filters. Neither side invents values — both read the same eleven
 * controls in the same user-facing units.
 *
 * Filter choices favour portability over sophistication. `eq`, `curves`,
 * `colorbalance`, `unsharp` and `vignette` have been in FFmpeg for many years and
 * exist in every distribution build. Newer conveniences like `colortemperature`
 * are deliberately avoided: a filter graph that fails to parse on the render host
 * is worse than one that is a shade less precise.
 *
 * Every conversion is a pure function of the grade, so the whole mapping is
 * unit-testable without FFmpeg installed.
 */

import type { ColorGrade } from '../../../../shared/contracts/creative.ts';
import { NEUTRAL_GRADE } from '../../../../shared/contracts/creative.ts';

/** Rounds to 4 decimals so generated graphs are stable and diffable. */
const r = (n: number): number => Math.round(n * 10000) / 10000;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Conversions from user units to each filter's native range.
 *
 * The scale factors are chosen so that ±100 is a strong but not destructive
 * change — the same intent the shader implements.
 */
export const SCALES = {
  /** eq brightness accepts -1..1; ±100 maps to ±0.3, a visible but sane swing. */
  brightness: 0.003,
  /** eq contrast accepts 0..3 with 1 neutral; ±100 maps to 1±0.6. */
  contrast: 0.006,
  /** eq saturation accepts 0..3 with 1 neutral; -100 fully desaturates. */
  saturation: 0.01,
  /** Exposure is applied as gamma; ±100 maps to gamma 1∓0.4. */
  exposure: 0.004,
  /** colorbalance channels accept -1..1; ±100 maps to ±0.3. */
  temperature: 0.003,
  tint: 0.003,
  /** unsharp luma_amount; 100 maps to 1.5. */
  sharpness: 0.015,
  /** Fade lifts the black point to at most 0.25 at 100. */
  fade: 0.0025,
  /** Highlight/shadow curve movement, at most 0.2 at ±100. */
  tonal: 0.002,
} as const;

export interface GraphOptions {
  /** Omit filters whose effect is below this, to keep graphs short. */
  epsilon?: number;
}

/**
 * Builds the ordered list of FFmpeg video filters for a grade.
 *
 * Order matters and mirrors the shader: exposure and tone first, then colour,
 * then contrast and saturation, then spatial effects last. Sharpening before a
 * vignette, for instance, would sharpen the darkened corners.
 */
export function gradeToFilters(grade: ColorGrade, opts: GraphOptions = {}): string[] {
  const eps = opts.epsilon ?? 0.5;
  const filters: string[] = [];
  const has = (v: number): boolean => Math.abs(v) >= eps;

  // 1. Exposure — gamma, applied before anything that depends on tonality.
  if (has(grade.exposure)) {
    const gamma = clamp(1 - grade.exposure * SCALES.exposure, 0.1, 3);
    filters.push(`eq=gamma=${r(gamma)}`);
  }

  // 2. Highlights and shadows — a three-point curve. Positive shadows lift the
  //    bottom, positive highlights recover the top by pulling it down.
  if (has(grade.highlights) || has(grade.shadows)) {
    const shadowLift = clamp(grade.shadows * SCALES.tonal, -0.2, 0.2);
    const highlightPull = clamp(-grade.highlights * SCALES.tonal, -0.2, 0.2);
    const black = clamp(0 + shadowLift, 0, 0.4);
    const white = clamp(1 + highlightPull, 0.6, 1);
    filters.push(`curves=all='0/${r(black)} 0.5/0.5 1/${r(white)}'`);
  }

  // 3. Temperature and tint — colorbalance moves midtones per channel.
  //    Warm lifts red and drops blue; magenta tint lifts red and blue over green.
  if (has(grade.temperature) || has(grade.tint)) {
    const t = grade.temperature * SCALES.temperature;
    const ti = grade.tint * SCALES.tint;
    const rm = clamp(t + ti * 0.5, -1, 1);
    const gm = clamp(-ti, -1, 1);
    const bm = clamp(-t + ti * 0.5, -1, 1);
    filters.push(`colorbalance=rm=${r(rm)}:gm=${r(gm)}:bm=${r(bm)}`);
  }

  // 4. Brightness, contrast and saturation — one eq pass.
  const eq: string[] = [];
  if (has(grade.brightness)) {
    eq.push(`brightness=${r(clamp(grade.brightness * SCALES.brightness, -1, 1))}`);
  }
  if (has(grade.contrast)) {
    eq.push(`contrast=${r(clamp(1 + grade.contrast * SCALES.contrast, 0, 3))}`);
  }
  if (has(grade.saturation)) {
    eq.push(`saturation=${r(clamp(1 + grade.saturation * SCALES.saturation, 0, 3))}`);
  }
  if (eq.length > 0) filters.push(`eq=${eq.join(':')}`);

  // 5. Fade — lift the black point for a matte look. Applied after contrast so
  //    contrast does not immediately crush it back down.
  if (grade.fade >= eps) {
    const lift = clamp(grade.fade * SCALES.fade, 0, 0.25);
    filters.push(`curves=all='0/${r(lift)} 1/1'`);
  }

  // 6. Sharpness — negative values soften, which `unsharp` supports directly.
  if (has(grade.sharpness)) {
    const amount = clamp(grade.sharpness * SCALES.sharpness, -2, 2);
    filters.push(`unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${r(amount)}`);
  }

  // 7. Vignette last, so nothing else re-lightens the corners.
  if (grade.vignette >= eps) {
    // FFmpeg's vignette angle is in radians; PI/5 is subtle, PI/2 is heavy.
    const angle = clamp((grade.vignette / 100) * (Math.PI / 2.2), 0, Math.PI / 2);
    filters.push(`vignette=angle=${r(angle)}`);
  }

  return filters;
}

/** The graph as a single comma-separated chain, or `null` when it is a no-op. */
export function gradeToFilterChain(grade: ColorGrade, opts?: GraphOptions): string | null {
  const filters = gradeToFilters(grade, opts);
  return filters.length > 0 ? filters.join(',') : null;
}

/** True when a grade would leave the frame untouched. */
export function isNeutralGrade(grade: ColorGrade, epsilon = 0.5): boolean {
  return gradeToFilters(grade, { epsilon }).length === 0;
}

/** Fills in any missing controls with neutral values. */
export function normaliseGrade(partial: Partial<ColorGrade> | undefined): ColorGrade {
  return { ...NEUTRAL_GRADE, ...(partial ?? {}) };
}
