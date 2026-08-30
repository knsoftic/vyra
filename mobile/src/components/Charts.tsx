import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';
import { Text } from './Text';
import { TimeSeriesPoint } from '../types';
import { formatCount } from '../utils/format';

/**
 * Lightweight charts built from plain views — no charting dependency.
 * Sufficient for the analytics surfaces; swap for a real chart library if the
 * dashboards later need axes, tooltips and zoom.
 */

export function BarChart({
  data,
  height = 140,
  showValues = false,
  accent,
}: {
  data: TimeSeriesPoint[];
  height?: number;
  showValues?: boolean;
  accent?: string;
}) {
  const theme = useTheme();
  const max = Math.max(...data.map((d) => d.value), 1);
  const color = accent ?? theme.colors.brand;

  return (
    <View>
      <View style={[styles.barRow, { height }]}>
        {data.map((point) => {
          const ratio = point.value / max;
          return (
            <View key={point.label} style={styles.barColumn}>
              {showValues ? (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {formatCount(point.value)}
                </Text>
              ) : null}
              <View style={styles.barTrack}>
                <LinearGradient
                  colors={[color, `${color}55`]}
                  style={[
                    styles.bar,
                    { height: `${Math.max(4, ratio * 100)}%`, borderRadius: theme.radius.xs },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.labelRow}>
        {data.map((point) => (
          <Text key={point.label} variant="caption" tone="muted" align="center" style={styles.flex}>
            {point.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

/**
 * Sparkline-style area chart approximated with vertical columns.
 * Reads as a trend line at a glance without pulling in SVG.
 */
export function TrendChart({
  data,
  height = 120,
  accent,
}: {
  data: TimeSeriesPoint[];
  height?: number;
  accent?: string;
}) {
  const theme = useTheme();
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = Math.max(1, max - min);
  const color = accent ?? theme.colors.accent;

  return (
    <View>
      <View style={[styles.trendRow, { height }]}>
        {data.map((point, index) => {
          const ratio = (point.value - min) / range;
          return (
            <View key={`${point.label}-${index}`} style={styles.trendColumn}>
              <View style={{ flex: 1 - ratio }} />
              <View
                style={[
                  styles.trendDot,
                  { backgroundColor: color, borderColor: theme.colors.bg },
                ]}
              />
              <LinearGradient
                colors={[`${color}44`, 'transparent']}
                style={{ flex: Math.max(0.02, ratio) }}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.labelRow}>
        {data.map((point, index) => (
          <Text
            key={`${point.label}-${index}`}
            variant="caption"
            tone="muted"
            align="center"
            style={styles.flex}
          >
            {point.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Horizontal percentage breakdown — audience categories, top locations. */
export function BreakdownBars({
  items,
  accent,
}: {
  items: { label: string; percent: number }[];
  accent?: string;
}) {
  const theme = useTheme();
  const color = accent ?? theme.colors.brand;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {items.map((item) => (
        <View key={item.label}>
          <View style={styles.breakdownHeader}>
            <Text variant="label" numberOfLines={1} style={styles.flex}>
              {item.label}
            </Text>
            <Text variant="label" tone="secondary">
              {item.percent}%
            </Text>
          </View>
          <View
            style={[
              styles.breakdownTrack,
              { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.xs },
            ]}
          >
            <View
              style={{
                width: `${item.percent}%`,
                height: '100%',
                backgroundColor: color,
                borderRadius: theme.radius.xs,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Circular progress ring used for completion rate and campaign spend. */
export function ProgressRing({
  percent,
  size = 72,
  label,
  accent,
}: {
  percent: number;
  size?: number;
  label?: string;
  accent?: string;
}) {
  const theme = useTheme();
  const color = accent ?? theme.colors.brand;
  const thickness = 6;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: thickness,
          borderColor: theme.colors.surfaceAlt,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: thickness,
          borderColor: color,
          // Approximate arc: full ring below 50%, partial above.
          borderRightColor: percent > 25 ? color : 'transparent',
          borderBottomColor: percent > 50 ? color : 'transparent',
          borderLeftColor: percent > 75 ? color : 'transparent',
          transform: [{ rotate: '-45deg' }],
        }}
      />
      <Text variant="bodyStrong">{Math.round(percent)}%</Text>
      {label ? (
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  barColumn: { flex: 1, height: '100%', justifyContent: 'flex-end', gap: 4 },
  barTrack: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%' },
  labelRow: { flexDirection: 'row', marginTop: 6, gap: 6 },
  trendRow: { flexDirection: 'row', alignItems: 'stretch', gap: 2 },
  trendColumn: { flex: 1 },
  trendDot: { height: 6, borderRadius: 3, borderWidth: 1 },
  breakdownHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, gap: 8 },
  breakdownTrack: { height: 6, overflow: 'hidden' },
});
