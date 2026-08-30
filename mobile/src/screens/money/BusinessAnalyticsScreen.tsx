import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
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
import { useTheme } from '../../theme';
import { businessAnalytics, campaigns } from '../../mock';
import { formatCount, formatMoney } from '../../utils/format';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';

export function BusinessAnalyticsScreen({ navigation }: RootScreenProps<'BusinessAnalytics'>) {
  const theme = useTheme();
  const { user } = useApp();
  const [range, setRange] = useState('7d');

  const b = businessAnalytics;
  const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;

  return (
    <Screen>
      <Header title="Business analytics" subtitle={user.displayName} />

      <View style={{ paddingBottom: theme.spacing.sm }}>
        <ChipRow
          items={[
            { id: '7d', label: 'Last 7 days' },
            { id: '28d', label: 'Last 28 days' },
            { id: '90d', label: 'Last 90 days' },
          ]}
          selectedId={range}
          onSelect={setRange}
        />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Account type notice for individual accounts */}
        {user.accountCategory !== 'business' ? (
          <Card padded style={{ marginBottom: theme.spacing.md }}>
            <View style={styles.noticeRow}>
              <Ionicons name="business-outline" size={18} color={theme.colors.gold} />
              <View style={styles.flex}>
                <Text variant="bodyStrong">Business features preview</Text>
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  Switch to a business account to unlock the campaign manager, a call-to-action
                  button and lead tracking. Your content, followers and wallet stay exactly as they
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

        {/* Key metrics */}
        <View style={[styles.statsGrid, { paddingHorizontal: theme.spacing.md }]}>
          <StatCard label="Profile views" value={formatCount(b.profileViews)} delta="+24%" icon="eye-outline" tone="brand" />
          <StatCard label="Website clicks" value={formatCount(b.websiteClicks)} delta="+16%" icon="globe-outline" />
          <StatCard label="CTA clicks" value={formatCount(b.ctaClicks)} delta="+9%" icon="hand-left-outline" />
          <StatCard label="Leads" value={formatCount(b.leads)} delta="+31%" icon="document-text-outline" tone="success" />
        </View>

        <SectionTitle title="Reach" />
        <Card padded>
          <BarChart data={b.reachSeries} height={140} />
        </Card>

        <SectionTitle title="Clicks" />
        <Card padded>
          <TrendChart data={b.clickSeries} height={120} accent={theme.colors.gold} />
        </Card>

        <SectionTitle title="Where your audience is" />
        <Card padded>
          <BreakdownBars items={b.topLocations} accent={theme.colors.accent} />
        </Card>

        {/* Advertising summary */}
        <SectionTitle title="Advertising" action="Manage" onActionPress={() => navigation.navigate('Ads')} />
        <Card>
          <ListRow
            label="Active campaigns"
            icon="megaphone-outline"
            value={String(activeCampaigns)}
            onPress={() => navigation.navigate('Ads')}
          />
          <Divider inset={60} />
          <ListRow
            label="Ad spend"
            icon="logo-bitcoin"
            value={`${formatCount(b.adSpendCoins)} coins`}
            showChevron={false}
          />
          <Divider inset={60} />
          <ListRow
            label="Cost per result"
            icon="calculator-outline"
            value={formatMoney(b.costPerResult)}
            showChevron={false}
          />
          <Divider inset={60} />
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
            description={user.cta?.label ?? 'Not set up'}
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
              user.verification === 'business' ? (
                <Badge label="Verified" tone="gold" size="sm" />
              ) : (
                <Badge label="Apply" tone="neutral" size="sm" />
              )
            }
            onPress={() => navigation.navigate('Verification')}
          />
        </Card>

        <View style={[styles.note, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }]}>
          <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textMuted} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            Analytics are aggregated. You never see identifying information about individual
            viewers, and targeting never uses sensitive personal characteristics.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  noticeRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
