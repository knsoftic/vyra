import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import { useTheme } from '../../theme';
import { formatCount } from '../../utils/format';

/**
 * "750 / 1,000 Followers" with a bar underneath.
 *
 * Used by the monetization criteria list and the daily task cards, so both read
 * the same way and a user learns the pattern once.
 */
export function ProgressRow({
  label,
  current,
  target,
  unit,
  hint,
  compact = false,
  done,
}: {
  label: string;
  current: number;
  target: number;
  unit?: string;
  hint?: string;
  compact?: boolean;
  /** Overrides the computed state — used for boolean gates. */
  done?: boolean;
}) {
  const theme = useTheme();
  const ratio = target > 0 ? Math.min(1, current / target) : 0;
  const complete = done ?? current >= target;

  return (
    <View style={{ paddingVertical: compact ? theme.spacing.xs : theme.spacing.sm }}>
      <View style={styles.header}>
        <View style={styles.labelRow}>
          <Ionicons
            name={complete ? 'checkmark-circle' : 'ellipse-outline'}
            size={14}
            color={complete ? theme.colors.success : theme.colors.textMuted}
          />
          <Text variant="label" tone={complete ? 'primary' : 'secondary'} numberOfLines={1}>
            {label}
          </Text>
        </View>

        <Text variant="label" tone={complete ? 'success' : 'muted'}>
          {complete && target === 1 ? 'Done' : `${formatCount(current)} / ${formatCount(target)}`}
          {unit && !(complete && target === 1) ? ` ${unit}` : ''}
        </Text>
      </View>

      {target > 1 ? (
        <View
          style={[
            styles.track,
            { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.xs },
          ]}
        >
          <View
            style={{
              width: `${ratio * 100}%`,
              height: '100%',
              borderRadius: theme.radius.xs,
              backgroundColor: complete ? theme.colors.success : theme.colors.brand,
            }}
          />
        </View>
      ) : null}

      {hint ? (
        <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Big headline number with a caption — used across the wallet surfaces. */
export function BalanceTile({
  label,
  value,
  caption,
  icon,
  tone = 'brand',
  onPress,
}: {
  label: string;
  value: string;
  caption?: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: 'brand' | 'accent' | 'gold' | 'muted';
  onPress?: () => void;
}) {
  const theme = useTheme();
  const color =
    tone === 'accent'
      ? theme.colors.accent
      : tone === 'gold'
        ? theme.colors.gold
        : tone === 'muted'
          ? theme.colors.textSecondary
          : theme.colors.brand;

  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.md },
      ]}
    >
      <View style={styles.tileTop}>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </Text>
        <Ionicons name={icon} size={14} color={color} />
      </View>
      <Text variant="h2" style={{ marginTop: 2, color }} numberOfLines={1}>
        {value}
      </Text>
      {caption ? (
        <Text variant="caption" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  track: { height: 5, marginTop: 6, overflow: 'hidden' },
  tile: { flex: 1, minWidth: 150 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
});
