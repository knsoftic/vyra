/**
 * Design tokens — the single source of truth for every visual value in the app.
 *
 * Screens must never hard-code a colour, spacing value, radius or font size.
 * Pull everything from `useTheme()`.
 */

export const palette = {
  // Brand — deliberately NOT the red/cyan pairing every short-video app uses.
  // Violet primary with a mint accent gives the product its own identity.
  brand: '#7C5CFF',
  brandDark: '#5F3FE0',
  brandSoft: 'rgba(124, 92, 255, 0.14)',
  accent: '#3DDC97',
  accentSoft: 'rgba(61, 220, 151, 0.14)',
  gold: '#FFB020',

  // Semantic
  success: '#22C55E',
  successSoft: 'rgba(34, 197, 94, 0.14)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245, 158, 11, 0.14)',
  danger: '#EF4444',
  dangerSoft: 'rgba(239, 68, 68, 0.14)',
  info: '#3B82F6',
  infoSoft: 'rgba(59, 130, 246, 0.14)',

  // Absolutes
  white: '#FFFFFF',
  black: '#000000',
} as const;

const darkColorsRaw = {
  ...palette,

  bg: '#0A0A0B',
  surface: '#141416',
  surfaceAlt: '#1C1C1F',
  surfaceElevated: '#232327',
  border: '#2A2A2F',
  borderStrong: '#3A3A42',

  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textMuted: '#6B6B75',
  textInverse: '#0A0A0B',

  overlay: 'rgba(0, 0, 0, 0.65)',
  scrim: 'rgba(0, 0, 0, 0.35)',
  glass: 'rgba(255, 255, 255, 0.08)',
  skeleton: '#1F1F23',

  tabBar: '#0A0A0B',
  tabBarBorder: '#1F1F23',
} as const;

/**
 * Every colour token, widened to `string`. Both palettes are typed against this
 * so a token added to one theme must be added to the other.
 */
export type ColorTokens = { [K in keyof typeof darkColorsRaw]: string };

const darkColors: ColorTokens = darkColorsRaw;

const lightColors: ColorTokens = {
  ...palette,

  bg: '#FFFFFF',
  surface: '#F6F6F8',
  surfaceAlt: '#EFEFF2',
  surfaceElevated: '#FFFFFF',
  border: '#E3E3E8',
  borderStrong: '#CFCFD6',

  text: '#0A0A0B',
  textSecondary: '#5C5C66',
  textMuted: '#9A9AA5',
  textInverse: '#FFFFFF',

  overlay: 'rgba(0, 0, 0, 0.55)',
  scrim: 'rgba(0, 0, 0, 0.25)',
  glass: 'rgba(0, 0, 0, 0.05)',
  skeleton: '#ECECEF',

  tabBar: '#FFFFFF',
  tabBarBorder: '#E3E3E8',
};

/**
 * The video feed is always dark regardless of app theme — the same choice every
 * major short-video product makes, because content sits edge to edge.
 */
export const feedColors = darkColors;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
} as const;

export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Compact type scale. Deliberately smaller than a stock mobile scale so more
 * content fits on screen and the UI reads as dense rather than oversized.
 */
export const fontSize = {
  display: 26,
  h1: 21,
  h2: 17,
  h3: 15,
  body: 13,
  label: 11.5,
  caption: 10,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const typography = {
  display: { fontSize: fontSize.display, fontWeight: fontWeight.heavy, letterSpacing: -0.5 },
  h1: { fontSize: fontSize.h1, fontWeight: fontWeight.bold, letterSpacing: -0.4 },
  h2: { fontSize: fontSize.h2, fontWeight: fontWeight.bold, letterSpacing: -0.3 },
  h3: { fontSize: fontSize.h3, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  body: { fontSize: fontSize.body, fontWeight: fontWeight.regular },
  bodyStrong: { fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  label: { fontSize: fontSize.label, fontWeight: fontWeight.medium },
  labelStrong: { fontSize: fontSize.label, fontWeight: fontWeight.semibold },
  caption: { fontSize: fontSize.caption, fontWeight: fontWeight.medium },
} as const;

export const shadow = {
  sm: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  md: {
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
} as const;

export const layout = {
  headerHeight: 52,
  tabBarHeight: 56,
  avatarSm: 32,
  avatarMd: 44,
  avatarLg: 64,
  avatarXl: 96,
  hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
} as const;

/** Brand gradient used for primary CTAs, live rings and highlights. */
export const gradients = {
  brand: ['#7C5CFF', '#A78BFF'] as const,
  brandAccent: ['#7C5CFF', '#3DDC97'] as const,
  live: ['#FF4D6D', '#FFB020'] as const,
  coin: ['#FFB020', '#FF7A45'] as const,
  dark: ['transparent', 'rgba(0,0,0,0.85)'] as const,
  darkTop: ['rgba(0,0,0,0.7)', 'transparent'] as const,
};

export interface Theme {
  mode: 'dark' | 'light';
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: typeof fontSize;
  fontWeight: typeof fontWeight;
  typography: typeof typography;
  shadow: typeof shadow;
  layout: typeof layout;
  gradients: typeof gradients;
}

const shared = { spacing, radius, fontSize, fontWeight, typography, shadow, layout, gradients };

export const themes: Record<'dark' | 'light', Theme> = {
  dark: { mode: 'dark', colors: darkColors, ...shared },
  light: { mode: 'light', colors: lightColors, ...shared },
};

export type ThemeMode = 'dark' | 'light' | 'system';
