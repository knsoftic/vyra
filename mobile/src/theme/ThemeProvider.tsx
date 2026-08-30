import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import { themes, Theme, ThemeMode } from './tokens';

type ThemeContextValue = {
  theme: Theme;
  mode: ThemeMode;
  /** Resolved appearance after applying `system`. */
  scheme: 'dark' | 'light';
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  // Dark-first product: default to dark rather than following the OS on first launch.
  const [mode, setMode] = useState<ThemeMode>('dark');

  const scheme: 'dark' | 'light' =
    mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode;

  const toggle = useCallback(() => {
    setMode((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: themes[scheme], mode, scheme, setMode, toggle }),
    [scheme, mode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx.theme;
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode must be used inside <ThemeProvider>');
  const { mode, scheme, setMode, toggle } = ctx;
  return { mode, scheme, setMode, toggle };
}

/**
 * Build styles that depend on the theme without re-creating the object on every render.
 * Usage: `const s = useThemedStyles(makeStyles)` where `makeStyles = (t: Theme) => ({...})`.
 */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}
