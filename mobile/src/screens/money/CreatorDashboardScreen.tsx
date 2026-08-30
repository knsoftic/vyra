import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Card,
  StatCard,
  ChipRow,
  SectionTitle,
  Segmented,
  EmptyState,
} from '../../components';
import { BarChart, TrendChart, BreakdownBars, ProgressRing } from '../../components/Charts';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useApiData } from '../../hooks/useApiData';
import { analytics as analyticsApi, type CreatorAnalytics } from '../../api/analytics';
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

type Tab = 'overview' | 'content' | 'audience';

const RANGES = [
  { id: '7', label: '7 days' },
  { id: '28', label: '28 days' },
  { id: '90', label: '90 days' },
];

/** Empty state while nothing has been measured — never a placeholder chart. */
const EMPTY: CreatorAnalytics = {
  days: 28,
  followers: 0,
  followerGrowth: 0,
  views: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  profileVisits: 0,
  giftCoins: 0,
  watchTimeHours: 0,
  avgWatchSeconds: null,
  completionRate: null,
  rewatchRate: null,
  viewsSeries: [],
  followerSeries: [],
  watchMinutesSeries: [],
  categories: [],
  sources: [],
  topVideos: [],
  hasNoVideos: true,
};

/**
 * The creator dashboard.
 *
 * Every number here was measured. It used to render a fixed sample — 1.28M
 * views, 61.2% completion, "+18%" beside figures nothing had compared — for
 * every account including brand-new ones.
 *
 * Rates are nullable on purpose: "nobody has watched yet" and "everyone left
 * immediately" are different facts, and showing 0% for the first is a lie about
 * the creator's work.
 */
