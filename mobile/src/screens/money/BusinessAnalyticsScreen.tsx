import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Button,
  Card,
  StatCard,
  ChipRow,
  SectionTitle,
  ListRow,
  Divider,
  Badge,
} from '../../components';
import { BarChart, TrendChart, BreakdownBars } from '../../components/Charts';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useApiData } from '../../hooks/useApiData';
import { analytics as analyticsApi, type BusinessAnalytics } from '../../api/analytics';
import { formatCount } from '../../utils/format';
import { useApp } from '../../store/AppState';
import { useSession } from '../../store/SessionState';
import type { RootScreenProps } from '../../navigation/types';

const RANGES: { id: string; label: string; days: number }[] = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '28d', label: 'Last 28 days', days: 28 },
  { id: '90d', label: 'Last 90 days', days: 90 },
];

const EMPTY: BusinessAnalytics = {
  days: 28,
  profileVisits: 0,
  followerGrowth: 0,
  views: 0,
  ctaClicks: 0,
  profileVisitsChange: null,
  followerGrowthChange: null,
  viewsChange: null,
  ctaClicksChange: null,
  adSpendCoins: 0,
  adImpressions: 0,
  adReach: 0,
  adClicks: 0,
  costPerClickCoins: null,
  campaignsRunning: 0,
  hasCampaigns: false,
  reachSeries: [],
  visitSeries: [],
  topCategories: [],
};

/**
 * A change against the previous period, or nothing at all.
 *
 * Every tile on this screen used to carry a hardcoded green percentage —
 * "+24%", "+16%", "+9%", "+31%" — that never changed no matter what the account
 * did. A business could have been losing reach every week and still read four
 * green arrows. Where there is no comparison to make, the tile now shows no
 * arrow rather than an invented one.
 */
function delta(change: number | null): string | undefined {
  if (change === null || change === 0) return undefined;
  return `${change > 0 ? '+' : ''}${change}%`;
}

