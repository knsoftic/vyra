import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Sheet, SHEET_MAX_WIDTH } from '../Sheet';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { Button } from '../Button';
import { Badge } from '../Cards';
import { useTheme } from '../../theme';
import { useApiData } from '../../hooks/useApiData';

import { gifts as giftsApi, wallet as walletApi } from '../../api';
import { useContentWidth } from '../../hooks/useResponsive';
import { gifts, walletBalance } from '../../mock';
import type { Gift } from '../../types';

const COLUMNS = 4;

export function GiftSheet({
  visible,
  onClose,
  onSend,
  onTopUp,
}: {
  visible: boolean;
  onClose: () => void;
  onSend: (gift: Gift, quantity: number) => void;
  onTopUp: () => void;
}) {
  /**
   * The catalogue and the balance both come from the server.
   *
   * Prices are admin-editable, so a hard-coded list here would let someone send
   * a gift at yesterday's price — and the balance shown next to a "send" button
   * has to be the one that will actually be charged.
   */
  const { data: liveGifts, source: giftSource } = useApiData(
    () => giftsApi.catalogue(),
    [],
    [],
  );

  // The balance shown beside a "send" button must be the one that will be
  // charged, not a figure from the sample data.
  const { data: balances, source: balanceSource } = useApiData(
    () => walletApi.balances(),
    null,
    [],
  );
  const coins = balanceSource === 'live' && balances ? balances.coin : walletBalance;

  const catalogue =
    giftSource === 'live'
      ? liveGifts.map((g) => ({
          id: g.id,
          slug: g.slug,
          name: g.name,
          icon: g.icon,
          coins: g.coins,
          isFeatured: g.isFeatured,
          isActive: true,
        }))
      : gifts;
  const theme = useTheme();
  const TILE = (useContentWidth(SHEET_MAX_WIDTH) - 16 * 2 - 8 * (COLUMNS - 1)) / COLUMNS;
  const [selected, setSelected] = useState<Gift | null>(null);
  const [quantity, setQuantity] = useState(1);

  const total = (selected?.coins ?? 0) * quantity;
  const canAfford = total <= walletBalance;

  return (
    <Sheet visible={visible} onClose={onClose} height={0.58}>
      {/* Balance */}
      <View
        style={[
          styles.balanceRow,
          { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm },
        ]}
      >
        <View style={styles.balanceLeft}>
          <Ionicons name="logo-bitcoin" size={18} color={theme.colors.gold} />
          <Text variant="bodyStrong">{coins.toLocaleString()}</Text>
          <Text variant="caption" tone="muted">
            coins
          </Text>
        </View>
        <Pressable onPress={onTopUp} hitSlop={theme.layout.hitSlop}>
          <Text variant="label" tone="brand">
            Top up
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.grid, { paddingHorizontal: theme.spacing.md }]}
        showsVerticalScrollIndicator={false}
      >
        {catalogue
          .filter((gift) => gift.isActive)
          .map((gift) => {
            const active = selected?.id === gift.id;
            return (
              <Pressable
                key={gift.id}
                onPress={() => {
                  setSelected(gift);
                  setQuantity(1);
                }}
                haptic
                style={[
                  styles.tile,
                  {
                    width: TILE,
                    backgroundColor: active ? theme.colors.brandSoft : theme.colors.surface,
                    borderColor: active ? theme.colors.brand : 'transparent',
                    borderRadius: theme.radius.md,
                  },
                ]}
              >
                {gift.isFeatured ? (
                  <Badge label="Hot" tone="brand" size="sm" style={styles.featured} />
                ) : null}
                <Text style={styles.giftIcon}>{gift.icon}</Text>
                <Text variant="caption" numberOfLines={1}>
                  {gift.name}
                </Text>
                <View style={styles.coinRow}>
                  <Ionicons name="logo-bitcoin" size={10} color={theme.colors.gold} />
                  <Text variant="caption" tone="muted">
                    {gift.coins}
                  </Text>
                </View>
              </Pressable>
            );
          })}
      </ScrollView>

      {/* Send bar */}
      <View
        style={[
          styles.footer,
          {
            borderTopColor: theme.colors.border,
            padding: theme.spacing.md,
            backgroundColor: theme.colors.bg,
          },
        ]}
      >
        {selected ? (
          <View style={styles.quantityRow}>
            {[1, 5, 10, 50].map((amount) => (
              <Pressable
                key={amount}
                onPress={() => setQuantity(amount)}
                style={[
                  styles.quantityChip,
                  {
                    backgroundColor:
                      quantity === amount ? theme.colors.brand : theme.colors.surfaceAlt,
                    borderRadius: theme.radius.pill,
                  },
                ]}
              >
                <Text
                  variant="caption"
                  style={{ color: quantity === amount ? '#FFF' : theme.colors.textSecondary }}
                >
                  x{amount}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Button
          label={
            !selected
              ? 'Select a gift'
              : canAfford
                ? `Send ${selected.name} — ${total.toLocaleString()} coins`
                : 'Not enough coins'
          }
          variant={canAfford && selected ? 'gradient' : 'secondary'}
          fullWidth
          disabled={!selected}
          onPress={() => {
            if (!selected) return;
            if (!canAfford) return onTopUp();
            onSend(selected, quantity);
            setSelected(null);
            setQuantity(1);
          }}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balanceLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 16 },
  tile: { alignItems: 'center', gap: 2, paddingVertical: 10, borderWidth: 1.5 },
  featured: { position: 'absolute', top: 4, right: 4 },
  giftIcon: { fontSize: 24 },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  quantityRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  quantityChip: { paddingHorizontal: 14, paddingVertical: 6 },
});
