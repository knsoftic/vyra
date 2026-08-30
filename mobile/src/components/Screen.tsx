import React from 'react';
import { View, StyleSheet, StatusBar, Platform, ViewStyle, StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme';
import { useResponsive, CONTENT_MAX_WIDTH } from '../hooks/useResponsive';
import { Text } from './Text';
import { Pressable } from './Pressable';

interface ScreenProps {
  children: React.ReactNode;
  /** `edges` controls which safe-area insets are applied as padding. */
  top?: boolean;
  bottom?: boolean;
  /** Force a dark background regardless of theme — used by the feed and camera surfaces. */
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
  background?: string;
  /** Opt out of the desktop content column — for surfaces that must fill the width. */
  fullBleed?: boolean;
  /** Override the desktop column width. */
  maxWidth?: number;
}

export function Screen({
  children,
  top = true,
  bottom = false,
  dark = false,
  style,
  background,
  fullBleed = false,
  maxWidth = CONTENT_MAX_WIDTH,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsive();

  const bg = background ?? (dark ? '#000000' : theme.colors.bg);

  /**
   * On a wide screen, content sits in a centred column instead of stretching edge
   * to edge — a full-width settings list or auth form on a 1440px monitor is the
   * mobile layout stretched, which is exactly what ADR-016 rules out.
   */
  const constrain = isDesktop && !fullBleed;

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: bg,
          paddingTop: top ? insets.top : 0,
          paddingBottom: bottom ? insets.bottom : 0,
        },
        constrain && styles.centre,
        style,
      ]}
    >
      <StatusBar
        barStyle={dark || theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent={Platform.OS === 'android'}
      />
      {constrain ? (
        <View style={[styles.column, { maxWidth }]}>{children}</View>
      ) : (
        children
      )}
    </View>
  );
}

interface HeaderProps {
  title?: string;
  subtitle?: string;
  /** Defaults to showing a back chevron when the stack can go back. */
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  left?: React.ReactNode;
  center?: React.ReactNode;
  transparent?: boolean;
  borderless?: boolean;
  onDark?: boolean;
}

export function Header({
  title,
  subtitle,
  showBack = true,
  onBack,
  right,
  left,
  center,
  transparent = false,
  borderless = false,
  onDark = false,
}: HeaderProps) {
  const theme = useTheme();
  const navigation = useNavigation();

  const canGoBack = showBack && (onBack !== undefined || navigation.canGoBack());
  const iconColor = onDark ? '#FFFFFF' : theme.colors.text;

  const handleBack = () => {
    if (onBack) return onBack();
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <View
      style={[
        styles.header,
        {
          height: theme.layout.headerHeight,
          paddingHorizontal: theme.spacing.md,
          backgroundColor: transparent ? 'transparent' : onDark ? '#000' : theme.colors.bg,
          borderBottomWidth: borderless || transparent ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.headerSide}>
        {left ?? (canGoBack ? (
          <Pressable onPress={handleBack} hitSlop={theme.layout.hitSlop} accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={26} color={iconColor} />
          </Pressable>
        ) : null)}
      </View>

      <View style={styles.headerCenter} pointerEvents="box-none">
        {center ?? (
          <>
            {title ? (
              <Text variant="h3" numberOfLines={1} tone={onDark ? 'onDark' : 'primary'}>
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text variant="caption" tone={onDark ? 'onDark' : 'secondary'} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </>
        )}
      </View>

      <View style={[styles.headerSide, styles.headerRight]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: { alignItems: 'center' },
  column: { flex: 1, width: '100%' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSide: {
    minWidth: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerRight: { justifyContent: 'flex-end' },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
