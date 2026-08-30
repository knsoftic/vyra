import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useGridTileWidth } from '../hooks/useResponsive';
import { Text } from './Text';
import { Pressable } from './Pressable';
import { formatCount, formatDuration } from '../utils/format';
import { Video } from '../types';

export const GRID_GAP = 2;

// ─────────────────────────────── Badges ─────────────────────────────────

export function Badge({
  label,
  tone = 'brand',
  size = 'md',
  style,
}: {
  label: string;
  tone?: 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral' | 'gold';
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();

  const map = {
    brand: { bg: theme.colors.brandSoft, fg: theme.colors.brand },
    accent: { bg: theme.colors.accentSoft, fg: theme.colors.accent },
    success: { bg: theme.colors.successSoft, fg: theme.colors.success },
    warning: { bg: theme.colors.warningSoft, fg: theme.colors.warning },
    danger: { bg: theme.colors.dangerSoft, fg: theme.colors.danger },
    neutral: { bg: theme.colors.surfaceAlt, fg: theme.colors.textSecondary },
    gold: { bg: 'rgba(255,201,60,0.16)', fg: theme.colors.gold },
  } as const;

  const c = map[tone];

  return (
    <View
      style={[
        {
          backgroundColor: c.bg,
          borderRadius: theme.radius.xs,
          paddingHorizontal: size === 'sm' ? 5 : 7,
          paddingVertical: size === 'sm' ? 1 : 3,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <Text variant="caption" style={{ color: c.fg }}>
        {label}
      </Text>
    </View>
  );
}

/** Small unread count pill used on tabs and chat rows. */
export function CountBadge({ count, max = 99 }: { count: number; max?: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={[
        styles.countBadge,
        { backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill },
      ]}
    >
      <Text variant="caption" style={styles.countText}>
        {count > max ? `${max}+` : count}
      </Text>
    </View>
  );
}

// ────────────────────────────── Stat card ───────────────────────────────

export function StatCard({
  label,
  value,
  delta,
  icon,
  tone = 'neutral',
  style,
}: {
  label: string;
  value: string;
  delta?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'neutral' | 'brand' | 'success' | 'gold';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const accent =
    tone === 'brand'
      ? theme.colors.brand
      : tone === 'success'
        ? theme.colors.success
        : tone === 'gold'
          ? theme.colors.gold
          : theme.colors.textSecondary;

  const positive = delta?.startsWith('-') ? false : true;

  return (
    <View
      style={[
        styles.statCard,
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.md,
        },
        style,
      ]}
    >
      <View style={styles.statTop}>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </Text>
        {icon ? <Ionicons name={icon} size={14} color={accent} /> : null}
      </View>
      <Text variant="h2" style={{ marginTop: theme.spacing.xxs }} numberOfLines={1}>
        {value}
      </Text>
      {delta ? (
        <View style={styles.statDelta}>
          <Ionicons
            name={positive ? 'trending-up' : 'trending-down'}
            size={12}
            color={positive ? theme.colors.success : theme.colors.danger}
          />
          <Text variant="caption" tone={positive ? 'success' : 'danger'}>
            {delta}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ────────────────────────────── Video tile ──────────────────────────────

export function VideoTile({
  video,
  onPress,
  width,
  showViews = true,
  badge,
}: {
  video: Video;
  onPress?: () => void;
  /** Defaults to a third of the available content width. */
  width?: number;
  showViews?: boolean;
  badge?: string;
}) {
  const theme = useTheme();
  const defaultWidth = useGridTileWidth(3, GRID_GAP);
  const tileWidth = width ?? defaultWidth;
  const height = tileWidth * 1.72;

  return (
    <Pressable onPress={onPress} style={{ width: tileWidth, height }}>
      <Image
        source={{ uri: video.poster }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={150}
      />
      <LinearGradient
        colors={[...theme.gradients.dark]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {video.privacy !== 'public' ? (
        <View style={styles.tileTopRight}>
          <Ionicons
            name={video.privacy === 'private' ? 'lock-closed' : 'people'}
            size={12}
            color="#FFF"
          />
        </View>
      ) : null}

      {badge ? (
        <View style={styles.tileTopLeft}>
          <Badge label={badge} tone="brand" size="sm" />
        </View>
      ) : null}

      <View style={styles.tileBottom}>
        {showViews ? (
          <View style={styles.tileStat}>
            <Ionicons name="play" size={11} color="#FFF" />
            <Text variant="caption" tone="onDark">
              {formatCount(video.stats.views)}
            </Text>
          </View>
        ) : null}
        <Text variant="caption" tone="onDark">
          {formatDuration(video.durationSec)}
        </Text>
      </View>
    </Pressable>
  );
}

// ────────────────────────── Horizontal media card ───────────────────────

export function MediaCard({
  image,
  title,
  subtitle,
  overlay,
  width = 150,
  aspect = 1.5,
  onPress,
  live = false,
}: {
  image: string;
  title: string;
  subtitle?: string;
  overlay?: string;
  width?: number;
  aspect?: number;
  onPress?: () => void;
  live?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={{ width }}>
      <View
        style={{
          width,
          height: width * aspect,
          borderRadius: theme.radius.md,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceAlt,
        }}
      >
        <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        <LinearGradient colors={[...theme.gradients.dark]} style={StyleSheet.absoluteFill} />

        {live ? (
          <View style={[styles.liveTag, { backgroundColor: theme.colors.brand }]}>
            <View style={styles.liveDot} />
            <Text variant="caption" tone="onDark">
              LIVE
            </Text>
          </View>
        ) : null}

        {overlay ? (
          <View style={styles.tileBottom}>
            <View style={styles.tileStat}>
              <Ionicons name={live ? 'eye' : 'play'} size={11} color="#FFF" />
              <Text variant="caption" tone="onDark">
                {overlay}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <Text variant="label" numberOfLines={1} style={{ marginTop: theme.spacing.xs }}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  countBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  statCard: { flex: 1, minWidth: 150 },
  statTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  statDelta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  tileBottom: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileStat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileTopRight: { position: 'absolute', top: 6, right: 6 },
  tileTopLeft: { position: 'absolute', top: 6, left: 6 },
  liveTag: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFF' },
});
