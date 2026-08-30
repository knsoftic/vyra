import { useWindowDimensions, Platform } from 'react-native';

/**
 * Breakpoints for the app when it runs in a browser.
 *
 * On a phone this always reports `isMobile` — the native app is portrait-first and
 * never renders a desktop layout. On the web build the layout switches at 1024px
 * so a PC gets a real desktop experience rather than a stretched phone UI
 * (ADR-016).
 *
 * Uses `useWindowDimensions` rather than `Dimensions.get()` because the latter is
 * captured once and never updates when the browser window is resized.
 */
export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
} as const;

/** Widest a reading/grid column grows to on desktop before it stops stretching. */
export const CONTENT_MAX_WIDTH = 760;

export function useResponsive() {
  const { width, height } = useWindowDimensions();

  // Native builds are always the phone layout, whatever the reported width
  // (a tablet still gets the portrait product).
  const isWeb = Platform.OS === 'web';

  const isDesktop = isWeb && width >= BREAKPOINTS.desktop;
  const isTablet = isWeb && width >= BREAKPOINTS.tablet && width < BREAKPOINTS.desktop;
  const isMobile = !isDesktop && !isTablet;

  return { width, height, isWeb, isDesktop, isTablet, isMobile };
}

/**
 * Width actually available to content, after the desktop column cap and the
 * sidebar. Grids must size their tiles from this rather than from the raw window
 * width, or they overflow the column on a wide screen.
 */
export function useContentWidth(max: number = CONTENT_MAX_WIDTH) {
  const { width, isDesktop } = useResponsive();
  if (!isDesktop) return width;
  const SIDEBAR = 224;
  return Math.min(width - SIDEBAR, max);
}

/** Tile width for an n-column grid inside the available content width. */
export function useGridTileWidth(columns = 3, gap = 2, max: number = CONTENT_MAX_WIDTH) {
  const contentWidth = useContentWidth(max);
  return (contentWidth - gap * (columns - 1)) / columns;
}
