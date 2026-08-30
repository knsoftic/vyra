/**
 * The live / sample label (ADR-028).
 *
 * Every wired screen has to answer the same question for the person looking at
 * it: is this real? Hand-rolling that answer per screen produced slightly
 * different wording and colour on each one, and a label that varies is a label
 * nobody learns to read. One component, one vocabulary.
 *
 * `SourceNote` is the full-width strip for a list header. `SourceTag` is the
 * compact form for a screen that already has a header row to sit in.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { useTheme } from '../theme';

export type DataSourceValue = 'live' | 'sample';

/** The wording is deliberately plain: no jargon, and never "demo" for real data. */
function describe(source: DataSourceValue, noun: string): string {
  return source === 'live' ? `Live ${noun}` : `Sample ${noun}`;
}

export function SourceTag({
  source,
  noun = 'data',
  detail,
}: {
  source: DataSourceValue;
  noun?: string;
  detail?: string;
}) {
  const theme = useTheme();
  const live = source === 'live';
  const colour = live ? theme.colors.accent : theme.colors.gold;

  return (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: live ? 'rgba(61,220,151,0.16)' : 'rgba(255,176,32,0.16)',
          borderRadius: theme.radius.pill,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: colour }]} />
      <Text variant="caption" style={{ color: colour }}>
        {describe(source, noun)}
        {detail ? ` · ${detail}` : ''}
      </Text>
    </View>
  );
}

export function SourceNote({
  source,
  noun = 'data',
  sampleHint,
  liveHint,
}: {
  source: DataSourceValue;
  noun?: string;
  /** Why sample data is showing — usually "the backend has none yet". */
  sampleHint?: string;
  liveHint?: string;
}) {
  const theme = useTheme();
  const live = source === 'live';
  const colour = live ? theme.colors.accent : theme.colors.gold;
  const hint = live ? liveHint : sampleHint;

  return (
    <View
      style={[
        styles.note,
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          margin: theme.spacing.md,
          padding: theme.spacing.sm,
        },
      ]}
    >
      <Ionicons
        name={live ? 'cloud-done-outline' : 'flask-outline'}
        size={16}
        color={colour}
      />
      <Text variant="caption" tone="muted" style={styles.flex}>
        <Text variant="caption" style={{ color: colour }}>
          {describe(source, noun)}
        </Text>
        {hint ? ` — ${hint}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
