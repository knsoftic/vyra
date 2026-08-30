/**
 * Notification settings.
 *
 * Every switch on this screen writes to the server the moment it moves. The
 * previous version held its state in the component and saved nothing, so it
 * looked like it worked, survived until you left the screen, and then forgot —
 * which is worse than having no settings at all, because someone who turns off
 * marketing email has been told it is off.
 *
 * Three channels per category, because they are three different questions: what
 * appears in your inbox, what interrupts you, and what reaches your email.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Card,
  SectionHeader,
  Divider,
  Toggle,
  Text,
  Chip,
  SourceNote,
} from '../../components';
import { useTheme } from '../../theme';
import { useApiData } from '../../hooks/useApiData';
import { notifications as notificationsApi } from '../../api';
import type {
  ChannelPreferences,
  NotificationPreferences,
  PreferenceKind,
} from '../../api/notifications';
import type { RootScreenProps } from '../../navigation/types';

type Channel = keyof ChannelPreferences;

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'inApp', label: 'In app' },
  { key: 'push', label: 'Push' },
  { key: 'email', label: 'Email' },
];

const SECTIONS: { title: string; kinds: { kind: PreferenceKind; label: string }[] }[] = [
  {
    title: 'Interactions',
    kinds: [
      { kind: 'like', label: 'Likes' },
      { kind: 'comment', label: 'Comments' },
      { kind: 'follow', label: 'New followers' },
      { kind: 'mention', label: 'Mentions and tags' },
    ],
  },
  {
    title: 'Earnings',
    kinds: [
      { kind: 'gift', label: 'Gifts and coins' },
      { kind: 'task', label: 'Task rewards' },
      { kind: 'campaign', label: 'Campaign updates' },
    ],
  },
  {
    title: 'Account',
    kinds: [
      { kind: 'verification', label: 'Verification' },
      { kind: 'system', label: 'Account and safety' },
      { kind: 'marketing', label: 'News and offers' },
    ],
  },
];

/**
 * Categories that cannot be silenced entirely.
 *
 * An account suspension or a verification decision has to be findable. Push and
 * email stay yours to turn off; the record does not.
 */
const ALWAYS_IN_APP: PreferenceKind[] = ['system', 'verification'];

/** Empty defaults, used only until the first response arrives. */
const EMPTY: NotificationPreferences = {
  preferences: {} as Record<PreferenceKind, ChannelPreferences>,
  quietHours: { start: null, end: null },
};

const QUIET_PRESETS: { label: string; start: number | null; end: number | null }[] = [
  { label: 'Off', start: null, end: null },
  { label: '10pm to 7am', start: 22, end: 7 },
  { label: '11pm to 8am', start: 23, end: 8 },
  { label: 'Midnight to 9am', start: 0, end: 9 },
];

