import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Card,
  StatCard,
  Segmented,
  ChipRow,
  SectionTitle,
  VideoTile,
  Badge,
  ListRow,
  Divider,
} from '../../components';
import { BarChart, TrendChart, BreakdownBars, ProgressRing } from '../../components/Charts';
import { useTheme } from '../../theme';
import { creatorAnalytics } from '../../mock';
import { formatCount, percent } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

type Tab = 'overview' | 'content' | 'audience' | 'revenue';

export function CreatorDashboardScreen({ navigation }: RootScreenProps<'CreatorDashboard'>) {
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState('7d');

  const a = creatorAnalytics;

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

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Segmented
          options={[
            { id: 'overview', label: 'Overview' },
            { id: 'content', label: 'Content' },
            { id: 'audience', label: 'Audience' },
            { id: 'revenue', label: 'Revenue' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      <View style={{ paddingBottom: theme.spacing.sm }}>
        <ChipRow
          items={[
            { id: '7d', label: 'Last 7 days' },
            { id: '28d', label: 'Last 28 days' },
            { id: '60d', label: 'Last 60 days' },
            { id: 'all', label: 'All time' },
          ]}
          selectedId={range}
          onSelect={setRange}
        />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {tab === 'overview' ? (
          <>
            <View style={[styles.statsGrid, { paddingHorizontal: theme.spacing.md }]}>
              <StatCard label="Followers" value={formatCount(a.followers)} delta={`+${formatCount(a.followerGrowth)}`} icon="people-outline" tone="brand" />
              <StatCard label="Views" value={formatCount(a.views)} delta="+18%" icon="play-outline" />
              <StatCard label="Likes" value={formatCount(a.likes)} delta="+12%" icon="heart-outline" />
              <StatCard label="Watch time" value={`${formatCount(a.watchTimeHours)}h`} delta="+22%" icon="time-outline" tone="success" />
            </View>

            <SectionTitle title="Views" />
            <Card padded>
              <BarChart data={a.viewsSeries} height={150} />
            </Card>

            <SectionTitle title="Follower growth" />
            <Card padded>
              <TrendChart data={a.followerSeries} height={120} />
            </Card>

            <SectionTitle title="Watch quality" />
            <Card padded>
              <View style={styles.qualityRow}>
                <ProgressRing percent={a.completionRate} label="Completion" />
                <ProgressRing percent={a.rewatchRate} label="Rewatch" accent={theme.colors.accent} />
                <View style={styles.qualityText}>
                  <Text variant="h2">{a.avgWatchSeconds.toFixed(1)}s</Text>
                  <Text variant="caption" tone="muted">
                    Average watch time
                  </Text>
                </View>
              </View>
              <Divider />
              <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                Completion and watch time matter more than follower count. A video that holds
                attention keeps getting shown to new audiences.
              </Text>
            </Card>
          </>
        ) : null}

        {tab === 'content' ? (
          <>
            <View style={[styles.statsGrid, { paddingHorizontal: theme.spacing.md }]}>
              <StatCard label="Shares" value={formatCount(a.shares)} icon="arrow-redo-outline" />
              <StatCard label="Saves" value={formatCount(a.saves)} icon="bookmark-outline" />
              <StatCard label="Profile visits" value={formatCount(a.profileVisits)} icon="person-outline" />
              <StatCard label="Completion" value={percent(a.completionRate, 1)} icon="checkmark-done-outline" tone="success" />
            </View>

            <SectionTitle title="Top performing videos" />
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
                  <VideoTile video={video} width={48} showViews={false} />
                  <View style={styles.flex}>
                    <Text variant="label" numberOfLines={2}>
                      {video.caption}
                    </Text>
                    <View style={styles.videoStats}>
                      <Text variant="caption" tone="muted">
                        {formatCount(video.stats.views)} views
                      </Text>
                      <Text variant="caption" tone="muted">
                        {formatCount(video.stats.likes)} likes
                      </Text>
                    </View>
                  </View>
                  {video.quality ? (
                    <Badge
                      label={`Q ${video.quality.overall}`}
                      tone={video.quality.overall >= 85 ? 'success' : video.quality.overall >= 70 ? 'accent' : 'neutral'}
                      size="sm"
                    />
                  ) : null}
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {tab === 'audience' ? (
          <>
            <SectionTitle title="What your audience watches" />
            <Card padded>
              <BreakdownBars items={a.audienceCategories} />
            </Card>

            <SectionTitle title="When they are active" />
            <Card padded>
              <BarChart
                data={[
                  { label: '00', value: 12 },
                  { label: '04', value: 6 },
                  { label: '08', value: 28 },
                  { label: '12', value: 54 },
                  { label: '16', value: 71 },
                  { label: '20', value: 96 },
                  { label: '23', value: 44 },
                ]}
                height={130}
                accent={theme.colors.accent}
              />
              <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                Your audience is most active around 20:00. Posting shortly before that tends to
                catch the early test audience while they are online.
              </Text>
            </Card>

            <SectionTitle title="Audience overlap" />
            <Card>
              <ListRow label="Returning viewers" value="61%" showChevron={false} icon="repeat-outline" />
              <Divider inset={60} />
              <ListRow label="New viewers" value="39%" showChevron={false} icon="person-add-outline" />
              <Divider inset={60} />
              <ListRow label="Followers watching" value="44%" showChevron={false} icon="people-outline" />
            </Card>
          </>
        ) : null}

        {tab === 'revenue' ? (
          <>
            <View style={[styles.statsGrid, { paddingHorizontal: theme.spacing.md }]}>
              <StatCard label="Gift coins" value={formatCount(a.giftsCoins)} icon="gift-outline" tone="gold" />
              <StatCard label="This month" value="8,400" delta="+34%" icon="trending-up-outline" tone="success" />
            </View>

            <SectionTitle title="Gift coins over time" />
            <Card padded>
              <BarChart
                data={[
                  { label: 'W1', value: 3400 },
                  { label: 'W2', value: 5200 },
                  { label: 'W3', value: 4100 },
                  { label: 'W4', value: 8400 },
                ]}
                height={140}
                accent={theme.colors.gold}
                showValues
              />
            </Card>

            <SectionTitle title="Payouts" />
            <Card>
              <ListRow
                label="Live gift earnings"
                description="Gifts received while streaming"
                icon="sparkles-outline"
                onPress={() => navigation.navigate('LiveEarnings')}
              />
              <Divider inset={60} />
              <ListRow
                label="Withdraw earnings"
                description="USDT, bank transfer or mobile wallet"
                icon="arrow-up-circle-outline"
                onPress={() => navigation.navigate('Withdraw')}
              />
              <Divider inset={60} />
              <ListRow
                label="Monetization status"
                icon="ribbon-outline"
                onPress={() => navigation.navigate('Monetization')}
              />
              <Divider inset={60} />
              <ListRow label="Wallet balance" icon="wallet-outline" onPress={() => navigation.navigate('Wallet')} />
              <Divider inset={60} />
              <ListRow label="Transaction history" icon="receipt-outline" onPress={() => navigation.navigate('Transactions')} />
              <Divider inset={60} />
              <ListRow
                label="Payout method"
                description="Set up how you receive earnings"
                icon="card-outline"
                value="Not set"
                onPress={() => navigation.navigate('Withdraw')}
              />
            </Card>

            <View style={{ padding: theme.spacing.md }}>
              <Button
                label="Promote a video"
                variant="gradient"
                fullWidth
                icon="trending-up"
                onPress={() => navigation.navigate('Promotion', {})}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  qualityRow: { flexDirection: 'row', alignItems: 'center', gap: 16, justifyContent: 'space-around' },
  qualityText: { alignItems: 'center' },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rank: { width: 20, textAlign: 'center' },
  videoStats: { flexDirection: 'row', gap: 12, marginTop: 3 },
});
