import React, { useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  ChipRow,
  Badge,
  EmptyState,
  Divider,
  Sheet,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useApiData } from '../../hooks/useApiData';
import { ledger as ledgerApi, type LedgerEntry, type WalletKind } from '../../api/ledger';
import { formatCoins, formatDate, timeAgo } from '../../utils/format';
import { transactionIcon } from './WalletScreen';
import type { RootScreenProps } from '../../navigation/types';
import type { TransactionType } from '../../types';

const walletLabel: Record<string, string> = {
  coin: 'Coins',
  reward: 'Reward',
  live_gift: 'Live gifts',
  withdrawable: 'Withdrawable',
};

type Filter = 'all' | WalletKind | 'pending';

/**
 * The wallet ledger.
 *
 * Every row here is a real entry from the server's append-only ledger, showing
 * the balance before and after — which is what makes a disputed transaction
 * traceable rather than arguable. It used to render a fixed sample list, so the
 * one screen a person opens when they think money went missing was the one
 * screen guaranteed not to show their money.
 */
export function TransactionsScreen({ navigation }: RootScreenProps<'Transactions'>) {
  const theme = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<LedgerEntry | null>(null);

  // Fetched unfiltered and narrowed here: the wallet filters are cheap on a
  // list of fifty, and re-requesting on every chip tap would be slower.
  const { data: entries, source, loading } = useApiData<LedgerEntry[]>(
    () => ledgerApi.entries(undefined, 50),
    [],
    [],
    { fallbackOnEmpty: false },
  );

  const list = entries.filter((entry) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return entry.status !== 'successful';
    return entry.wallet === filter;
  });

  return (
    <Screen>
      <Header title="Transactions" />

      <SourceNote
        source={source}
        noun="transactions"
        liveHint="every entry is from your wallet ledger"
        sampleHint="sign in to see your transactions"
      />

      <View style={{ paddingBottom: theme.spacing.sm }}>
        <ChipRow
          items={[
            { id: 'all', label: 'All' },
            { id: 'coin', label: 'Coins' },
            { id: 'reward', label: 'Reward' },
            { id: 'live_gift', label: 'Live gifts' },
            { id: 'withdrawable', label: 'Withdrawable' },
            { id: 'pending', label: 'Pending' },
          ]}
          selectedId={filter}
          onSelect={(id) => setFilter(id as Filter)}
        />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.brand} />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <Divider inset={64} />}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title={filter === 'all' ? 'No transactions yet' : 'Nothing in this wallet'}
              description={
                filter === 'all'
                  ? 'Coins you buy, rewards you earn and gifts you receive all appear here.'
                  : undefined
              }
            />
          }
          renderItem={({ item }) => {
            const positive = item.amount > 0;
            return (
              <Pressable
                onPress={() => setDetail(item)}
                style={[
                  styles.row,
                  { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
                ]}
              >
                <View
                  style={[
                    styles.icon,
                    {
                      backgroundColor: positive ? theme.colors.successSoft : theme.colors.surfaceAlt,
                      borderRadius: theme.radius.sm,
                    },
                  ]}
                >
                  <Ionicons
                    name={transactionIcon(item.type as TransactionType)}
                    size={18}
                    color={positive ? theme.colors.success : theme.colors.textSecondary}
                  />
                </View>

                <View style={styles.flex}>
                  <Text variant="body" numberOfLines={1}>
                    {item.description}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {walletLabel[item.wallet] ?? item.wallet} · {timeAgo(item.createdAt)}
                  </Text>
                </View>

                <View style={styles.amount}>
                  <Text variant="bodyStrong" tone={positive ? 'success' : 'primary'}>
                    {formatCoins(item.amount)}
                  </Text>
                  {item.status !== 'successful' ? (
                    <Badge
                      label={item.status}
                      tone={
                        item.status === 'pending'
                          ? 'warning'
                          : item.status === 'failed'
                            ? 'danger'
                            : 'neutral'
                      }
                      size="sm"
                    />
                  ) : (
                    <Text variant="caption" tone="muted">
                      bal {item.balanceAfter.toLocaleString()}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* The before/after balance the platform stores — what makes a dispute traceable */}
      <Sheet
        visible={detail !== null}
        onClose={() => setDetail(null)}
        title="Transaction details"
        height={0.6}
        showClose
      >
        {detail ? (
          <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
            <View style={styles.detailHeader}>
              <Text variant="h1" tone={detail.amount > 0 ? 'success' : 'primary'}>
                {formatCoins(detail.amount)}
              </Text>
              <Text variant="label" tone="muted">
                {detail.wallet === 'withdrawable' ? '' : 'coins'}
              </Text>
            </View>

            {[
              { label: 'Description', value: detail.description },
              { label: 'Type', value: detail.type.replace(/_/g, ' ') },
              { label: 'Status', value: detail.status },
              { label: 'Reference', value: detail.id },
              { label: 'Wallet', value: walletLabel[detail.wallet] ?? detail.wallet },
              { label: 'Previous balance', value: detail.balanceBefore.toLocaleString() },
              { label: 'New balance', value: detail.balanceAfter.toLocaleString() },
              { label: 'Date', value: formatDate(detail.createdAt) },
            ].map((row) => (
              <View key={row.label} style={styles.detailRow}>
                <Text variant="label" tone="secondary" style={styles.flex}>
                  {row.label}
                </Text>
                <Text variant="label" numberOfLines={1} style={styles.detailValue}>
                  {row.value}
                </Text>
              </View>
            ))}

            <View style={[styles.note, { marginTop: theme.spacing.sm }]}>
              <Ionicons name="information-circle-outline" size={14} color={theme.colors.textMuted} />
              <Text variant="caption" tone="muted" style={styles.flex}>
                Something wrong with this transaction? Open a support ticket with this reference
                and we will trace it.
              </Text>
            </View>

            <Pressable
              onPress={() => {
                setDetail(null);
                navigation.navigate('Support');
              }}
            >
              <Text variant="label" tone="brand">
                Contact support
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { paddingVertical: 60, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  amount: { alignItems: 'flex-end', gap: 2 },
  detailHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailValue: { maxWidth: '60%', textAlign: 'right' },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
