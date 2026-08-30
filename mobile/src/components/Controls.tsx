import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Switch,
  PanResponder,
  LayoutChangeEvent,
  ScrollView,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Text } from './Text';
import { Pressable } from './Pressable';

// ──────────────────────────────── Chip ──────────────────────────────────

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'sm' | 'md';
  tone?: 'default' | 'brand';
  style?: StyleProp<ViewStyle>;
}

export function Chip({ label, selected = false, onPress, icon, size = 'md', tone = 'default', style }: ChipProps) {
  const theme = useTheme();
  const compact = size === 'sm';

  const bg = selected
    ? tone === 'brand'
      ? theme.colors.brand
      : theme.colors.text
    : theme.colors.surfaceAlt;
  const fg = selected
    ? tone === 'brand'
      ? '#FFFFFF'
      : theme.colors.textInverse
    : theme.colors.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: bg,
          borderRadius: theme.radius.pill,
          paddingHorizontal: compact ? theme.spacing.sm : theme.spacing.md,
          height: compact ? 30 : 36,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={compact ? 13 : 15} color={fg} /> : null}
      <Text variant={compact ? 'caption' : 'label'} style={{ color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Horizontally scrolling row of chips. */
export function ChipRow({
  items,
  selectedId,
  onSelect,
  contentPadding = 16,
}: {
  items: { id: string; label: string; icon?: keyof typeof Ionicons.glyphMap }[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  contentPadding?: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: contentPadding, gap: 8 }}
    >
      {items.map((item) => (
        <Chip
          key={item.id}
          label={item.label}
          icon={item.icon}
          selected={item.id === selectedId}
          onPress={() => onSelect?.(item.id)}
        />
      ))}
    </ScrollView>
  );
}

// ──────────────────────────── Segmented control ─────────────────────────

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.segmented,
        { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md },
        style,
      ]}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            style={[
              styles.segment,
              {
                backgroundColor: active ? theme.colors.bg : 'transparent',
                borderRadius: theme.radius.sm,
              },
            ]}
          >
            <Text variant="label" tone={active ? 'primary' : 'secondary'} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─────────────────────────────── Top tabs ───────────────────────────────

export function TopTabs<T extends string>({
  tabs,
  value,
  onChange,
  onDark = false,
  centered = false,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  onDark?: boolean;
  centered?: boolean;
}) {
  const theme = useTheme();
  const activeColor = onDark ? '#FFFFFF' : theme.colors.text;
  const inactiveColor = onDark ? 'rgba(255,255,255,0.6)' : theme.colors.textMuted;

  return (
    <View style={[styles.tabsRow, centered && styles.tabsCentered]}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <Pressable key={tab.id} onPress={() => onChange(tab.id)} style={styles.tab}>
            <Text
              variant="bodyStrong"
              style={{ color: active ? activeColor : inactiveColor }}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
            <View
              style={[
                styles.tabIndicator,
                { backgroundColor: active ? activeColor : 'transparent' },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

// ──────────────────────────────── Toggle ────────────────────────────────

export function Toggle({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: theme.colors.borderStrong, true: theme.colors.brand }}
      thumbColor="#FFFFFF"
      ios_backgroundColor={theme.colors.borderStrong}
    />
  );
}

// ──────────────────────────────── Slider ────────────────────────────────

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  /** Draws the fill from the centre — correct for -100..100 adjustment controls. */
  bipolar?: boolean;
  trackColor?: string;
  fillColor?: string;
}

/**
 * Gesture slider built on PanResponder so the app carries no extra native
 * dependency for the eleven adjustment controls and the volume mixers.
 */
export function Slider({
  value,
  min = 0,
  max = 100,
  onChange,
  bipolar = false,
  trackColor,
  fillColor,
}: SliderProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  }, []);

  const updateFromX = useCallback(
    (x: number) => {
      const w = widthRef.current;
      if (w <= 0) return;
      const ratio = Math.min(1, Math.max(0, x / w));
      onChange(Math.round(min + ratio * (max - min)));
    },
    [min, max, onChange],
  );

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => updateFromX(event.nativeEvent.locationX),
      onPanResponderMove: (_, gesture) => {
        const w = widthRef.current;
        if (w <= 0) return;
        const ratio = (valueRef.current - min) / (max - min);
        updateFromX(ratio * w + gesture.dx);
      },
    }),
  ).current;

  const ratio = (value - min) / (max - min);
  const thumbX = ratio * width;
  const centerX = width / 2;

  const fillLeft = bipolar ? Math.min(centerX, thumbX) : 0;
  const fillWidth = bipolar ? Math.abs(thumbX - centerX) : thumbX;

  return (
    <View style={styles.sliderTouch} onLayout={onLayout} {...responder.panHandlers}>
      <View
        style={[
          styles.sliderTrack,
          { backgroundColor: trackColor ?? theme.colors.borderStrong },
        ]}
      />
      <View
        style={[
          styles.sliderFill,
          {
            left: fillLeft,
            width: fillWidth,
            backgroundColor: fillColor ?? theme.colors.brand,
          },
        ]}
      />
      <View
        style={[
          styles.sliderThumb,
          {
            left: Math.max(0, Math.min(width - 18, thumbX - 9)),
            backgroundColor: '#FFFFFF',
            borderColor: fillColor ?? theme.colors.brand,
          },
        ]}
      />
    </View>
  );
}

/** Labelled slider row with a live value read-out and a reset affordance. */
export function SliderRow({
  label,
  value,
  min = -100,
  max = 100,
  defaultValue = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  defaultValue?: number;
  onChange: (value: number) => void;
}) {
  const theme = useTheme();
  const changed = value !== defaultValue;

  return (
    <View style={{ paddingVertical: theme.spacing.sm }}>
      <View style={styles.sliderHeader}>
        <Text variant="label" tone="secondary">
          {label}
        </Text>
        <View style={styles.sliderHeaderRight}>
          <Text variant="label" tone={changed ? 'brand' : 'muted'}>
            {value > 0 && min < 0 ? `+${value}` : value}
          </Text>
          {changed ? (
            <Pressable onPress={() => onChange(defaultValue)} hitSlop={theme.layout.hitSlop}>
              <Ionicons name="refresh" size={14} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <Slider value={value} min={min} max={max} onChange={onChange} bipolar={min < 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  segmented: { flexDirection: 'row', padding: 3 },
  segment: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center' },
  tabsRow: { flexDirection: 'row', alignItems: 'center' },
  tabsCentered: { justifyContent: 'center' },
  tab: { paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', gap: 6 },
  tabIndicator: { height: 2.5, width: 20, borderRadius: 2 },
  sliderTouch: { height: 32, justifyContent: 'center' },
  sliderTrack: { height: 4, borderRadius: 2, width: '100%' },
  sliderFill: { position: 'absolute', height: 4, borderRadius: 2 },
  sliderThumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
