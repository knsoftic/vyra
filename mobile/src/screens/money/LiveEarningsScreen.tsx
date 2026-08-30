import React from 'react';
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
  Avatar,
  Divider,
  SectionHeader,
  ListRow,
} from '../../components';
import { BarChart } from '../../components/Charts';
import { BalanceTile } from '../../components/money/ProgressRow';
import { useTheme } from '../../theme';
import { liveGiftEarnings, monetizationConfig, walletBalances } from '../../mock';
import { formatCount, formatMoney, timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

export function LiveEarningsScreen({ navigation }: RootScreenProps<'LiveEarnings'>) {
  const theme = useTheme();
  const e = liveGiftEarnings;

  return (
    <Screen>
      <Header title="Live gift earnings" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Hero — this is the payable balance */}
        <LinearGradient
          colors={['#3DDC97', '#7C5CFF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, { margin: theme.spacing.md, borderRadius: theme.radius.xl }]}
        >
          <View style={styles.heroTop}>
            <Text variant="label" style={{ color: 'rgba(255,255,255,0.85)' }}>
              Available to withdraw
            </Text>
            <Ionicons name="cash-outline" size={18} color="#FFF" />
          </View>

          <Text variant="display" tone="onDark" style={{ marginTop: 2 }}>
            {formatMoney(e.availableUsd)}
          </Text>
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
            {formatCount(e.giftCoins)} gift coins received · about{' '}
            {formatMoney(e.estimatedUsd)} total value
          </Text>

          <Button
            label="Withdraw"
            variant="secondary"
            icon="arrow-up-circle-outline"
            fullWidth
            style={{ marginTop: theme.spacing.md }}
            onPress={() => navigation.navigate('Withdraw')}
          />
        </LinearGradient>

        {/* Balance split */}
        <View style={[styles.tiles, { paddingHorizontal: theme.spacing.md }]}>
          <BalanceTile
            label="Clearing"
            value={formatMoney(e.clearingUsd)}
            caption={`Releases after ${monetizationConfig.clearingDays} days`}
            icon="time-outline"
            tone="muted"
          />
          <BalanceTile
            label="Pending payout"
            value={formatMoney(e.pendingUsd)}
            caption="Requested, awaiting review"
            icon="hourglass-outline"
            tone="gold"
          />
        </View>

        <View style={[styles.tiles, { padding: theme.spacing.md }]}>
          <BalanceTile
            label="Total gifts"
            value={formatCount(e.totalGifts)}
            caption="All time"
            icon="gift-outline"
            tone="brand"
          />
          <BalanceTile
            label="Gift coins"
            value={formatCount(e.giftCoins)}
            caption={`${monetizationConfig.giftCoinsPerUsd} coins = $1`}
            icon="logo-bitcoin"
            tone="accent"
          />
        </View>

        {/* Trend */}
        <SectionHeader title="Gift coins this week" />
        <Card padded>
          <BarChart data={e.weekly} height={140} accent={theme.colors.accent} />
        </Card>

        {/* Recent gifts */}
        <SectionHeader title="Recent gifts" />
        <Card>
          {e.recentGifts.map((gift, index) => (
            <View key={gift.id}>
              {index > 0 ? <Divider inset={72} /> : null}
              <View style={[styles.giftRow, { padding: theme.spacing.md }]}>
                <Avatar uri={gift.from.avatar} size={40} />
                <View style={styles.flex}>
                  <Text variant="body" numberOfLines={1}>
                    @{gift.from.username}
                  </Text>
                  <Text variant="caption" tone="muted">
                    sent {gift.icon} {gift.gift} · {timeAgo(gift.at)}
                  </Text>
                </View>
                <View style={styles.coinRow}>
                  <Ionicons name="logo-bitcoin" size={12} color={theme.colors.gold} />
                  <Text variant="labelStrong" style={{ color: theme.colors.gold }}>
                    +{formatCount(gift.coins)}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </Card>

        {/* Top supporters */}
        <SectionHeader title="Top supporters" />
        <Card>
          {e.topGifters.map((entry, index) => (
            <View key={entry.user.id}>
              {index > 0 ? <Divider inset={72} /> : null}
              <View style={[styles.giftRow, { padding: theme.spacing.md }]}>
                <View style={styles.rankWrap}>
                  <Text variant="labelStrong" tone={index === 0 ? 'brand' : 'muted'}>
                    {index + 1}
                  </Text>
                </View>
                <Avatar uri={entry.user.avatar} size={36} />
                <View style={styles.flex}>
                  <Text variant="body" numberOfLines={1}>
                    {entry.user.displayName}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {formatCount(entry.gifts)} gifts
                  </Text>
                </View>
                <Text variant="labelStrong" style={{ color: theme.colors.gold }}>
                  {formatCount(entry.coins)}
                </Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Payout rules */}
        <SectionHeader title="How payouts work" />
        <Card>
          <ListRow
            label="Withdrawal history"
            description="Track every request and its status"
            icon="receipt-outline"
            onPress={() => navigation.navigate('Withdraw')}
          />
          <Divider inset={60} />
          <ListRow
            label="Minimum withdrawal"
            icon="cash-outline"
            value={formatMoney(monetizationConfig.minWithdrawal)}
            showChevron={false}
          />
          <Divider inset={60} />
          <ListRow
            label="Clearing period"
            description="Gifts are held before becoming payable"
            icon="time-outline"
            value={`${monetizationConfig.clearingDays} days`}
            showChevron={false}
          />
        </Card>

        <Card padded style={{ marginTop: theme.spacing.lg }}>
          <View style={styles.noticeRow}>
            <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.success} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Live gift earnings are kept separate from your reward and coin balances. Only this
              balance is eligible for withdrawal — task and referral rewards stay inside the app.
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
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tiles: { flexDirection: 'row', gap: 10 },
  giftRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rankWrap: { width: 18, alignItems: 'center' },
  noticeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
