import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Card,
  Badge,
  Divider,
  SectionHeader,
  EmptyState,
} from '../../components';
import { BalanceTile } from '../../components/money/ProgressRow';
import { useTheme } from '../../theme';
import { dailyTasks as seed, walletBalances, referralStats as sampleReferrals } from '../../mock';
import { SourceNote } from '../../components/DataSource';
import { useApiData } from '../../hooks/useApiData';
import { money, ApiError } from '../../api';
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { DailyTask } from '../../types';

/** Counts down to the daily reset so the urgency is visible, not implied. */
function useResetCountdown(iso: string) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const tick = () => {
      const ms = new Date(iso).getTime() - Date.now();
      if (ms <= 0) return setLabel('Resetting…');
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setLabel(`${h}h ${m}m left`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [iso]);
  return label;
}

function TaskCard({
  task,
  onClaim,
}: {
  task: DailyTask;
  onClaim: (task: DailyTask) => void;
}) {
  const theme = useTheme();
  const countdown = useResetCountdown(task.expiresAt);
  const ratio = Math.min(1, task.current / task.target);
  const complete = task.state === 'completed';
  const claimed = task.state === 'claimed';

  return (
    <View
      style={[
        styles.task,
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.md,
          borderColor: complete ? theme.colors.success : 'transparent',
        },
      ]}
    >
      <View style={styles.taskTop}>
        <View
          style={[
            styles.taskIcon,
            {
              backgroundColor: claimed
                ? theme.colors.surfaceAlt
                : complete
                  ? theme.colors.successSoft
                  : theme.colors.brandSoft,
              borderRadius: theme.radius.md,
            },
          ]}
        >
          <Ionicons
            name={claimed ? 'checkmark-done' : (task.icon as never)}
            size={18}
            color={claimed ? theme.colors.textMuted : complete ? theme.colors.success : theme.colors.brand}
          />
        </View>

        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {task.title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {task.description}
          </Text>
        </View>

        <View style={styles.rewardWrap}>
          <View style={styles.coinRow}>
            <Ionicons name="logo-bitcoin" size={12} color={theme.colors.gold} />
            <Text variant="labelStrong" style={{ color: theme.colors.gold }}>
              {formatCount(task.reward)}
            </Text>
          </View>
          <Text variant="caption" tone="muted">
            {task.rewardLabel}
          </Text>
        </View>
      </View>

      {/* Progress */}
      <View style={{ marginTop: theme.spacing.sm }}>
        <View style={styles.progressHeader}>
          <Text variant="caption" tone={complete ? 'success' : 'secondary'}>
            {formatCount(Math.min(task.current, task.target))} / {formatCount(task.target)}
          </Text>
          <Text variant="caption" tone="muted">
            {claimed ? 'Claimed' : countdown}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: theme.colors.surfaceAlt }]}>
          <View
            style={{
              width: `${ratio * 100}%`,
              height: '100%',
              borderRadius: 3,
              backgroundColor: claimed
                ? theme.colors.textMuted
                : complete
                  ? theme.colors.success
                  : theme.colors.brand,
            }}
          />
        </View>
      </View>

      {/* Action */}
      {complete ? (
        <Button
          label={`Claim ${formatCount(task.reward)} coins`}
          variant="gradient"
          size="sm"
          fullWidth
          icon="gift-outline"
          style={{ marginTop: theme.spacing.sm }}
          onPress={() => onClaim(task)}
        />
      ) : claimed ? (
        <View style={[styles.claimedRow, { marginTop: theme.spacing.sm }]}>
          <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
          <Text variant="caption" tone="success">
            Reward added to your reward balance
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function DailyTasksScreen({ navigation }: RootScreenProps<'DailyTasks'>) {
  const theme = useTheme();
  const [claimError, setClaimError] = useState<string | null>(null);

  const { data: liveBalances, source: balanceSource } = useApiData(() => money.balances(), null, []);

  // A genuine zero is a zero. This was `earnedToday || walletBalances.todayEarned`,
  // which turned "you have earned nothing today" into the sample figure — the
  // one case where the number is most likely to be looked at.
  const rewardBalance =
    balanceSource === 'live' && liveBalances ? liveBalances.reward : walletBalances.reward;

  const { data: liveReferrals, source: referralSource } = useApiData(
    () => money.referrals(),
    null,
    [],
  );

  // The referral block sits alongside the tasks, so it has to be as real as they
  // are — a sample "31 qualified" beside a live 0/10 task is the kind of mixture
  // that makes the whole screen untrustworthy.
  const referralStats =
    referralSource === 'live' && liveReferrals
      ? {
          ...sampleReferrals,
          rewardPerReferral: liveReferrals.rewardCoins,
          qualified: liveReferrals.qualified,
          today: liveReferrals.qualified,
        }
      : sampleReferrals;

  /**
   * Progress is measured by the server, not by this screen.
   *
   * There is deliberately no local counter here: a client that decides its own
   * progress is a client that can claim any reward it wants. The list is
   * re-read after a claim rather than patched, so what is shown is what the
   * server would pay.
   */
  const { data: liveTasks, source, refresh } = useApiData(
    () =>
      money.tasks().then((rows) =>
        rows.map<DailyTask>((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          icon: t.icon,
          metric: t.key,
          current: t.progress,
          target: t.target,
          reward: t.rewardCoins,
          rewardKind: 'coins',
          rewardLabel: t.rewardLabel,
          state: t.state,
          // The server resets on its own schedule; the screen shows the day.
          expiresAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
        })),
      ),
    seed,
    [],
  );

  const [sampleTasks, setSampleTasks] = useState<DailyTask[]>(seed);
  const tasks = source === 'live' ? liveTasks : sampleTasks;

  const claim = (task: DailyTask) => {
    if (source !== 'live') {
      setSampleTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, state: 'claimed' } : t)),
      );
      return;
    }
    setClaimError(null);
    void money
      .claimTask(task.id)
      .then(() => refresh())
      .catch((err: unknown) => {
        setClaimError(err instanceof ApiError ? err.message : 'That reward could not be claimed.');
      });
  };

  const { active, done, claimable, earnedToday } = useMemo(() => {
    const claimableTasks = tasks.filter((t) => t.state === 'completed');
    return {
      active: tasks.filter((t) => t.state === 'active'),
      done: tasks.filter((t) => t.state === 'claimed'),
      claimable: claimableTasks,
      earnedToday: tasks
        .filter((t) => t.state === 'claimed')
        .reduce((sum, t) => sum + t.reward, 0),
    };
  }, [tasks]);

  return (
    <Screen>
      <Header
        title="Daily tasks"
        subtitle="Resets at midnight"
        right={
          <Pressable onPress={() => navigation.navigate('Wallet')} hitSlop={theme.layout.hitSlop}>
            <Text variant="label" tone="brand">
              Wallet
            </Text>
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <SourceNote source={source === 'live' ? 'live' : 'sample'} noun="tasks" sampleHint="progress is counted once you sign in" />
        {/* Summary */}
        <View style={[styles.tiles, { padding: theme.spacing.md }]}>
          <BalanceTile
            label="Reward balance"
            value={formatCount(rewardBalance)}
            caption="Usable for promotion"
            icon="gift-outline"
            tone="brand"
          />
          <BalanceTile
            label="Earned today"
            value={formatCount(earnedToday)}
            caption={`${claimable.length} ready to claim`}
            icon="today-outline"
            tone="accent"
          />
        </View>

        {claimable.length > 0 ? (
          <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
            <View
              style={[
                styles.banner,
                { backgroundColor: theme.colors.successSoft, borderRadius: theme.radius.md },
              ]}
            >
              <Ionicons name="gift" size={16} color={theme.colors.success} />
              <Text variant="label" tone="success" style={styles.flex}>
                {claimable.length} reward{claimable.length === 1 ? '' : 's'} ready to claim
              </Text>
            </View>
          </View>
        ) : null}

        {/* Ready to claim */}
        {claimable.length > 0 ? (
          <>
            <SectionHeader title="Ready to claim" />
            <View style={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm }}>
              {claimable.map((task) => (
                <TaskCard key={task.id} task={task} onClaim={claim} />
              ))}
            </View>
          </>
        ) : null}

        {/* In progress */}
        <SectionHeader title="In progress" />
        {active.length === 0 ? (
          <EmptyState
            icon="checkmark-done-outline"
            title="All tasks done for today"
            description="New tasks arrive after midnight."
            compact
          />
        ) : (
          <View style={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm }}>
            {active.map((task) => (
              <TaskCard key={task.id} task={task} onClaim={claim} />
            ))}
          </View>
        )}

        {/* Referral shortcut */}
        <SectionHeader title="Refer and earn" />
        <Pressable
          onPress={() => navigation.navigate('Referral')}
          style={[
            styles.referral,
            {
              backgroundColor: theme.colors.surface,
              marginHorizontal: theme.spacing.md,
              borderRadius: theme.radius.lg,
              padding: theme.spacing.md,
            },
          ]}
        >
          <View style={styles.taskTop}>
            <View style={[styles.taskIcon, { backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.md }]}>
              <Ionicons name="people-outline" size={18} color={theme.colors.accent} />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong">Refer {referralStats.todayTarget} users today</Text>
              <Text variant="caption" tone="muted">
                {formatCount(referralStats.rewardPerReferral)} coins per qualified referral
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
          </View>

          <View style={{ marginTop: theme.spacing.sm }}>
            <View style={styles.progressHeader}>
              <Text variant="caption" tone="secondary">
                {referralStats.today} / {referralStats.todayTarget}
              </Text>
              <Text variant="caption" tone="muted">
                {referralStats.qualified} qualified all time
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: theme.colors.surfaceAlt }]}>
              <View
                style={{
                  width: `${Math.min(1, referralStats.today / referralStats.todayTarget) * 100}%`,
                  height: '100%',
                  borderRadius: 3,
                  backgroundColor: theme.colors.accent,
                }}
              />
            </View>
          </View>
        </Pressable>

        {/* Claimed */}
        {done.length > 0 ? (
          <>
            <SectionHeader title="Completed today" />
            <Card>
              {done.map((task, index) => (
                <View key={task.id}>
                  {index > 0 ? <Divider inset={16} /> : null}
                  <View style={[styles.doneRow, { padding: theme.spacing.md }]}>
                    <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                    <Text variant="label" style={styles.flex} numberOfLines={1}>
                      {task.title}
                    </Text>
                    <Badge label={`+${formatCount(task.reward)}`} tone="success" size="sm" />
                  </View>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {/* How it works */}
        <Card padded style={{ marginTop: theme.spacing.lg }}>
          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={16} color={theme.colors.info} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Task rewards go to your <Text variant="caption" tone="primary">reward balance</Text>. That
              balance is used for video promotion and gifting inside the app — it is not withdrawable.
              Only live gift earnings can be withdrawn.
            </Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tiles: { flexDirection: 'row', gap: 10 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  task: { borderWidth: 1.5 },
  taskTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  taskIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  rewardWrap: { alignItems: 'flex-end' },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  claimedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  referral: {},
  noticeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
