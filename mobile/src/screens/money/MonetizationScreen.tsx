import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
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
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useApiData } from '../../hooks/useApiData';
import { money, type MonetizationStatus, type MonetizationState } from '../../api/money';
import { formatCount, formatDate } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

const stateMeta: Record<
  MonetizationState,
  { label: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  locked: { label: 'Not eligible yet', icon: 'lock-closed' },
  eligible: { label: 'Monetization eligible', icon: 'checkmark-circle' },
  enabled: { label: 'Monetization enabled', icon: 'checkmark-circle' },
  review: { label: 'Under review', icon: 'time' },
  suspended: { label: 'Suspended', icon: 'warning' },
};

const EMPTY: MonetizationStatus = {
  state: 'locked',
  progress: 0,
  criteriaMet: 0,
  criteria: [],
  canApply: false,
  appliedAt: null,
  enabledAt: null,
  reviewNote: null,
  unmeasurable: [],
};

/**
 * Monetization eligibility.
 *
 * The whole screen used to render one fixed sample: the same progress ring,
 * the same requirements and the same distance-to-go for every account on the
 * platform. Someone who had passed every threshold saw the same "keep going"
 * as someone who had just signed up.
 *
 * Requirements now come from the server, which measures them — and which
 * re-measures them when the Apply button is pressed, because the app cannot be
 * the thing that decides an account has qualified.
 */
export function MonetizationScreen({ navigation }: RootScreenProps<'Monetization'>) {
  const theme = useTheme();
  const [applying, setApplying] = useState(false);

  const { data: status, source, loading, refresh } = useApiData<MonetizationStatus>(
    () => money.monetization(),
    EMPTY,
    [],
    { fallbackOnEmpty: false },
  );

  // The three shortcuts at the bottom describe the account's own position, so
  // they are read rather than assumed.
  const { data: tasks } = useApiData(() => money.tasks(), [], [], { fallbackOnEmpty: false });
  const { data: referrals } = useApiData(() => money.referrals(), null, [], {
    fallbackOnEmpty: false,
  });
  const { data: balances } = useApiData(() => money.balances(), null, [], {
    fallbackOnEmpty: false,
  });

  const meta = stateMeta[status.state];
  const remaining = useMemo(() => status.criteria.filter((c) => !c.met), [status.criteria]);
  const activeTasks = tasks.filter((t) => t.state === 'active').length;

  const apply = async () => {
    setApplying(true);
    try {
      await money.applyForMonetization();
      await refresh();
      Alert.alert(
        'Application sent',
        'Your account is now in the review queue. You will be notified when it has been looked at.',
      );
    } catch (err) {
      // The server re-checks the requirements, so this can legitimately refuse
      // even when the screen looked ready — say what it said.
      Alert.alert('Could not apply', (err as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Screen>
      <Header title="Monetization" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <SourceNote
          source={source}
          noun="requirements"
          liveHint="measured against your account"
          sampleHint="sign in to see where you stand"
        />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.brand} />
          </View>
        ) : (
          <>
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
                {status.criteria.length === 0
                  ? 'No requirements are set yet'
                  : `${status.criteriaMet} of ${status.criteria.length} requirements met`}
              </Text>

              <View style={styles.heroTrack}>
                <View style={[styles.heroFill, { width: `${status.progress}%` }]} />
              </View>
            </LinearGradient>

            {/*
              An operator has set a requirement against something nothing
              measures. It blocks rather than passes, and saying so plainly is
              better than a creator hitting an unexplained refusal on Apply.
            */}
            {status.unmeasurable.length > 0 ? (
              <Card padded style={{ marginBottom: theme.spacing.md }}>
                <View style={styles.noticeRow}>
                  <Ionicons name="alert-circle-outline" size={18} color={theme.colors.warning} />
                  <Text variant="caption" tone="secondary" style={styles.flex}>
                    One of the requirements cannot be checked right now, so applications are paused.
                    This is a problem at our end, not yours — support has been notified.
                  </Text>
                </View>
              </Card>
            ) : null}

            {status.state === 'review' && status.appliedAt ? (
              <Card padded style={{ marginBottom: theme.spacing.md }}>
                <View style={styles.noticeRow}>
                  <Ionicons name="time-outline" size={18} color={theme.colors.gold} />
                  <View style={styles.flex}>
                    <Text variant="bodyStrong">In the review queue</Text>
                    <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                      Applied {formatDate(status.appliedAt)}. Nothing further is needed from you.
                      {status.reviewNote ? ` Note: ${status.reviewNote}` : ''}
                    </Text>
                  </View>
                </View>
              </Card>
            ) : null}

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
              {status.criteria.length === 0 ? (
                <Text variant="caption" tone="muted">
                  No monetization requirements have been published yet. Nothing is being held
                  against your account.
                </Text>
              ) : (
                status.criteria.map((criterion, index) => (
                  <View key={criterion.id}>
                    {index > 0 ? <Divider /> : null}
                    <ProgressRow
                      label={criterion.label}
                      current={criterion.current}
                      target={criterion.required}
                      unit={criterion.unit ?? undefined}
                      hint={
                        criterion.measurable
                          ? undefined
                          : 'This requirement cannot be checked at the moment.'
                      }
                      done={criterion.isBoolean ? criterion.met : undefined}
                    />
                  </View>
                ))
              )}
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
                      const short = Math.max(0, criterion.required - criterion.current);
                      return (
                        <View key={criterion.id} style={styles.remainingRow}>
                          <Text variant="label" tone="secondary" style={styles.flex}>
                            {criterion.label}
                          </Text>
                          <Badge
                            label={
                              criterion.isBoolean
                                ? 'Not yet'
                                : `${formatCount(short)} ${criterion.unit ?? ''} to go`
                            }
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
                description={activeTasks > 0 ? `${activeTasks} active today` : undefined}
                icon="checkbox-outline"
                onPress={() => navigation.navigate('DailyTasks')}
              />
              <Divider inset={60} />
              <ListRow
                label="Refer and earn"
                description={
                  referrals ? `${formatCount(referrals.qualified)} qualified referrals so far` : undefined
                }
                icon="people-outline"
                onPress={() => navigation.navigate('Referral')}
              />
              <Divider inset={60} />
              <ListRow
                label="Promote a video"
                description={balances ? `${formatCount(balances.coin)} coins available` : undefined}
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
                    : status.state === 'review'
                      ? 'Application under review'
                      : status.canApply
                        ? 'Apply for monetization'
                        : 'Keep going'
                }
                variant={status.canApply ? 'gradient' : 'secondary'}
                size="lg"
                fullWidth
                loading={applying}
                disabled={!status.canApply || applying}
                onPress={
                  status.state === 'enabled'
                    ? () => navigation.navigate('LiveEarnings')
                    : apply
                }
              />
              <Text variant="caption" tone="muted" align="center" style={{ marginTop: theme.spacing.sm }}>
                Thresholds are set by the platform and can change. Your progress always reflects the
                values currently in force.
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
  noticeRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
});
