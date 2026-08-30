import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Card,
  ListRow,
  Divider,
  SectionHeader,
  Badge,
  Sheet,
} from '../../components';
import { BalanceTile } from '../../components/money/ProgressRow';
import { SliderRow } from '../../components/Controls';
import { useTheme } from '../../theme';
import {
  walletBalances,
  transactions,
  monetizationConfig,
  monetizationStatus,
  dailyTasks,
  liveGiftEarnings,
} from '../../mock';
import { formatCoins, formatCount, formatMoney, timeAgo } from '../../utils/format';
import { SourceNote } from '../../components/DataSource';
import { useApiData } from '../../hooks/useApiData';
import { money, moneyKey, ApiError } from '../../api';
import type { RootScreenProps } from '../../navigation/types';
import type { CoinTransaction } from '../../types';

export const transactionIcon = (type: CoinTransaction['type']): keyof typeof Ionicons.glyphMap => {
  switch (type) {
    case 'purchase':
      return 'card-outline';
    case 'gift_sent':
      return 'gift-outline';
    case 'gift_received':
      return 'gift';
    case 'promotion':
      return 'trending-up-outline';
    case 'ad_spend':
      return 'megaphone-outline';
    case 'refund':
      return 'return-down-back-outline';
    case 'task_reward':
      return 'checkbox-outline';
    case 'referral_reward':
      return 'people-outline';
    case 'milestone_reward':
      return 'trophy-outline';
    case 'reward_to_coins':
      return 'swap-horizontal-outline';
    case 'withdrawal_request':
      return 'arrow-up-circle-outline';
    case 'withdrawal_paid':
      return 'checkmark-done-outline';
    case 'withdrawal_rejected':
      return 'close-circle-outline';
    case 'admin_credit':
      return 'add-circle-outline';
    default:
      return 'remove-circle-outline';
  }
};

