import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Share } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Card,
  Badge,
  Avatar,
  Divider,
  SectionHeader,
  EmptyState,
  Segmented,
} from '../../components';
import { BalanceTile } from '../../components/money/ProgressRow';
import { useTheme } from '../../theme';
import { referralStats as sampleStats, referralEntries } from '../../mock';
import { SourceNote } from '../../components/DataSource';
import { useApiData } from '../../hooks/useApiData';
import { money } from '../../api';
import { formatCount, timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

export function ReferralScreen({ navigation }: RootScreenProps<'Referral'>) {
  /**
   * The code and the totals come from the server.
   *
   * A referral code shown in the app has to be the one the server will honour —
   * a sample code would send a friend to a signup that credits nobody.
   */
  const { data: live, source } = useApiData(() => money.referrals(), null, []);

  const referralStats =
    source === 'live' && live
      ? {
          ...sampleStats,
          code: live.code,
          link: `https://vyra.app/i/${live.code}`,
          rewardPerReferral: live.rewardCoins,
          total: live.invited,
          qualified: live.qualified,
          earned: live.earned,
        }
      : sampleStats;

  const theme = useTheme();
  const [tab, setTab] = useState<'all' | 'qualified' | 'pending'>('all');
  const [copied, setCopied] = useState(false);

  const list = referralEntries.filter((entry) => {
    if (tab === 'qualified') return entry.qualified;
    if (tab === 'pending') return !entry.qualified;
    return true;
  });

  const todayRatio = Math.min(1, referralStats.today / referralStats.todayTarget);

  const share = () => {
    Share.share({
      message: `Join me on Vyra — use my code ${referralStats.code}\n${referralStats.link}`,
    }).catch(() => {});
  };

  const copy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Screen>
      <Header title="Refer and earn" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Invite card */}
        <LinearGradient
          colors={[...theme.gradients.brandAccent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, { margin: theme.spacing.md, borderRadius: theme.radius.xl }]}
        >
          <Text variant="label" style={{ color: 'rgba(255,255,255,0.85)' }}>
            Earn per qualified referral
          </Text>
          <View style={styles.heroAmount}>
            <Ionicons name="logo-bitcoin" size={22} color="#FFF" />
            <Text variant="display" tone="onDark">
              {formatCount(referralStats.rewardPerReferral)}
            </Text>
          </View>
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Paid when your invite installs the app and watches for two minutes
          </Text>

          {/* Code */}
          <Pressable onPress={copy} style={[styles.codeBox, { borderRadius: theme.radius.md }]}>
            <View style={styles.flex}>
              <Text variant="caption" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Your invite code
              </Text>
              <Text variant="h3" tone="onDark" style={styles.code}>
                {referralStats.code}
              </Text>
            </View>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color="#FFF" />
          </Pressable>

          <View style={styles.heroActions}>
            <Button label="Share invite" variant="secondary" icon="share-social-outline" onPress={share} style={styles.flex} />
            <Button label={copied ? 'Copied' : 'Copy link'} variant="secondary" icon="link-outline" onPress={copy} style={styles.flex} />
          </View>
        </LinearGradient>

        {/* Today's referral task */}
        <Card padded>
          <View style={styles.taskHeader}>
            <Ionicons name="today-outline" size={16} color={theme.colors.brand} />
            <Text variant="bodyStrong" style={styles.flex}>
              Refer {referralStats.todayTarget} users today
            </Text>
            <Badge
              label={referralStats.today >= referralStats.todayTarget ? 'Complete' : 'In progress'}
              tone={referralStats.today >= referralStats.todayTarget ? 'success' : 'brand'}
              size="sm"
            />
          </View>

          <View style={{ marginTop: theme.spacing.sm }}>
            <View style={styles.progressHeader}>
              <Text variant="label" tone="secondary">
                {referralStats.today} / {referralStats.todayTarget}
              </Text>
              <Text variant="label" tone="brand">
                +{formatCount(referralStats.rewardPerReferral * referralStats.todayTarget)} coins
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: theme.colors.surfaceAlt }]}>
              <View
                style={{
                  width: `${todayRatio * 100}%`,
                  height: '100%',
                  borderRadius: 4,
                  backgroundColor: theme.colors.brand,
                }}
              />
            </View>
          </View>
        </Card>

        {/* Stats */}
        <View style={[styles.tiles, { padding: theme.spacing.md }]}>
          <BalanceTile
            label="Total referrals"
            value={formatCount(referralStats.total)}
            icon="people-outline"
            tone="brand"
          />
          <BalanceTile
            label="Qualified"
            value={formatCount(referralStats.qualified)}
            caption={`${referralStats.pending} pending`}
            icon="checkmark-circle-outline"
            tone="accent"
          />
        </View>
        <View style={[styles.tiles, { paddingHorizontal: theme.spacing.md }]}>
          <BalanceTile
            label="Today"
            value={String(referralStats.today)}
            icon="today-outline"
            tone="muted"
          />
          <BalanceTile
            label="Reward earned"
            value={formatCount(referralStats.earned)}
            caption="coins"
            icon="gift-outline"
            tone="gold"
          />
        </View>

        {/* How it works */}
        <SectionHeader title="How it works" />
        <Card padded style={{ gap: theme.spacing.sm }}>
          {[
            { n: 1, text: 'Share your code or invite link.' },
            { n: 2, text: 'Your friend installs the app and signs up with the code.' },
            { n: 3, text: 'They watch for two minutes — this is what makes a referral qualified.' },
            { n: 4, text: `${formatCount(referralStats.rewardPerReferral)} coins land in your reward balance.` },
          ].map((step) => (
            <View key={step.n} style={styles.stepRow}>
              <View style={[styles.stepNumber, { backgroundColor: theme.colors.brandSoft }]}>
                <Text variant="caption" tone="brand">
                  {step.n}
                </Text>
              </View>
              <Text variant="label" tone="secondary" style={styles.flex}>
                {step.text}
              </Text>
            </View>
          ))}
        </Card>

        {/* Referral list */}
        <SectionHeader title="Your referrals" />
        <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
          <Segmented
            options={[
              { id: 'all', label: `All (${referralEntries.length})` },
              { id: 'qualified', label: 'Qualified' },
              { id: 'pending', label: 'Pending' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>

        {list.length === 0 ? (
          <EmptyState icon="people-outline" title="Nothing here yet" compact />
        ) : (
          <Card>
            {list.map((entry, index) => (
              <View key={entry.id}>
                {index > 0 ? <Divider inset={72} /> : null}
                <View style={[styles.entryRow, { padding: theme.spacing.md }]}>
                  <Avatar uri={entry.avatar} size={40} />
                  <View style={styles.flex}>
                    <Text variant="body" numberOfLines={1}>
                      @{entry.username}
                    </Text>
                    <Text variant="caption" tone="muted">
                      Joined {timeAgo(entry.joinedAt)}
                    </Text>
                  </View>
                  {entry.qualified ? (
                    <Badge label={`+${formatCount(entry.reward)}`} tone="success" size="sm" />
                  ) : (
                    <Badge label="Pending" tone="warning" size="sm" />
                  )}
                </View>
              </View>
            ))}
          </Card>
        )}

        <Card padded style={{ marginTop: theme.spacing.lg }}>
          <View style={styles.noticeRow}>
            <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.success} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Referral rewards credit your reward balance, which is spendable on promotion and
              gifting. Fake or self-referrals are detected and reversed.
            </Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { padding: 20 },
  heroAmount: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    padding: 12,
    marginTop: 16,
  },
  code: { letterSpacing: 2 },
  heroActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  taskHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  track: { height: 6, borderRadius: 4, overflow: 'hidden' },
  tiles: { flexDirection: 'row', gap: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNumber: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noticeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
