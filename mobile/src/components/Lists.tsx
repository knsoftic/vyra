import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Pressable } from './Pressable';

// ─────────────────────────────── List row ───────────────────────────────

interface ListRowProps {
  label: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBackground?: string;
  value?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  danger?: boolean;
  left?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ListRow({
  label,
  description,
  icon,
  iconColor,
  iconBackground,
  value,
  right,
  onPress,
  showChevron,
  danger = false,
  left,
  style,
}: ListRowProps) {
  const theme = useTheme();
  const chevron = showChevron ?? !!onPress;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.row,
        { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, gap: theme.spacing.sm },
        style,
      ]}
    >
      {left}

      {icon && !left ? (
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: iconBackground ?? theme.colors.surfaceAlt,
              borderRadius: theme.radius.sm,
            },
          ]}
        >
          <Ionicons
            name={icon}
            size={18}
            color={iconColor ?? (danger ? theme.colors.danger : theme.colors.text)}
          />
        </View>
      ) : null}

      <View style={styles.flex}>
        <Text variant="body" tone={danger ? 'danger' : 'primary'} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text variant="caption" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>
            {description}
          </Text>
        ) : null}
      </View>

      {value ? (
        <Text variant="label" tone="muted" numberOfLines={1}>
          {value}
        </Text>
      ) : null}

      {right}

      {chevron ? (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
      ) : null}
    </Pressable>
  );
}

// ───────────────────────────── Section header ───────────────────────────

export function SectionHeader({
  title,
  action,
  onActionPress,
  style,
}: {
  title: string;
  action?: string;
  onActionPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.sectionHeader,
        { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xs },
        style,
      ]}
    >
      <Text variant="labelStrong" tone="muted" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </Text>
      {action ? (
        <Pressable onPress={onActionPress} hitSlop={theme.layout.hitSlop}>
          <Text variant="label" tone="brand">
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Larger, sentence-case heading used inside content screens. */
export function SectionTitle({
  title,
  action,
  onActionPress,
}: {
  title: string;
  action?: string;
  onActionPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.sectionHeader,
        { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xs },
      ]}
    >
      <Text variant="h3">{title}</Text>
      {action ? (
        <Pressable onPress={onActionPress} hitSlop={theme.layout.hitSlop}>
          <Text variant="label" tone="brand">
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─────────────────────────────── Divider ────────────────────────────────

export function Divider({ inset = 0 }: { inset?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border,
        marginLeft: inset,
      }}
    />
  );
}

/** Grouped settings card with hairline separators between children. */
export function Card({
  children,
  style,
  padded = false,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          marginHorizontal: theme.spacing.md,
          overflow: 'hidden',
          padding: padded ? theme.spacing.md : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ────────────────────────────── Empty state ─────────────────────────────

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.empty, { padding: compact ? theme.spacing.lg : theme.spacing.xxl }]}>
      <View
        style={[
          styles.emptyIcon,
          { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.pill },
        ]}
      >
        <Ionicons name={icon} size={compact ? 22 : 28} color={theme.colors.textMuted} />
      </View>
      <Text variant={compact ? 'bodyStrong' : 'h3'} align="center" style={{ marginTop: theme.spacing.md }}>
        {title}
      </Text>
      {description ? (
        <Text
          variant="label"
          tone="muted"
          align="center"
          style={{ marginTop: theme.spacing.xs, maxWidth: 300 }}
        >
          {description}
        </Text>
      ) : null}
      {actionLabel ? (
        <Pressable onPress={onAction} style={{ marginTop: theme.spacing.md }}>
          <Text variant="labelStrong" tone="brand">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  iconWrap: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { letterSpacing: 0.8 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
});
