import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Badge,
  EmptyState,
  Divider,
  ChipRow,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useApiData } from '../../hooks/useApiData';
import { account } from '../../api';
import { myReports } from '../../mock';
import { timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { ReportRecord } from '../../types';

const statusMeta: Record<
  ReportRecord['status'],
  { label: string; tone: 'warning' | 'success' | 'neutral' | 'accent'; icon: keyof typeof Ionicons.glyphMap }
> = {
  submitted: { label: 'Submitted', tone: 'neutral', icon: 'paper-plane-outline' },
  reviewing: { label: 'Under review', tone: 'warning', icon: 'time-outline' },
  action_taken: { label: 'Action taken', tone: 'success', icon: 'checkmark-circle-outline' },
  no_action: { label: 'No action', tone: 'neutral', icon: 'remove-circle-outline' },
};

const targetIcon: Record<ReportRecord['targetType'], keyof typeof Ionicons.glyphMap> = {
  user: 'person-outline',
  video: 'videocam-outline',
  comment: 'chatbubble-outline',
  live: 'radio-outline',
  group: 'people-outline',
  community: 'globe-outline',
};

export function ReportsScreen({}: RootScreenProps<'Reports'>) {
  const theme = useTheme();
  const [filter, setFilter] = useState<'all' | ReportRecord['status']>('all');

  // Someone who files a report is entitled to see what came of it, so this list
  // is read from the moderation queue rather than kept on the device.
  const { data: reports, source } = useApiData<ReportRecord[]>(
    () =>
      account.reports().then((rows) =>
        rows.map((r) => ({
          id: r.id,
          targetType: r.targetType as ReportRecord['targetType'],
          // The API does not return the target's name — a reported account may
          // since have been removed — so the row shows what kind of thing it was
          // rather than inventing a label.
          targetLabel: r.targetType,
          reason: r.reason,
          status: r.status,
          createdAt: r.createdAt,
        })),
      ),
    myReports,
    [],
    // Having reported nothing is a real answer.
    { fallbackOnEmpty: false },
  );

  const list = filter === 'all' ? reports : reports.filter((r) => r.status === filter);

  return (
    <Screen>
      <Header title="Your reports" />

      <View style={{ paddingBottom: theme.spacing.sm }}>
        <ChipRow
          items={[
            { id: 'all', label: 'All' },
            { id: 'reviewing', label: 'Under review' },
            { id: 'action_taken', label: 'Action taken' },
            { id: 'no_action', label: 'No action' },
          ]}
          selectedId={filter}
          onSelect={(id) => setFilter(id as typeof filter)}
        />
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <Divider inset={64} />}
        ListHeaderComponent={
          <>
          <SourceNote source={source} noun="reports" />
          <View
            style={[
              styles.notice,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.md,
                marginHorizontal: theme.spacing.md,
                marginBottom: theme.spacing.sm,
                padding: theme.spacing.sm,
              },
            ]}
          >
            <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.success} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Reports are reviewed by our moderation team. We never tell the reported account who
              reported them.
            </Text>
          </View>
          </>
        }
        ListEmptyComponent={
          <EmptyState
            icon="flag-outline"
            title="No reports here"
            description="Content you report will appear here with its review status."
          />
        }
        renderItem={({ item }) => {
          const status = statusMeta[item.status];
          return (
            <View
              style={[
                styles.row,
                { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
              ]}
            >
              <View
                style={[
                  styles.icon,
                  { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm },
                ]}
              >
                <Ionicons name={targetIcon[item.targetType]} size={18} color={theme.colors.textSecondary} />
              </View>

              <View style={styles.flex}>
                <Text variant="body" numberOfLines={1}>
                  {item.targetLabel}
                </Text>
                <Text variant="caption" tone="muted">
                  {item.reason} · {timeAgo(item.createdAt)}
                </Text>
              </View>

              <Badge label={status.label} tone={status.tone} size="sm" />
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