export function BusinessAnalyticsScreen({ navigation }: RootScreenProps<'BusinessAnalytics'>) {
  const theme = useTheme();
  const { user: sampleUser } = useApp();
  const { user: liveUser } = useSession();
  const [range, setRange] = useState('28d');

  /**
   * The signed-in account, not the sample one.
   *
   * The header used to read `useApp().user.displayName`, which is the sample
   * profile — so a page of the account's own measured numbers was titled with
   * somebody else's name. Everything the chrome depends on comes from the live
   * session where there is one; the sample user only stands in when nobody is
   * signed in and the whole screen is running on samples anyway.
   */
  const displayName = liveUser?.displayName ?? (liveUser ? undefined : sampleUser.displayName);
  const accountCategory = liveUser?.accountCategory ?? sampleUser.accountCategory;
  const verified = (liveUser?.verificationTier ?? sampleUser.verification) === 'business';
  const ctaLabel = liveUser
    ? (liveUser.business?.ctaLabel ?? null)
    : (sampleUser.cta?.label ?? null);

  const days = RANGES.find((r) => r.id === range)?.days ?? 28;

  const { data: b, source, loading } = useApiData<BusinessAnalytics>(
    () => analyticsApi.business(days),
    EMPTY,
    [days],
    { fallbackOnEmpty: false },
  );

  const hasReach = b.reachSeries.some((p) => p.value > 0);
  const hasVisits = b.visitSeries.some((p) => p.value > 0);
  const nothingYet =
    !loading && b.views === 0 && b.profileVisits === 0 && b.followerGrowth === 0 && !b.hasCampaigns;

  return (
    <Screen>
      <Header title="Business analytics" subtitle={displayName} />

      <View style={{ paddingBottom: theme.spacing.sm }}>
        <ChipRow
          items={RANGES.map((r) => ({ id: r.id, label: r.label }))}
          selectedId={range}
          onSelect={setRange}
        />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <SourceNote
          source={source}
          noun="analytics"
          liveHint="measured from your own account"
          sampleHint="sign in to see your analytics"
        />

        {/* Account type notice for individual accounts */}
        {accountCategory !== 'business' ? (
          <Card padded style={{ marginBottom: theme.spacing.md }}>
            <View style={styles.noticeRow}>
              <Ionicons name="business-outline" size={18} color={theme.colors.gold} />
              <View style={styles.flex}>
                <Text variant="bodyStrong">Business features preview</Text>
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  Switch to a business account to unlock the campaign manager, a call-to-action
                  button and click tracking. Your content, followers and wallet stay exactly as they
                  are.
                </Text>
              </View>
            </View>
            <Button
              label="Switch to business account"
              variant="secondary"
              fullWidth
              size="sm"
              style={{ marginTop: theme.spacing.sm }}
              onPress={() => navigation.navigate('EditProfile')}
            />
          </Card>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.brand} />
          </View>
        ) : (
          <>
            {nothingYet ? (
              <Card padded style={{ marginBottom: theme.spacing.md }}>
                <View style={styles.noticeRow}>
                  <Ionicons name="bar-chart-outline" size={18} color={theme.colors.textMuted} />
                  <Text variant="caption" tone="muted" style={styles.flex}>
                    Nothing recorded in this period yet. Numbers appear here as people watch your
                    videos, open your profile and tap your link — nothing is estimated, so an empty
                    period stays empty.
                  </Text>
                </View>
              </Card>
            ) : null}

            {/* What the account can act on. Four measured counts, nothing derived. */}
            <View style={[styles.statsGrid, { paddingHorizontal: theme.spacing.md }]}>
              <StatCard
                label="Profile views"
                value={formatCount(b.profileVisits)}
                delta={delta(b.profileVisitsChange)}
                icon="eye-outline"
                tone="brand"
              />
              <StatCard
                label="Video views"
                value={formatCount(b.views)}
                delta={delta(b.viewsChange)}
                icon="play-outline"
              />
              <StatCard
                label="Link taps"
                value={formatCount(b.ctaClicks)}
                delta={delta(b.ctaClicksChange)}
                icon="hand-left-outline"
              />
              <StatCard
                label="New followers"
                value={formatCount(b.followerGrowth)}
                delta={delta(b.followerGrowthChange)}
                icon="person-add-outline"
                tone="success"
              />
            </View>

            <SectionTitle title="Reach" />
            <Card padded>
              {hasReach ? (
                <BarChart
                  data={b.reachSeries.map((p) => ({ label: p.day.slice(5), value: p.value }))}
                  height={140}
                />
              ) : (
                <Text variant="caption" tone="muted">
                  No views in this period.
                </Text>
              )}
            </Card>

            <SectionTitle title="Profile visits" />
            <Card padded>
              {hasVisits ? (
                <TrendChart
                  data={b.visitSeries.map((p) => ({ label: p.day.slice(5), value: p.value }))}
                  height={120}
                  accent={theme.colors.gold}
                />
              ) : (
                <Text variant="caption" tone="muted">
                  Nobody has opened your profile in this period.
                </Text>
              )}
            </Card>

            {/*
              Categories, not locations. The old screen broke the audience down
              by city from sample data; the platform deliberately does not
              collect anyone's location, so there was no honest version of that
              chart. What people actually watch is measured, and is the thing a
              business can act on anyway.
            */}
            <SectionTitle title="What your audience watches" />
            <Card padded>
              {b.topCategories.length > 0 ? (
                <BreakdownBars items={b.topCategories} accent={theme.colors.accent} />
              ) : (
                <Text variant="caption" tone="muted">
                  This appears once people have watched your videos.
                </Text>
              )}
            </Card>

            {/* Advertising */}
            <SectionTitle
              title="Advertising"
              action="Manage"
              onActionPress={() => navigation.navigate('Ads')}
            />
            <Card>
              {b.hasCampaigns ? (
                <>
                  <ListRow
                    label="Active campaigns"
                    icon="megaphone-outline"
                    value={String(b.campaignsRunning)}
                    onPress={() => navigation.navigate('Ads')}
                  />
                  <Divider inset={60} />
                  <ListRow
                    label="Ad spend"
                    description={`In the last ${b.days} days`}
                    icon="logo-bitcoin"
                    value={`${formatCount(b.adSpendCoins)} coins`}
                    showChevron={false}
                  />
                  <Divider inset={60} />
                  <ListRow
                    label="People reached"
                    icon="people-outline"
                    value={formatCount(b.adReach)}
                    showChevron={false}
                  />
                  <Divider inset={60} />
                  <ListRow
                    label="Clicks"
                    icon="hand-left-outline"
                    value={formatCount(b.adClicks)}
                    showChevron={false}
                  />
                  <Divider inset={60} />
                  <ListRow
                    label="Cost per click"
                    // Null, not zero: spend with no clicks yet has no cost per
                    // click, and "0 coins" would read as free advertising.
                    description={b.costPerClickCoins === null ? 'No clicks recorded yet' : undefined}
                    icon="calculator-outline"
                    value={
                      b.costPerClickCoins === null ? '—' : `${b.costPerClickCoins} coins`
                    }
                    showChevron={false}
                  />
                  <Divider inset={60} />
                </>
              ) : (
                <View style={{ padding: theme.spacing.md }}>
                  <Text variant="caption" tone="muted">
                    You have not run a campaign yet. Spend, reach and cost per click appear here
                    once one is running.
                  </Text>
                </View>
              )}
              <ListRow
                label="Create a campaign"
                icon="add-circle-outline"
                onPress={() => navigation.navigate('CampaignBuilder')}
              />
            </Card>

            {/* Business tools */}
            <SectionTitle title="Business tools" />
            <Card>
              <ListRow
                label="Call-to-action button"
                description={ctaLabel ?? 'Not set up'}
                icon="link-outline"
                onPress={() => navigation.navigate('EditProfile')}
              />
              <Divider inset={60} />
              <ListRow
                label="Contact information"
                icon="call-outline"
                onPress={() => navigation.navigate('EditProfile')}
              />
              <Divider inset={60} />
              <ListRow
                label="Business verification"
                icon="checkmark-circle-outline"
                right={
                  verified ? (
                    <Badge label="Verified" tone="gold" size="sm" />
                  ) : (
                    <Badge label="Apply" tone="neutral" size="sm" />
                  )
                }
                onPress={() => navigation.navigate('Verification')}
              />
            </Card>

            <View
              style={[
                styles.note,
                { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg },
              ]}
            >
              <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textMuted} />
              <Text variant="caption" tone="muted" style={styles.flex}>
                Analytics are aggregated. You never see identifying information about individual
                viewers, no location is collected, and targeting never uses sensitive personal
                characteristics.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { paddingVertical: 60, alignItems: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  noticeRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