export function WalletScreen({ navigation }: RootScreenProps<'Wallet'>) {
  const theme = useTheme();
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  // The balance is the whole point of this screen, so it comes from the server
  // or is plainly labelled as sample. There is no middle option here.
  const { data: liveBalances, source, refresh } = useApiData(() => money.balances(), null, []);
  const { data: liveTasks, source: taskSource } = useApiData(() => money.tasks(), [], []);

  const balances =
    source === 'live' && liveBalances
      ? {
          coins: liveBalances.coin,
          reward: liveBalances.reward,
          liveGift: liveBalances.liveGift,
          withdrawable: liveBalances.withdrawable,
          pendingReward: liveBalances.pendingReward,
          totalEarned: liveBalances.totalEarned,
          // Not a figure the server keeps; shown only with the sample data.
          todayEarned: 0,
          pendingWithdrawal: liveBalances.pendingWithdrawal,
        }
      : walletBalances;

  const [convertAmount, setConvertAmount] = useState(Math.min(1000, balances.reward));

  const claimable =
    taskSource === 'live'
      ? liveTasks.filter((t) => t.state === 'completed').length
      : dailyTasks.filter((t) => t.state === 'completed').length;

  const convertedCoins = Math.floor(convertAmount * monetizationConfig.rewardToCoinRate);

  // Derived from the live balance at the rate the server would pay, so the
  // estimate cannot disagree with the figure printed above it.
  const giftEstimate =
    source === 'live' && liveBalances
      ? Number((balances.liveGift * liveBalances.coinToPayoutRate).toFixed(2))
      : liveGiftEarnings.estimatedUsd;

  /**
   * Converting reward balance into coins.
   *
   * The key is made once, here, when the user commits — so a retry of a failed
   * conversion cannot convert twice.
   */
  const doConvert = async () => {
    if (source !== 'live') {
      setConverting(false);
      return;
    }
    setConvertError(null);
    try {
      await money.convertReward(convertAmount, moneyKey('convert'));
      await refresh();
      setConverting(false);
    } catch (err) {
      setConvertError(err instanceof ApiError ? err.message : 'The conversion failed.');
    }
  };

  return (
    <Screen>
      <Header
        title="Wallet"
        right={
          <Pressable onPress={() => navigation.navigate('Transactions')} hitSlop={theme.layout.hitSlop}>
            <Ionicons name="time-outline" size={22} color={theme.colors.text} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <SourceNote
          source={source}
          noun="balances"
          sampleHint="sign in to see the money on your account"
        />
        {/* Primary spendable balance */}
        <LinearGradient
          colors={[...theme.gradients.brandAccent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.balanceCard, { margin: theme.spacing.md, borderRadius: theme.radius.xl }]}
        >
          <View style={styles.balanceTop}>
            <Text variant="label" style={{ color: 'rgba(255,255,255,0.85)' }}>
              Coin balance
            </Text>
            <Ionicons name="logo-bitcoin" size={20} color="#FFF" />
          </View>

          <Text variant="display" tone="onDark" style={{ marginTop: theme.spacing.xxs }}>
            {formatCount(balances.coins)}
          </Text>
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Spendable on video promotion and live gifting
          </Text>

          <View style={styles.balanceActions}>
            <Button
              label="Buy coins"
              variant="secondary"
              size="sm"
              icon="add"
              onPress={() => navigation.navigate('BuyCoins')}
            />
            <Button
              label="Promote"
              variant="secondary"
              size="sm"
              icon="trending-up"
              onPress={() => navigation.navigate('Promotion', {})}
            />
          </View>
        </LinearGradient>

        {/*
          The other three balances. Kept visually distinct because they are
          economically different — only live gift earnings can be withdrawn.
        */}
        <View style={[styles.tiles, { paddingHorizontal: theme.spacing.md }]}>
          <BalanceTile
            label="Reward balance"
            value={formatCount(balances.reward)}
            caption="Tasks and referrals · convert to coins"
            icon="gift-outline"
            tone="accent"
          />
          <BalanceTile
            label="Live gift earnings"
            value={formatCount(balances.liveGift)}
            caption={`≈ ${formatMoney(giftEstimate)}`}
            icon="sparkles-outline"
            tone="gold"
          />
        </View>

        <View style={[styles.tiles, { padding: theme.spacing.md }]}>
          <BalanceTile
            label="Withdrawable"
            value={formatMoney(balances.withdrawable)}
            caption="Cleared gift earnings"
            icon="cash-outline"
            tone="brand"
          />
          <BalanceTile
            label="Pending"
            value={formatCount(balances.pendingReward)}
            caption="Reward still maturing"
            icon="hourglass-outline"
            tone="muted"
          />
        </View>

        {/* Convert reward → coins */}
        <View style={{ paddingHorizontal: theme.spacing.md }}>
          <Pressable
            onPress={() => setConverting(true)}
            style={[
              styles.convertRow,
              { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.md },
            ]}
          >
            <View style={[styles.convertIcon, { backgroundColor: theme.colors.accentSoft }]}>
              <Ionicons name="swap-horizontal" size={18} color={theme.colors.accent} />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong">Convert reward to coins</Text>
              <Text variant="caption" tone="muted">
                1 reward = {monetizationConfig.rewardToCoinRate} coin · use it to promote videos
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
          </Pressable>
        </View>

        {/* Earning surfaces */}
        <SectionHeader title="Earn" />
        <Card>
          <ListRow
            label="Daily tasks"
            description={
              claimable > 0
                ? `${claimable} reward${claimable === 1 ? '' : 's'} ready to claim`
                : 'Complete tasks to earn reward coins'
            }
            icon="checkbox-outline"
            onPress={() => navigation.navigate('DailyTasks')}
            right={claimable > 0 ? <Badge label={String(claimable)} tone="brand" size="sm" /> : undefined}
          />
          <Divider inset={60} />
          <ListRow
            label="Refer and earn"
            description="Invite friends and earn per qualified referral"
            icon="people-outline"
            onPress={() => navigation.navigate('Referral')}
          />
          <Divider inset={60} />
          <ListRow
            label="Monetization"
            description={`${monetizationStatus.progress}% of requirements met`}
            icon="ribbon-outline"
            onPress={() => navigation.navigate('Monetization')}
          />
          <Divider inset={60} />
          <ListRow
            label="Live gift earnings"
            description="Gifts received while streaming"
            icon="sparkles-outline"
            onPress={() => navigation.navigate('LiveEarnings')}
          />
        </Card>

        {/* Money out */}
        <SectionHeader title="Manage" />
        <Card>
          <ListRow
            label="Withdraw earnings"
            description={`${formatMoney(balances.withdrawable)} available`}
            icon="arrow-up-circle-outline"
            onPress={() => navigation.navigate('Withdraw')}
          />
          <Divider inset={60} />
          <ListRow
            label="Buy coins"
            description="EasyPaisa, JazzCash, bank transfer, USDT"
            icon="card-outline"
            onPress={() => navigation.navigate('BuyCoins')}
          />
          <Divider inset={60} />
          <ListRow
            label="Transaction history"
            description="Every movement across all four balances"
            icon="receipt-outline"
            onPress={() => navigation.navigate('Transactions')}
          />
          <Divider inset={60} />
          <ListRow
            label="Advertising"
            icon="megaphone-outline"
            onPress={() => navigation.navigate('Ads')}
          />
        </Card>

        {/* Recent activity */}
        <SectionHeader
          title="Recent activity"
          action="See all"
          onActionPress={() => navigation.navigate('Transactions')}
        />
        <Card>
          {transactions.slice(0, 5).map((transaction, index) => {
            const positive = transaction.coins > 0;
            return (
              <View key={transaction.id}>
                {index > 0 ? <Divider inset={60} /> : null}
                <ListRow
                  label={transaction.description}
                  description={`${timeAgo(transaction.createdAt)} · balance ${transaction.newBalance.toLocaleString()}`}
                  icon={transactionIcon(transaction.type)}
                  iconColor={positive ? theme.colors.success : theme.colors.textSecondary}
                  showChevron={false}
                  right={
                    <View style={styles.amountWrap}>
                      <Text variant="bodyStrong" tone={positive ? 'success' : 'primary'}>
                        {formatCoins(transaction.coins)}
                      </Text>
                      {transaction.status !== 'successful' ? (
                        <Badge
                          label={transaction.status.replace('_', ' ')}
                          tone={transaction.status === 'pending' ? 'warning' : 'neutral'}
                          size="sm"
                        />
                      ) : null}
                    </View>
                  }
                />
              </View>
            );
          })}
        </Card>

        {/* Explainer */}
        <Card padded style={{ marginTop: theme.spacing.lg }}>
          <Text variant="bodyStrong">What each balance is for</Text>
          <View style={{ marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
            {[
              { label: 'Coin balance', text: 'Bought or converted. Spend on promotion and gifts.', color: theme.colors.brand },
              { label: 'Reward balance', text: 'From tasks and referrals. Converts to coins, not cash.', color: theme.colors.accent },
              { label: 'Live gift earnings', text: 'Gifts from viewers. Becomes withdrawable after clearing.', color: theme.colors.gold },
              { label: 'Withdrawable', text: 'Cleared earnings you can pay out to USDT or bank.', color: theme.colors.success },
            ].map((row) => (
              <View key={row.label} style={styles.legendRow}>
                <View style={[styles.dot, { backgroundColor: row.color }]} />
                <View style={styles.flex}>
                  <Text variant="label">{row.label}</Text>
                  <Text variant="caption" tone="muted">
                    {row.text}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Card>

        <View style={[styles.note, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }]}>
          <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textMuted} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            Every transaction is permanently recorded with the balance before and after it. Balances
            are never edited directly.
          </Text>
        </View>
      </ScrollView>

      {/* Convert sheet */}
      <Sheet
        visible={converting}
        onClose={() => setConverting(false)}
        title="Convert reward to coins"
        subtitle={`${formatCount(balances.reward)} reward available`}
        height={0.55}
        showClose
      >
        <View style={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
          <SliderRow
            label="Reward to convert"
            value={convertAmount}
            min={0}
            max={balances.reward}
            defaultValue={0}
            onChange={(value) => setConvertAmount(Math.round(value / 50) * 50)}
          />

          <View
            style={[
              styles.convertPreview,
              { backgroundColor: theme.colors.brandSoft, borderRadius: theme.radius.md },
            ]}
          >
            <View style={styles.flex}>
              <Text variant="caption" tone="muted">
                You will receive
              </Text>
              <View style={styles.coinRow}>
                <Ionicons name="logo-bitcoin" size={18} color={theme.colors.gold} />
                <Text variant="h2" tone="brand">
                  {formatCount(convertedCoins)}
                </Text>
                <Text variant="label" tone="muted">
                  coins
                </Text>
              </View>
            </View>
            <View style={styles.rateBox}>
              <Text variant="caption" tone="muted">
                Rate
              </Text>
              <Text variant="caption" tone="secondary">
                1 : {monetizationConfig.rewardToCoinRate}
              </Text>
            </View>
          </View>

          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={14} color={theme.colors.textMuted} />
            <Text variant="caption" tone="muted" style={styles.flex}>
              Converting is one-way. Coins can be spent on promotion and gifting but cannot be
              turned back into reward or cash.
            </Text>
          </View>

          {convertError ? (
            <Text variant="caption" tone="danger" style={{ paddingBottom: theme.spacing.xs }}>
              {convertError}
            </Text>
          ) : null}

          <Button
            label={`Convert ${formatCount(convertAmount)} reward`}
            variant="gradient"
            fullWidth
            disabled={convertAmount <= 0 || convertAmount > balances.reward}
            onPress={() => void doConvert()}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  balanceCard: { padding: 20 },
  balanceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balanceActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  tiles: { flexDirection: 'row', gap: 10 },
  convertRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  convertIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  convertPreview: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rateBox: { alignItems: 'flex-end' },
  amountWrap: { alignItems: 'flex-end', gap: 3 },
  legendRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
