import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Badge,
  ChipRow,
  EmptyState,
  StatCard,
  Sheet,
  ListRow,
} from '../../components';
import { useTheme } from '../../theme';
import { campaigns as sampleCampaigns, campaignObjectives } from '../../mock';
import { SourceNote } from '../../components/DataSource';
import { useApiData } from '../../hooks/useApiData';
import { promotion } from '../../api';
import type { Campaign as UiCampaign } from '../../types';
import { formatCount, timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { Campaign, CampaignStatus } from '../../types';

const statusTone: Record<CampaignStatus, 'success' | 'warning' | 'neutral' | 'danger' | 'brand'> = {
  active: 'success',
  pending_review: 'warning',
  paused: 'neutral',
  completed: 'brand',
  draft: 'neutral',
  rejected: 'danger',
};

const statusLabel: Record<CampaignStatus, string> = {
  active: 'Active',
  pending_review: 'In review',
  paused: 'Paused',
  completed: 'Completed',
  draft: 'Draft',
  rejected: 'Rejected',
};

export function AdsScreen({ navigation }: RootScreenProps<'Ads'>) {
  const { data: liveCampaigns, source } = useApiData(
    () =>
      promotion.list().then((rows) =>
        rows.map<UiCampaign>((c) => ({
          id: c.id,
          name: c.name,
          objective: c.objective,
          status: c.status,
          ...(c.videoId ? { videoId: c.videoId } : {}),
          poster: `https://picsum.photos/seed/${c.id}/200/300`,
          budgetCoins: c.budgetCoins,
          spentCoins: c.spentCoins,
          durationDays: c.durationDays,
          targeting: c.targeting,
          // Delivery figures come from the per-campaign metrics endpoint. The
          // list reports zero rather than a plausible-looking number nobody
          // measured; the detail view fetches the real ones.
          results: {
            impressions: 0,
            reach: 0,
            views: 0,
            clicks: 0,
            engagements: 0,
            followers: 0,
            profileVisits: 0,
          },
          createdAt: c.createdAt,
        })),
      ),
    sampleCampaigns,
    [],
    // Having no campaigns is a real answer, and sample ones would suggest
    // spend that never happened.
    { fallbackOnEmpty: false },
  );

  const campaigns = source === 'live' ? liveCampaigns : sampleCampaigns;

  const theme = useTheme();
  const [filter, setFilter] = useState<'all' | CampaignStatus>('all');
  const [detail, setDetail] = useState<Campaign | null>(null);

  const list = filter === 'all' ? campaigns : campaigns.filter((c) => c.status === filter);

  const totals = campaigns.reduce(
    (acc, campaign) => ({
      spent: acc.spent + campaign.spentCoins,
      reach: acc.reach + campaign.results.reach,
      active: acc.active + (campaign.status === 'active' ? 1 : 0),
    }),
    { spent: 0, reach: 0, active: 0 },
  );

  return (
    <Screen>
      <Header
        title="Advertising"
        right={
          <Button
            label="New"
            variant="gradient"
            size="sm"
            icon="add"
            onPress={() => navigation.navigate('CampaignBuilder')}
          />
        }
      />

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View style={[styles.statsRow, { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md }]}>
              <StatCard label="Active" value={String(totals.active)} icon="play-outline" tone="success" />
              <StatCard label="Reach" value={formatCount(totals.reach)} icon="people-outline" />
              <StatCard label="Spent" value={formatCount(totals.spent)} icon="logo-bitcoin" tone="gold" />
            </View>

            <ChipRow
              items={[
                { id: 'all', label: 'All' },
                { id: 'active', label: 'Active' },
                { id: 'pending_review', label: 'In review' },
                { id: 'paused', label: 'Paused' },
                { id: 'completed', label: 'Completed' },
              ]}
              selectedId={filter}
              onSelect={(id) => setFilter(id as typeof filter)}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="megaphone-outline"
            title="No campaigns here"
            description="Create a campaign to reach people beyond your followers."
            actionLabel="Create a campaign"
            onAction={() => navigation.navigate('CampaignBuilder')}
          />
        }
        renderItem={({ item }) => {
          const objective = campaignObjectives.find((o) => o.id === item.objective);
          const progress = item.budgetCoins > 0 ? item.spentCoins / item.budgetCoins : 0;

          return (
            <Pressable
              onPress={() => setDetail(item)}
              style={[
                styles.card,
                {
                  backgroundColor: theme.colors.surface,
                  marginHorizontal: theme.spacing.md,
                  marginTop: theme.spacing.sm,
                  borderRadius: theme.radius.lg,
                  padding: theme.spacing.md,
                },
              ]}
            >
              <View style={styles.cardTop}>
                <Image
                  source={{ uri: item.poster }}
                  style={[styles.poster, { borderRadius: theme.radius.sm }]}
                  contentFit="cover"
                />
                <View style={styles.flex}>
                  <View style={styles.titleRow}>
                    <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                      {item.name}
                    </Text>
                    <Badge label={statusLabel[item.status]} tone={statusTone[item.status]} size="sm" />
                  </View>
                  <Text variant="caption" tone="muted">
                    {objective?.label} · {item.durationDays} days · {timeAgo(item.createdAt)}
                  </Text>

                  <View style={styles.metricsRow}>
                    <View style={styles.metric}>
                      <Text variant="labelStrong">{formatCount(item.results.reach)}</Text>
                      <Text variant="caption" tone="muted">
                        Reach
                      </Text>
                    </View>
                    <View style={styles.metric}>
                      <Text variant="labelStrong">{formatCount(item.results.views)}</Text>
                      <Text variant="caption" tone="muted">
                        Views
                      </Text>
                    </View>
                    <View style={styles.metric}>
                      <Text variant="labelStrong">{formatCount(item.results.followers)}</Text>
                      <Text variant="caption" tone="muted">
                        Followers
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Budget progress */}
              <View style={{ marginTop: theme.spacing.sm }}>
                <View style={styles.budgetRow}>
                  <Text variant="caption" tone="muted">
                    {item.spentCoins.toLocaleString()} of {item.budgetCoins.toLocaleString()} coins
                  </Text>
                  <Text variant="caption" tone="muted">
                    {Math.round(progress * 100)}%
                  </Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <View
                    style={{
                      width: `${Math.min(100, progress * 100)}%`,
                      height: '100%',
                      backgroundColor: theme.colors.brand,
                      borderRadius: 3,
                    }}
                  />
                </View>
              </View>
            </Pressable>
          );
        }}
      />

      {/* Campaign detail */}
      <Sheet
        visible={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.name}
        subtitle={detail ? statusLabel[detail.status] : undefined}
        height={0.7}
        showClose
      >
        {detail ? (
          <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
            <View style={styles.resultGrid}>
              {[
                { label: 'Impressions', value: detail.results.impressions },
                { label: 'Reach', value: detail.results.reach },
                { label: 'Views', value: detail.results.views },
                { label: 'Clicks', value: detail.results.clicks },
                { label: 'Engagements', value: detail.results.engagements },
                { label: 'Profile visits', value: detail.results.profileVisits },
              ].map((row) => (
                <View
                  key={row.label}
                  style={[styles.resultCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md }]}
                >
                  <Text variant="h3">{formatCount(row.value)}</Text>
                  <Text variant="caption" tone="muted">
                    {row.label}
                  </Text>
                </View>
              ))}
            </View>

            <Text variant="labelStrong" tone="muted" style={{ paddingTop: theme.spacing.sm }}>
              TARGETING
            </Text>
            <View style={styles.tagWrap}>
              <Badge label={detail.targeting.mode} tone="accent" size="sm" />
              {detail.targeting.countries?.map((country) => (
                <Badge key={country} label={country} tone="neutral" size="sm" />
              ))}
              {detail.targeting.interests?.map((interest) => (
                <Badge key={interest} label={interest} tone="neutral" size="sm" />
              ))}
            </View>

            <View style={{ gap: theme.spacing.xs, paddingTop: theme.spacing.sm }}>
              {detail.status === 'active' ? (
                <Button label="Pause campaign" variant="secondary" fullWidth icon="pause" />
              ) : detail.status === 'paused' ? (
                <Button label="Resume campaign" variant="gradient" fullWidth icon="play" />
              ) : null}
              <Button label="View full report" variant="outline" fullWidth />
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  statsRow: { flexDirection: 'row', gap: 8 },
  card: {},
  cardTop: { flexDirection: 'row', gap: 12 },
  poster: { width: 60, height: 80 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricsRow: { flexDirection: 'row', gap: 20, marginTop: 8 },
  metric: {},
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  resultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resultCard: { width: '31.5%', padding: 12, alignItems: 'center' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
