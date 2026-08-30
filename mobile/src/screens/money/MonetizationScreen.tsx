import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Button,
  Card,
  Badge,
  ListRow,
  Divider,
  SectionHeader,
} from '../../components';
import { ProgressRow } from '../../components/money/ProgressRow';
import { useTheme } from '../../theme';
import { monetizationStatus, dailyTasks, referralStats, walletBalances } from '../../mock';
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

const stateMeta = {
  locked: { label: 'Not eligible yet', tone: 'neutral' as const, icon: 'lock-closed' as const },
  eligible: { label: 'Monetization eligible', tone: 'success' as const, icon: 'checkmark-circle' as const },
  enabled: { label: 'Monetization enabled', tone: 'success' as const, icon: 'checkmark-circle' as const },
  review: { label: 'Under review', tone: 'warning' as const, icon: 'time' as const },
  suspended: { label: 'Suspended', tone: 'danger' as const, icon: 'warning' as const },
};

export function MonetizationScreen({ navigation }: RootScreenProps<'Monetization'>) {
  const theme = useTheme();
  const status = monetizationStatus;
  const meta = stateMeta[status.state];

  const met = useMemo(
    () => status.criteria.filter((c) => c.current >= c.required).length,
    [status.criteria],
  );
  const remaining = status.criteria.filter((c) => c.current < c.required);

  return (
    <Screen>
      <Header title="Monetization" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Status hero */}
        <LinearGradient
          colors={
            status.state === 'enabled' || status.state === 'eligible'
              ? ['#3DDC97', '#7C5CFF']
              : [...theme.gradients.brandAccent]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, { margin: theme.spacing.md, borderRadius: theme.radius.xl }]}
        >
          <View style={styles.heroTop}>
            <Ionicons name={meta.icon} size={18} color="#FFF" />
            <Text variant="labelStrong" tone="onDark">
              {meta.label}
            </Text>
          </View>

          <Text variant="display" tone="onDark" style={{ marginTop: theme.spacing.xs }}>
            {status.progress}%
          </Text>
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
            {met} of {status.criteria.length} requirements met
          </Text>

          <View style={styles.heroTrack}>
            <View style={[styles.heroFill, { width: `${status.progress}%` }]} />
          </View>
        </LinearGradient>

        {/* What unlocks */}
        <Card padded style={{ gap: theme.spacing.sm }}>
          <Text variant="bodyStrong">What monetization unlocks</Text>
          {[
            { icon: 'gift-outline' as const, text: 'Receive gifts during live streams' },
            { icon: 'cash-outline' as const, text: 'Withdraw live gift earnings to USDT or bank' },
            { icon: 'trending-up-outline' as const, text: 'Higher daily task reward tiers' },
            { icon: 'stats-chart-outline' as const, text: 'Full revenue analytics in your dashboard' },
          ].map((item) => (
            <View key={item.text} style={styles.perkRow}>
              <Ionicons name={item.icon} size={16} color={theme.colors.accent} />
              <Text variant="label" tone="secondary" style={styles.flex}>
                {item.text}
              </Text>
            </View>
          ))}
        </Card>

        {/* Criteria */}
        <SectionHeader title="Requirements" />
        <Card padded>
          {status.criteria.map((criterion, index) => (
            <View key={criterion.id}>
              {index > 0 ? <Divider /> : null}
              <ProgressRow
                label={criterion.label}
                current={criterion.current}
                target={criterion.required}
                unit={criterion.unit}
                hint={criterion.hint}
                done={criterion.isBoolean ? criterion.current >= criterion.required : undefined}
              />
            </View>
          ))}
        </Card>

        {/* What is left */}
        {remaining.length > 0 ? (
          <>
            <SectionHeader title="Closest to done" />
            <Card padded style={{ gap: theme.spacing.xs }}>
              {remaining
                .slice()
                .sort((a, b) => b.current / b.required - a.current / a.required)
                .slice(0, 3)
                .map((criterion) => {
                  const short = criterion.required - criterion.current;
                  return (
                    <View key={criterion.id} style={styles.remainingRow}>
                      <Text variant="label" tone="secondary" style={styles.flex}>
                        {criterion.label}
                      </Text>
                      <Badge
                        label={`${formatCount(short)} ${criterion.unit ?? ''} to go`}
                        tone="warning"
                        size="sm"
                      />
                    </View>
                  );
                })}
              <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.xs }}>
                Requirements are checked continuously. Nothing resets if you miss a day.
              </Text>
            </Card>
          </>
        ) : null}

        {/* Shortcuts that move the numbers */}
        <SectionHeader title="Ways to get there faster" />
        <Card>
          <ListRow
            label="Daily tasks"
            description={`${dailyTasks.filter((t) => t.state === 'active').length} active today`}
            icon="checkbox-outline"
            onPress={() => navigation.navigate('DailyTasks')}
          />
          <Divider inset={60} />
          <ListRow
            label="Refer and earn"
            description={`${referralStats.qualified} qualified referrals so far`}
            icon="people-outline"
            onPress={() => navigation.navigate('Referral')}
          />
          <Divider inset={60} />
          <ListRow
            label="Promote a video"
            description={`${formatCount(walletBalances.coins)} coins available`}
            icon="trending-up-outline"
            onPress={() => navigation.navigate('Promotion', {})}
          />
          <Divider inset={60} />
          <ListRow
            label="Creator dashboard"
            description="See which videos are pulling watch time"
            icon="stats-chart-outline"
            onPress={() => navigation.navigate('CreatorDashboard')}
          />
        </Card>

        <View style={{ padding: theme.spacing.md }}>
          <Button
            label={
              status.state === 'enabled'
                ? 'Monetization is active'
                : status.state === 'eligible'
                  ? 'Apply for monetization'
                  : 'Keep going'
            }
            variant={status.state === 'eligible' ? 'gradient' : 'secondary'}
            size="lg"
            fullWidth
            disabled={status.state === 'locked'}
            onPress={() => navigation.navigate('LiveEarnings')}
          />
          <Text variant="caption" tone="muted" align="center" style={{ marginTop: theme.spacing.sm }}>
            Thresholds are set by the platform and can change. Your progress always reflects the
            values currently in force.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { padding: 20 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: 14,
    overflow: 'hidden',
  },
  heroFill: { height: '100%', borderRadius: 3, backgroundColor: '#FFFFFF' },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  remainingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
