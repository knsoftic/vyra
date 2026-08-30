import React from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Button,
  Card,
  Avatar,
  Divider,
  SectionHeader,
  ListRow,
} from '../../components';
import { BarChart } from '../../components/Charts';
import { BalanceTile } from '../../components/money/ProgressRow';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useApiData } from '../../hooks/useApiData';
import { ledger as ledgerApi, type GiftEarnings } from '../../api/ledger';
import { gifts as giftsApi, type GiftHistoryEntry } from '../../api';
import { formatCount, timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

const EMPTY: GiftEarnings = {
  days: 28,
  availableAmount: 0,
  clearingAmount: 0,
  currency: 'USD',
  coinToPayoutRate: 0,
  giftCoinsReceived: 0,
  giftsReceived: 0,
  giftCoinsSent: 0,
  dailyCoins: [],
  topGifters: [],
};

/**
 * Live gift earnings.
 *
 * Two balances, kept apart on purpose. `available` is cleared and payable;
 * `clearing` is earned and still inside the holding window. Adding them
 * together would show someone a number they cannot withdraw and call it
 * available, which is the one mistake an earnings screen must not make.
 *
 * Top supporters are ranked by the server across all gifts, not by the app
 * across the last fifty — otherwise the ranking would silently mean "top
 * supporter of the recent few".
 */
export function LiveEarningsScreen({ navigation }: RootScreenProps<'LiveEarnings'>) {
  const theme = useTheme();

  const { data: e, source, loading } = useApiData<GiftEarnings>(
    () => ledgerApi.giftEarnings(28),
    EMPTY,
    [],
    { fallbackOnEmpty: false },
  );

  const { data: history } = useApiData<GiftHistoryEntry[]>(
    () => giftsApi.history(),
    [],
    [],
    { fallbackOnEmpty: false },
  );

  const received = history.filter((entry) => entry.direction === 'received').slice(0, 8);
  const money = (amount: number) => `${amount.toFixed(2)} ${e.currency}`;
  const hasSeries = e.dailyCoins.some((p) => p.value > 0);

  return (
    <Screen>
      <Header title="Live gift earnings" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <SourceNote
          source={source}
          noun="earnings"
          liveHint="these are your real balances and gifts"
          sampleHint="sign in to see your earnings"
        />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.brand} />
          </View>
        ) : (
          <>
            {/* The payable balance — and only the payable one */}
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
                {money(e.availableAmount)}
              </Text>
              <Text variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
                {formatCount(e.giftCoinsReceived)} gift coins received
                {e.clearingAmount > 0 ? ` · ${money(e.clearingAmount)} still clearing` : ''}
              </Text>

              <Button
                label="Withdraw"
                variant="secondary"
                onPress={() => navigation.navigate('Withdraw')}
                disabled={e.availableAmount <= 0}
                style={{ marginTop: theme.spacing.md }}
              />
            </LinearGradient>

            <View style={[styles.tiles, { paddingHorizontal: theme.spacing.md }]}>
              <BalanceTile
                label="Clearing"
                value={money(e.clearingAmount)}
                icon="time-outline"
                tone="gold"
              />
              <BalanceTile
                label="Gifts received"
                value={formatCount(e.giftsReceived)}
                icon="gift-outline"
                tone="brand"
              />
            </View>

            <View style={[styles.tiles, { padding: theme.spacing.md }]}>
              <BalanceTile
                label="Coins received"
                value={formatCount(e.giftCoinsReceived)}
                icon="logo-bitcoin"
                tone="accent"
              />
              <BalanceTile
                label="Coins sent"
                value={formatCount(e.giftCoinsSent)}
                icon="arrow-up-outline"
              />
            </View>

            <SectionHeader title={`Gift coins · last ${e.days} days`} />
            <Card padded>
              {hasSeries ? (
                <BarChart
                  data={e.dailyCoins.map((p) => ({ label: p.day.slice(5), value: p.value }))}
                  height={140}
                  accent={theme.colors.accent}
                />
              ) : (
                <Text variant="caption" tone="muted">
                  No gifts received in this period.
                </Text>
              )}
            </Card>

            <SectionHeader title="Recent gifts" />
            <Card>
              {received.length === 0 ? (
                <View style={{ padding: theme.spacing.md }}>
                  <Text variant="caption" tone="muted">
                    Gifts people send you during a live stream appear here.
                  </Text>
                </View>
              ) : (
                received.map((entry, index) => (
                  <View key={entry.id}>
                    {index > 0 ? <Divider inset={72} /> : null}
                    <View style={[styles.giftRow, { padding: theme.spacing.md }]}>
                      <Avatar uri={entry.counterparty.avatar ?? undefined} size={40} />
                      <View style={styles.flex}>
                        <Text variant="body" numberOfLines={1}>
                          @{entry.counterparty.username}
                        </Text>
                        <Text variant="caption" tone="muted">
                          sent {entry.gift.icon} {entry.gift.name}
                          {entry.quantity > 1 ? ` ×${entry.quantity}` : ''} · {timeAgo(entry.createdAt)}
                        </Text>
                      </View>
                      <View style={styles.coinRow}>
                        <Ionicons name="logo-bitcoin" size={12} color={theme.colors.gold} />
                        <Text variant="labelStrong" style={{ color: theme.colors.gold }}>
                          +{formatCount(entry.coinsToCreator)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </Card>

            <SectionHeader title="Top supporters" />
            <Card>
              {e.topGifters.length === 0 ? (
                <View style={{ padding: theme.spacing.md }}>
                  <Text variant="caption" tone="muted">
                    Once people send you gifts, the ones who send most appear here.
                  </Text>
                </View>
              ) : (
                e.topGifters.map((entry, index) => (
                  <View key={entry.id}>
                    {index > 0 ? <Divider inset={72} /> : null}
                    <View style={[styles.giftRow, { padding: theme.spacing.md }]}>
                      <View style={styles.rankWrap}>
                        <Text variant="labelStrong" tone={index === 0 ? 'brand' : 'muted'}>
                          {index + 1}
                        </Text>
                      </View>
                      <Avatar uri={entry.avatar ?? undefined} size={36} />
                      <View style={styles.flex}>
                        <Text variant="body" numberOfLines={1}>
                          {entry.displayName}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {formatCount(entry.gifts)} {entry.gifts === 1 ? 'gift' : 'gifts'}
                        </Text>
                      </View>
                      <Text variant="labelStrong" style={{ color: theme.colors.gold }}>
                        {formatCount(entry.coins)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </Card>

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
                label="Coin value"
                description="What one gift coin is worth when you withdraw"
                icon="cash-outline"
                value={`${e.coinToPayoutRate} ${e.currency}`}
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
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tiles: { flexDirection: 'row', gap: 10 },
  giftRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rankWrap: { width: 20, alignItems: 'center' },
  noticeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
