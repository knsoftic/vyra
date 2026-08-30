import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Animated,
  Easing,
  useWindowDimensions,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useResponsive } from '../hooks/useResponsive';
import { Text } from './Text';
import { Pressable } from './Pressable';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Fraction of screen height, 0–1. */
  height?: number;
  showHandle?: boolean;
  showClose?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Bottom sheet used for comments, share, gifts, filters and every picker in the app.
 * Slides from the bottom, dims the content behind it, closes on backdrop press.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  height = 0.6,
  showHandle = true,
  showClose = false,
  contentStyle,
}: SheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT } = useWindowDimensions();
  const { isDesktop } = useResponsive();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      translateY.setValue(SCREEN_HEIGHT);
      backdrop.setValue(0);
    }
  }, [visible, translateY, backdrop]);

  const sheetHeight = SCREEN_HEIGHT * height;
  // On a wide screen the sheet becomes a centred panel rather than a full-width bar.
  const sheetWidth = isDesktop ? SHEET_MAX_WIDTH : undefined;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdrop }]}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={onClose}
            activeOpacity={1}
            accessibilityLabel="Close"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              width: sheetWidth,
              alignSelf: isDesktop ? 'center' : 'stretch',
              backgroundColor: theme.colors.bg,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: insets.bottom,
              transform: [{ translateY }],
            },
          ]}
        >
          {showHandle ? (
            <View style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: theme.colors.borderStrong }]} />
            </View>
          ) : null}

          {title ? (
            <View
              style={[
                styles.header,
                {
                  paddingHorizontal: theme.spacing.md,
                  paddingBottom: theme.spacing.sm,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.colors.border,
                },
              ]}
            >
              <View style={styles.headerText}>
                <Text variant="bodyStrong" align={showClose ? 'left' : 'center'}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="caption" tone="muted" align={showClose ? 'left' : 'center'}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              {showClose ? (
                <Pressable onPress={onClose} hitSlop={theme.layout.hitSlop}>
                  <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.content, contentStyle]}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Row of large icon actions — the share sheet and video menu are built from these. */
export function SheetActionRow({
  actions,
}: {
  actions: {
    id: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    color?: string;
    onPress?: () => void;
  }[];
}) {
  const theme = useTheme();
  return (
    <View style={[styles.actionRow, { paddingHorizontal: theme.spacing.md, gap: theme.spacing.lg }]}>
      {actions.map((action) => (
        <Pressable key={action.id} onPress={action.onPress} style={styles.action}>
          <View
            style={[
              styles.actionIcon,
              { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.pill },
            ]}
          >
            <Ionicons name={action.icon} size={22} color={action.color ?? theme.colors.text} />
          </View>
          <Text variant="caption" tone="secondary" align="center" numberOfLines={2}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export const SHEET_MAX_WIDTH = 520;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { overflow: 'hidden' },
  handleWrap: { alignItems: 'center', paddingVertical: 8 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1 },
  content: { flex: 1 },
  actionRow: { flexDirection: 'row', paddingVertical: 16 },
  action: { alignItems: 'center', gap: 6, width: 64 },
  actionIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
