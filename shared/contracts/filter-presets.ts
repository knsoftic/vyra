/**
 * The 20 base filters required by PHASE_04, expressed as `ColorGrade` values.
 *
 * These are seed data, not the runtime source. At runtime the catalogue comes
 * from the database so an admin can add, disable, reorder or retire a filter
 * without an app release. They live here as well so the app has a sensible
 * catalogue before its first sync, and so the seed script and the client cannot
 * disagree about what ships by default.
 *
 * Each grade is the look at 100% intensity. The intensity slider scales it
 * linearly toward neutral, so 0 is always the untouched frame.
 */

import type { ColorGrade } from './creative.ts';

export interface FilterPreset {
  slug: string;
  name: string;
  category: string;
  previewColor: string;
  defaultIntensity: number;
  grade: ColorGrade;
}

const g = (partial: Partial<ColorGrade>): ColorGrade => ({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  sharpness: 0,
  fade: 0,
  vignette: 0,
  ...partial,
});

export const FILTER_PRESETS: readonly FilterPreset[] = [
  {
    slug: 'original',
    name: 'Original',
    category: 'basic',
    previewColor: 'rgba(255,255,255,0)',
    defaultIntensity: 100,
    grade: g({}),
  },
  {
    slug: 'natural',
    name: 'Natural',
    category: 'basic',
    previewColor: 'rgba(245,240,230,0.10)',
    defaultIntensity: 70,
    grade: g({ contrast: 8, saturation: 6, shadows: 6, sharpness: 12 }),
  },
  {
    slug: 'warm',
    name: 'Warm',
    category: 'colour',
    previewColor: 'rgba(255,176,32,0.18)',
    defaultIntensity: 70,
    grade: g({ temperature: 34, saturation: 10, brightness: 4 }),
  },
  {
    slug: 'cool',
    name: 'Cool',
    category: 'colour',
    previewColor: 'rgba(80,150,255,0.18)',
    defaultIntensity: 70,
    grade: g({ temperature: -34, saturation: 6, contrast: 6 }),
  },
  {
    slug: 'bright',
    name: 'Bright',
    category: 'light',
    previewColor: 'rgba(255,255,255,0.16)',
    defaultIntensity: 65,
    grade: g({ brightness: 18, exposure: 14, shadows: 12, highlights: -6 }),
  },
  {
    slug: 'dark',
    name: 'Dark',
    category: 'light',
    previewColor: 'rgba(0,0,0,0.22)',
    defaultIntensity: 65,
    grade: g({ brightness: -16, exposure: -12, contrast: 12, shadows: -14 }),
  },
  {
    slug: 'vintage',
    name: 'Vintage',
    category: 'film',
    previewColor: 'rgba(198,160,110,0.22)',
    defaultIntensity: 75,
    grade: g({ temperature: 22, saturation: -18, fade: 28, contrast: -8, vignette: 24 }),
  },
  {
    slug: 'film',
    name: 'Film',
    category: 'film',
    previewColor: 'rgba(180,170,150,0.18)',
    defaultIntensity: 75,
    grade: g({ contrast: 14, fade: 18, saturation: -6, shadows: 10, vignette: 14 }),
  },
  {
    slug: 'cinematic',
    name: 'Cinematic',
    category: 'film',
    previewColor: 'rgba(20,60,90,0.20)',
    defaultIntensity: 80,
    grade: g({ contrast: 20, saturation: -10, temperature: -14, shadows: -12, vignette: 26 }),
  },
  {
    slug: 'retro',
    name: 'Retro',
    category: 'film',
    previewColor: 'rgba(255,120,90,0.20)',
    defaultIntensity: 75,
    grade: g({ temperature: 26, tint: 14, fade: 34, saturation: 8, contrast: -10 }),
  },
  {
    slug: 'black_white',
    name: 'Black & White',
    category: 'mono',
    previewColor: 'rgba(140,140,140,0.24)',
    defaultIntensity: 100,
    grade: g({ saturation: -100, contrast: 16, sharpness: 10 }),
  },
  {
    slug: 'sepia',
    name: 'Sepia',
    category: 'mono',
    previewColor: 'rgba(160,120,70,0.26)',
    defaultIntensity: 85,
    grade: g({ saturation: -70, temperature: 44, fade: 16, contrast: 8 }),
  },
  {
    slug: 'vibrant',
    name: 'Vibrant',
    category: 'colour',
    previewColor: 'rgba(255,60,120,0.16)',
    defaultIntensity: 70,
    grade: g({ saturation: 34, contrast: 14, sharpness: 16 }),
  },
  {
    slug: 'soft',
    name: 'Soft',
    category: 'portrait',
    previewColor: 'rgba(255,230,235,0.18)',
    defaultIntensity: 60,
    grade: g({ contrast: -14, fade: 20, brightness: 8, sharpness: -0 }),
  },
  {
    slug: 'high_contrast',
    name: 'High Contrast',
    category: 'light',
    previewColor: 'rgba(10,10,10,0.22)',
    defaultIntensity: 80,
    grade: g({ contrast: 40, shadows: -18, highlights: 10, sharpness: 12 }),
  },
  {
    slug: 'low_contrast',
    name: 'Low Contrast',
    category: 'light',
    previewColor: 'rgba(180,180,190,0.22)',
    defaultIntensity: 60,
    grade: g({ contrast: -28, fade: 22, shadows: 14 }),
  },
  {
    slug: 'golden',
    name: 'Golden',
    category: 'colour',
    previewColor: 'rgba(255,190,60,0.22)',
    defaultIntensity: 75,
    grade: g({ temperature: 42, brightness: 10, saturation: 14, highlights: -10, vignette: 12 }),
  },
  {
    slug: 'night',
    name: 'Night',
    category: 'light',
    previewColor: 'rgba(20,30,80,0.26)',
    defaultIntensity: 75,
    grade: g({ temperature: -40, brightness: -10, shadows: -20, contrast: 18, vignette: 30 }),
  },
  {
    slug: 'portrait',
    name: 'Portrait',
    category: 'portrait',
    previewColor: 'rgba(255,215,200,0.16)',
    defaultIntensity: 65,
    grade: g({ temperature: 12, saturation: 6, contrast: 6, shadows: 10, vignette: 16 }),
  },
  {
    slug: 'landscape',
    name: 'Landscape',
    category: 'scene',
    previewColor: 'rgba(60,200,150,0.16)',
    defaultIntensity: 70,
    grade: g({ saturation: 24, contrast: 16, sharpness: 22, highlights: -8 }),
  },
];

/**
 * Scales a preset toward neutral. Intensity 0 returns an untouched frame, 100
 * returns the preset as authored. Both renderers must use this same function so
 * a slider at 40% means the same thing on device and on the server.
 */
export function scaleGrade(grade: ColorGrade, intensity: number): ColorGrade {
  const factor = Math.max(0, Math.min(100, intensity)) / 100;
  const out = {} as ColorGrade;
  for (const key of Object.keys(grade) as (keyof ColorGrade)[]) {
    out[key] = Math.round(grade[key] * factor * 100) / 100;
  }
  return out;
}

/** Combines two grades additively, clamped to each control's range. */
export function mergeGrades(base: ColorGrade, overlay: Partial<ColorGrade>): ColorGrade {
  const out = { ...base };
  const oneSided = new Set(['sharpness', 'fade', 'vignette']);
  for (const key of Object.keys(overlay) as (keyof ColorGrade)[]) {
    const value = overlay[key];
    if (value === undefined) continue;
    const min = oneSided.has(key) ? 0 : -100;
    out[key] = Math.max(min, Math.min(100, out[key] + value));
  }
  return out;
}