function hourLabel(hour: number): string {
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

export function NotificationSettingsScreen({}: RootScreenProps<'NotificationSettings'>) {
  const theme = useTheme();

  const { data, source, loading, refresh } = useApiData<NotificationPreferences>(
    () => notificationsApi.preferences(),
    EMPTY,
    [],
    // These are the caller's own settings. An empty answer means "nothing stored
    // yet", which the server already resolves to defaults — substituting a
    // sample would show switches nobody set.
    { fallbackOnEmpty: false },
  );

  /** Rows currently in flight, so a switch cannot be double-tapped into a race. */
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  /** What the switches show. Applied optimistically, reverted if the save fails. */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [quiet, setQuiet] = useState<{ start: number | null; end: number | null } | null>(null);

  const live = source === 'live';
  const quietHours = quiet ?? data.quietHours;

  const channelValue = useCallback(
    (kind: PreferenceKind, channel: Channel): boolean => {
      const key = `${kind}.${channel}`;
      if (key in overrides) return overrides[key]!;
      return data.preferences[kind]?.[channel] ?? false;
    },
    [data.preferences, overrides],
  );

  const forget = (key: string) => (prev: Record<string, boolean>) => {
    const next = { ...prev };
    delete next[key];
    return next;
  };

  const setChannel = useCallback(
    async (kind: PreferenceKind, channel: Channel, next: boolean) => {
      const key = `${kind}.${channel}`;
      setSaving((prev) => ({ ...prev, [key]: true }));
      setOverrides((prev) => ({ ...prev, [key]: next }));
      setError(null);

      try {
        await notificationsApi.setPreference(kind, { [channel]: next });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That change did not save.');
      } finally {
        // Either way the local guess goes: on success the server's answer is now
        // in `data`, and on failure the switch must snap back rather than claim a
        // change that never reached the server.
        setOverrides(forget(key));
        setSaving(forget(key));
      }
    },
    [refresh],
  );

  const applyQuietHours = useCallback(
    async (start: number | null, end: number | null) => {
      const previous = quietHours;
      setQuiet({ start, end });
      setError(null);
      try {
        await notificationsApi.setQuietHours(start, end);
        await refresh();
        setQuiet(null);
      } catch (err) {
        setQuiet(previous);
        setError(err instanceof Error ? err.message : 'Quiet hours did not save.');
      }
    },
    [quietHours, refresh],
  );

  return (
    <Screen>
      <Header title="Notifications" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm }}>
          <SourceNote
            source={source}
            noun="notification settings"
            liveHint="Every switch saves as you move it."
            sampleHint="Sign in to load and change your settings."
          />
        </View>

        {error ? (
          <View
            style={[
              styles.error,
              { marginHorizontal: theme.spacing.md, marginTop: theme.spacing.sm, backgroundColor: theme.colors.surface },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
            <Text variant="caption" style={{ color: theme.colors.danger, flex: 1 }}>
              {error}
            </Text>
          </View>
        ) : null}

        {SECTIONS.map((section) => (
          <View key={section.title}>
            <SectionHeader title={section.title} />
            <Card>
              <View
                style={[
                  styles.headerRow,
                  { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
                ]}
              >
                <View style={styles.flex} />
                {CHANNELS.map((channel) => (
                  <Text key={channel.key} variant="caption" tone="muted" style={styles.channelHead}>
                    {channel.label}
                  </Text>
                ))}
              </View>

              {section.kinds.map((row, index) => (
                <View key={row.kind}>
                  {index > 0 ? <Divider inset={16} /> : null}
                  <View
                    style={[
                      styles.prefRow,
                      { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
                    ]}
                  >
                    <Text variant="body" style={styles.flex}>
                      {row.label}
                    </Text>
                    {CHANNELS.map((channel) => {
                      const locked = channel.key === 'inApp' && ALWAYS_IN_APP.includes(row.kind);
                      const busy = saving[`${row.kind}.${channel.key}`] === true;
                      return (
                        <View key={channel.key} style={styles.switchCell}>
                          <Toggle
                            value={locked ? true : channelValue(row.kind, channel.key)}
                            disabled={!live || locked || loading || busy}
                            onValueChange={(next) => void setChannel(row.kind, channel.key, next)}
                          />
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ))}

        <SectionHeader title="Quiet hours" />
        <Card>
          <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted">
              {quietHours.start === null || quietHours.end === null
                ? 'Push notifications can arrive at any time.'
                : `No push between ${hourLabel(quietHours.start)} and ${hourLabel(quietHours.end)}. ` +
                  'Everything still arrives in your inbox, you are just not woken for it.'}
            </Text>
            <View style={styles.presets}>
              {QUIET_PRESETS.map((preset) => (
                <Chip
                  key={preset.label}
                  label={preset.label}
                  selected={quietHours.start === preset.start && quietHours.end === preset.end}
                  onPress={live ? () => void applyQuietHours(preset.start, preset.end) : undefined}
                />
              ))}
            </View>
          </View>
        </Card>

        <View style={[styles.note, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }]}>
          <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textMuted} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            Account and verification notices always appear in your inbox, even with push and email
            off. A suspension or a decision has to be findable. Everything else is yours to silence.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  channelHead: { width: 56, textAlign: 'center' },
  prefRow: { flexDirection: 'row', alignItems: 'center' },
  switchCell: { width: 56, alignItems: 'center' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  error: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 10 },
});