export function CreatorDashboardScreen({ navigation }: RootScreenProps<'CreatorDashboard'>) {
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState('28');

  const { data: a, source, loading } = useApiData<CreatorAnalytics>(
    () => analyticsApi.creator(Number(range)),
    EMPTY,
    [range],
    { fallbackOnEmpty: false },
  );

  const live = source === 'live';
  const rate = (value: number | null) => (value === null ? '—' : `${value}%`);

  /** A series is only worth drawing once something is in it. */
  const hasSeries = (points: { value: number }[]) => points.some((p) => p.value > 0);
  const chartData = (points: { day: string; value: number }[]) =>
    points.map((p) => ({ label: p.day.slice(5), value: p.value }));

  return (
    <Screen>
      <Header
        title="Creator dashboard"
        right={
          <Pressable onPress={() => navigation.navigate('Promotion', {})} hitSlop={theme.layout.hitSlop}>
            <Ionicons name="trending-up-outline" size={22} color={theme.colors.text} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <SourceNote
          source={source}
          noun="analytics"
          liveHint="every figure here was measured on your account"
          sampleHint="sign in to see your own analytics"
        />

        <ChipRow
          items={RANGES}
          selectedId={range}
          onSelect={(id) => setRange(id)}
        />

        <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs }}>
          <Segmented
            options={[
              { id: 'overview', label: 'Overview' },
              { id: 'content', label: 'Content' },
              { id: 'audience', label: 'Audience' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.brand} />
          </View>
        ) : live && a.hasNoVideos ? (
          <EmptyState
            icon="stats-chart-outline"
            title="Nothing measured yet"
            description="Post a video and this fills with what actually happens to it — views, watch time, where people found it."
          />
        ) : (
          <>
            {tab === 'overview' ? (
              <>
                <View style={styles.statGrid}>
                  <StatCard
                    label="Followers"
                    value={formatCount(a.followers)}
                    delta={a.followerGrowth > 0 ? `+${formatCount(a.followerGrowth)}` : undefined}
                    icon="people-outline"
                    tone="brand"
                  />
                  <StatCard label="Views" value={formatCount(a.views)} icon="play-outline" />
                  <StatCard label="Likes" value={formatCount(a.likes)} icon="heart-outline" />
                  <StatCard
                    label="Watch time"
                    value={`${a.watchTimeHours}h`}
                    icon="time-outline"
                    tone="success"
                  />
                </View>

                <SectionTitle title={`Views · last ${a.days} days`} />
                <Card padded>
                  {hasSeries(a.viewsSeries) ? (
                    <BarChart data={chartData(a.viewsSeries)} height={150} />
                  ) : (
                    <Text variant="caption" tone="muted">
                      No views in this period yet.
                    </Text>
                  )}
                </Card>

                <SectionTitle title="New followers" />
                <Card padded>
                  {hasSeries(a.followerSeries) ? (
                    <TrendChart data={chartData(a.followerSeries)} height={120} />
                  ) : (
                    <Text variant="caption" tone="muted">
                      Nobody has followed you in this period.
                    </Text>
                  )}
                </Card>

                <SectionTitle title="How people watch" />
                <Card padded>
                  {a.completionRate === null ? (
                    <Text variant="caption" tone="muted">
                      These appear once someone has watched a video. Nothing has been watched in
                      this period — which is not the same as people leaving early.
                    </Text>
                  ) : (
                    <View style={styles.ringRow}>
                      <ProgressRing percent={a.completionRate} label="Completion" />
                      <ProgressRing
                        percent={a.rewatchRate ?? 0}
                        label="Rewatch"
                        accent={theme.colors.accent}
                      />
                      <View style={styles.avgBlock}>
                        <Text variant="h2">
                          {a.avgWatchSeconds === null ? '—' : `${a.avgWatchSeconds}s`}
                        </Text>
                        <Text variant="caption" tone="muted">
                          Average watch
                        </Text>
                      </View>
                    </View>
                  )}
                </Card>
              </>
            ) : null}

            {tab === 'content' ? (
              <>
                <View style={styles.statGrid}>
                  <StatCard label="Comments" value={formatCount(a.comments)} icon="chatbubble-outline" />
                  <StatCard label="Shares" value={formatCount(a.shares)} icon="arrow-redo-outline" />
                  <StatCard label="Saves" value={formatCount(a.saves)} icon="bookmark-outline" />
                  <StatCard
                    label="Completion"
                    value={rate(a.completionRate)}
                    icon="checkmark-done-outline"
                    tone="success"
                  />
                </View>

                <SectionTitle title="Watch minutes per day" />
                <Card padded>
                  {hasSeries(a.watchMinutesSeries) ? (
                    <BarChart
                      data={chartData(a.watchMinutesSeries)}
                      height={140}
                      accent={theme.colors.accent}
                    />
                  ) : (
                    <Text variant="caption" tone="muted">
                      No watch time recorded in this period.
                    </Text>
                  )}
                </Card>

                <SectionTitle title="Your most watched" />
                {a.topVideos.length === 0 ? (
                  <Card padded>
                    <Text variant="caption" tone="muted">
                      Nothing published yet.
                    </Text>
                  </Card>
                ) : (
                  <View style={{ gap: theme.spacing.xs }}>
                    {a.topVideos.map((video, index) => (
                      <Pressable
                        key={video.id}
                        onPress={() => navigation.navigate('VideoPlayer', { videoId: video.id })}
                        style={[
                          styles.videoRow,
                          {
                            backgroundColor: theme.colors.surface,
                            marginHorizontal: theme.spacing.md,
                            borderRadius: theme.radius.md,
                            padding: theme.spacing.sm,
                          },
                        ]}
                      >
                        <Text variant="h3" tone="muted" style={styles.rank}>
                          {index + 1}
                        </Text>
                        {video.posterUrl ? (
                          <Image
                            source={{ uri: video.posterUrl }}
                            style={[styles.poster, { borderRadius: theme.radius.sm }]}
                            contentFit="cover"
                          />
                        ) : (
                          <View
                            style={[
                              styles.poster,
                              { borderRadius: theme.radius.sm, backgroundColor: theme.colors.surfaceAlt },
                            ]}
                          />
                        )}
                        <View style={styles.flex}>
                          <Text variant="label" numberOfLines={2}>
                            {video.caption || 'Untitled'}
                          </Text>
                          <View style={styles.videoStats}>
                            <Text variant="caption" tone="muted">
                              {formatCount(video.views)} views
                            </Text>
                            <Text variant="caption" tone="muted">
                              {formatCount(video.likes)} likes
                            </Text>
                            <Text variant="caption" tone="muted">
                              {formatCount(video.watchMinutes)} min watched
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            ) : null}

            {tab === 'audience' ? (
              <>
                <View style={styles.statGrid}>
                  <StatCard label="Profile visits" value={formatCount(a.profileVisits)} icon="person-outline" />
                  <StatCard
                    label="Gift coins"
                    value={formatCount(a.giftCoins)}
                    icon="gift-outline"
                    tone="gold"
                  />
                </View>

                <SectionTitle title="Where people find you" />
                <Card padded>
                  {a.sources.length > 0 ? (
                    <BreakdownBars items={a.sources} />
                  ) : (
                    <Text variant="caption" tone="muted">
                      This shows which parts of the app brought people to your videos, once there
                      are views to attribute.
                    </Text>
                  )}
                </Card>

                <SectionTitle title="What they watch most" />
                <Card padded>
                  {a.categories.length > 0 ? (
                    <BreakdownBars items={a.categories} />
                  ) : (
                    <Text variant="caption" tone="muted">
                      Your categories appear here, weighted by watch time.
                    </Text>
                  )}
                </Card>

                <View style={[styles.note, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md }]}>
                  <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textMuted} />
                  <Text variant="caption" tone="muted" style={styles.flex}>
                    These figures come from what the platform measured, never from an estimate. You
                    are never shown who watched — only how many, and how they arrived.
                  </Text>
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { paddingVertical: 60, alignItems: 'center' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 },
  ringRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  avgBlock: { alignItems: 'center' },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rank: { width: 22, textAlign: 'center' },
  poster: { width: 48, height: 64 },
  videoStats: { flexDirection: 'row', gap: 12, marginTop: 2, flexWrap: 'wrap' },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
