import React, { useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
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
import { useTheme } from '../../theme';
import { transactions } from '../../mock';
import { formatCoins, formatDate, timeAgo } from '../../utils/format';
import { transactionIcon } from './WalletScreen';
import type { RootScreenProps } from '../../navigation/types';
import type { CoinTransaction, WalletKind } from '../../types';

const walletLabel: Record<WalletKind, string> = {
  coin: 'Coins',
  reward: 'Reward',
  live_gift: 'Live gifts',
  withdrawable: 'Withdrawable',
};

type Filter = 'all' | 'coin' | 'reward' | 'live_gift' | 'withdrawable' | 'pending';

export function TransactionsScreen({ navigation }: RootScreenProps<'Transactions'>) {
  const theme = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<CoinTransaction | null>(null);

  const list = transactions.filter((transaction) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return transaction.status !== 'successful';
    return transaction.wallet === filter;
  });

  return (
    <Screen>
      <Header title="Transactions" />

      <View style={{ paddingBottom: theme.spacing.sm }}>
        <ChipRow
          items={[
            { id: 'all', label: 'All' },
            { id: 'coin', label: 'Coins' },
            { id: 'reward', label: 'Rewards' },
            { id: 'live_gift', label: 'Live gifts' },
            { id: 'withdrawable', label: 'Withdrawals' },
            { id: 'pending', label: 'Pending' },
          ]}
          selectedId={filter}
          onSelect={(id) => setFilter(id as Filter)}
        />
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <Divider inset={64} />}
        ListEmptyComponent={
          <EmptyState icon="receipt-outline" title="No transactions here" />
        }
        renderItem={({ item }) => {
          const positive = item.coins > 0;
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
                  name={transactionIcon(item.type)}
                  size={18}
                  color={positive ? theme.colors.success : theme.colors.textSecondary}
                />
              </View>

              <View style={styles.flex}>
                <Text variant="body" numberOfLines={1}>
                  {item.description}
                </Text>
                <Text variant="caption" tone="muted">
                  {walletLabel[item.wallet]} · {timeAgo(item.createdAt)} · {item.reference}
                </Text>
              </View>

              <View style={styles.amount}>
                <Text variant="bodyStrong" tone={positive ? 'success' : 'primary'}>
                  {formatCoins(item.coins)}
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
                    bal {item.newBalance.toLocaleString()}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />

      {/* Ledger detail — shows the before/after balance the platform stores */}
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
              <Text variant="h1" tone={detail.coins > 0 ? 'success' : 'primary'}>
                {formatCoins(detail.coins)}
              </Text>
              <Text variant="label" tone="muted">
                coins
              </Text>
            </View>

            {[
              { label: 'Description', value: detail.description },
              { label: 'Type', value: detail.type.replace('_', ' ') },
              { label: 'Status', value: detail.status },
              { label: 'Reference', value: detail.reference ?? '—' },
              { label: 'Transaction ID', value: detail.id },
              ...(detail.amount
                ? [{ label: 'Paid / paid out', value: `${detail.amount.toLocaleString()} ${detail.currency ?? ''}` }]
                : []),
              { label: 'Wallet', value: walletLabel[detail.wallet] },
              { label: 'Previous balance', value: detail.previousBalance.toLocaleString() },
              { label: 'New balance', value: detail.newBalance.toLocaleString() },
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
              <Text variant="labelStrong" tone="brand" align="center">
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  amount: { alignItems: 'flex-end', gap: 2 },
  detailHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 6, justifyContent: 'center', paddingBottom: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailValue: { maxWidth: '60%', textAlign: 'right' },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
