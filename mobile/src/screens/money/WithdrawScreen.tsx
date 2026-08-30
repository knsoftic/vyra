import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Card,
  Badge,
  ListRow,
  Divider,
  Sheet,
  Segmented,
  SectionHeader,
  EmptyState,
} from '../../components';
import { useTheme } from '../../theme';
import {
  withdrawalMethods,
  withdrawalRequests,
  monetizationConfig,
  walletBalances,
  liveGiftEarnings,
} from '../../mock';
import { SourceNote } from '../../components/DataSource';
import { useApiData } from '../../hooks/useApiData';
import { money, moneyKey, ApiError } from '../../api';

/** Payout kinds carry no icon in the database; the app supplies the glyph. */
const PAYOUT_ICON: Record<string, string> = {
  easypaisa: 'phone-portrait-outline',
  jazzcash: 'phone-portrait-outline',
  bank: 'business-outline',
  usdt: 'logo-bitcoin',
};
import { formatMoney, formatCount, timeAgo, formatDate } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { WithdrawalStatus } from '../../types';

const statusMeta: Record<
  WithdrawalStatus,
  { label: string; tone: 'warning' | 'accent' | 'success' | 'danger' | 'neutral'; icon: string }
> = {
  pending: { label: 'Pending', tone: 'warning', icon: 'time-outline' },
  under_review: { label: 'Under review', tone: 'accent', icon: 'search-outline' },
  approved: { label: 'Approved', tone: 'accent', icon: 'checkmark-outline' },
  paid: { label: 'Paid', tone: 'success', icon: 'checkmark-done-outline' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'close-outline' },
};

export function WithdrawScreen({ navigation }: RootScreenProps<'Withdraw'>) {
  /**
   * Balance and payout methods from the server.
   *
   * The available figure has to be the one the server will check, or a user is
   * invited to request money that will be refused — and the minimums and fees
   * are per-method configuration, not constants.
   */
  const { data: liveBalances, source: balanceSource, refresh: refreshBalances } = useApiData(
    () => money.balances(),
    null,
    [],
  );
  const { data: livePayoutMethods, source: methodSource } = useApiData(
    () => money.payoutMethods(),
    [],
    [],
  );

  const liveWithdraw = balanceSource === 'live' && methodSource === 'live';
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const theme = useTheme();
  const [tab, setTab] = useState<'request' | 'history'>('request');
  const [methodId, setMethodId] = useState(withdrawalMethods[0]!.id);
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Server methods where there are any, so minimums and fees are the ones that
  // will actually be applied.
  const methods =
    methodSource === 'live' && livePayoutMethods.length > 0
      ? livePayoutMethods.map((m) => ({
          id: m.id,
          label: m.label,
          kind: m.kind as (typeof withdrawalMethods)[number]['kind'],
          fieldLabel: m.fieldLabel,
          // The server stores what to ask for, not an example of it; a generic
          // placeholder is better than inventing a fake account number.
          fieldPlaceholder: m.network ? `${m.network} address` : m.fieldLabel,
          icon: PAYOUT_ICON[m.kind] ?? 'cash-outline',
          network: m.network,
          minAmount: m.minAmount,
          feePercent: m.feePercent,
          processingTime: m.processingTime,
          enabled: true,
        }))
      : withdrawalMethods;

  const method = methods.find((m) => m.id === methodId) ?? methods[0]!;

  const available =
    balanceSource === 'live' && liveBalances
      ? liveBalances.withdrawable
      : walletBalances.withdrawable;

  const pendingWithdrawal =
    balanceSource === 'live' && liveBalances
      ? liveBalances.pendingWithdrawal
      : walletBalances.pendingWithdrawal;

  /**
   * Places the request.
   *
   * The server debits the balance the moment this succeeds — the request *is*
   * the hold — so the key is created once here and reused on any retry, or a
   * retry would place a second hold on money the user does not have twice.
   */
  const submitRequest = () => {
    if (!liveWithdraw) {
      setConfirming(false);
      setSubmitted(true);
      return;
    }
    setRequesting(true);
    setRequestError(null);

    void money
      .requestWithdrawal(
        { methodId: method.id, amount: numericAmount, destination: destination.trim() },
        moneyKey('withdraw'),
      )
      .then(async () => {
        await refreshBalances();
        setConfirming(false);
        setSubmitted(true);
      })
      .catch((err: unknown) => {
        setRequestError(
          err instanceof ApiError ? err.message : 'The request could not be submitted.',
        );
      })
      .finally(() => setRequesting(false));
  };

  const numericAmount = Number(amount.replace(/[^\d.]/g, '')) || 0;
  const fee = (numericAmount * method.feePercent) / 100;
  const receives = Math.max(0, numericAmount - fee);

  const belowMin = numericAmount > 0 && numericAmount < method.minAmount;
  const overBalance = numericAmount > available;
  const valid =
    numericAmount > 0 && !belowMin && !overBalance && destination.trim().length > 6;

  if (!monetizationConfig.withdrawalEnabled) {
    return (
      <Screen>
        <Header title="Withdraw" />
        <EmptyState
          icon="lock-closed-outline"
          title="Withdrawals are not available"
          description="Withdrawals are currently disabled on the platform. Your earnings stay safe in your balance."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Withdraw" subtitle={`${formatMoney(available)} available`} />

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Segmented
          options={[
            { id: 'request', label: 'New request' },
            { id: 'history', label: `History (${withdrawalRequests.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {tab === 'history' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <SourceNote source={liveWithdraw ? 'live' : 'sample'} noun="balance" sampleHint="sign in to withdraw real earnings" />
          {withdrawalRequests.length === 0 ? (
            <EmptyState icon="receipt-outline" title="No withdrawals yet" />
          ) : (
            <Card>
              {withdrawalRequests.map((request, index) => {
                const meta = statusMeta[request.status];
                return (
                  <View key={request.id}>
                    {index > 0 ? <Divider inset={16} /> : null}
                    <View style={{ padding: theme.spacing.md }}>
                      <View style={styles.historyTop}>
                        <View style={styles.flex}>
                          <Text variant="bodyStrong">{formatMoney(request.amount)}</Text>
                          <Text variant="caption" tone="muted">
                            {request.methodLabel} · {request.destination}
                          </Text>
                        </View>
                        <Badge label={meta.label} tone={meta.tone} size="sm" />
                      </View>

                      <View style={[styles.historyMeta, { marginTop: theme.spacing.xs }]}>
                        <Text variant="caption" tone="muted">
                          #{request.id}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {request.settledAt
                            ? `Settled ${formatDate(request.settledAt)}`
                            : `Requested ${timeAgo(request.requestedAt)}`}
                        </Text>
                      </View>

                      {request.note ? (
                        <View
                          style={[
                            styles.noteBox,
                            { backgroundColor: theme.colors.dangerSoft, borderRadius: theme.radius.sm },
                          ]}
                        >
                          <Text variant="caption" tone="danger">
                            {request.note}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </Card>
          )}
        </ScrollView>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
            {/* Balance summary */}
            <Card padded>
              <View style={styles.balanceRow}>
                <View style={styles.flex}>
                  <Text variant="caption" tone="muted">
                    Available to withdraw
                  </Text>
                  <Text variant="h1" tone="success">
                    {formatMoney(available)}
                  </Text>
                </View>
                <Ionicons name="cash-outline" size={22} color={theme.colors.success} />
              </View>

              <Divider />

              <View style={{ marginTop: theme.spacing.sm, gap: 6 }}>
                <View style={styles.summaryRow}>
                  <Text variant="caption" tone="muted" style={styles.flex}>
                    Clearing ({monetizationConfig.clearingDays} days)
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {formatMoney(liveGiftEarnings.clearingUsd)}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text variant="caption" tone="muted" style={styles.flex}>
                    Pending payout
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {formatMoney(pendingWithdrawal)}
                  </Text>
                </View>
              </View>
            </Card>

            {/* Method */}
            <SectionHeader title="Withdrawal method" />
            <Card>
              {withdrawalMethods
                .filter((m) => m.enabled)
                .map((item, index) => (
                  <View key={item.id}>
                    {index > 0 ? <Divider inset={60} /> : null}
                    <ListRow
                      label={item.label}
                      description={`Min ${formatMoney(item.minAmount)} · ${item.feePercent}% fee · ${item.processingTime}`}
                      icon={item.icon as never}
                      onPress={() => setMethodId(item.id)}
                      showChevron={false}
                      right={
                        methodId === item.id ? (
                          <Ionicons name="checkmark-circle" size={20} color={theme.colors.brand} />
                        ) : (
                          <Ionicons name="ellipse-outline" size={20} color={theme.colors.textMuted} />
                        )
                      }
                    />
                  </View>
                ))}
            </Card>

            {/* Destination */}
            <SectionHeader title="Payout details" />
            <Card padded style={{ gap: theme.spacing.md }}>
              <View>
                <Text variant="caption" tone="muted" style={{ marginBottom: theme.spacing.xs }}>
                  {method.fieldLabel}
                </Text>
                <TextInput
                  value={destination}
                  onChangeText={setDestination}
                  placeholder={method.fieldPlaceholder}
                  placeholderTextColor={theme.colors.textMuted}
                  autoCapitalize="none"
                  style={[
                    theme.typography.body,
                    styles.input,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.colors.surfaceAlt,
                      borderRadius: theme.radius.md,
                    },
                  ]}
                />
                {method.network ? (
                  <Text variant="caption" tone="warning" style={{ marginTop: 4 }}>
                    Send on the {method.network} network only. Other networks will lose the funds.
                  </Text>
                ) : null}
              </View>

              <View>
                <View style={styles.amountLabel}>
                  <Text variant="caption" tone="muted">
                    Amount
                  </Text>
                  <Pressable onPress={() => setAmount(String(available))}>
                    <Text variant="caption" tone="brand">
                      Withdraw all
                    </Text>
                  </Pressable>
                </View>
                <View
                  style={[
                    styles.amountInput,
                    {
                      backgroundColor: theme.colors.surfaceAlt,
                      borderRadius: theme.radius.md,
                      borderColor: belowMin || overBalance ? theme.colors.danger : 'transparent',
                    },
                  ]}
                >
                  <Text variant="h3" tone="muted">
                    $
                  </Text>
                  <TextInput
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="numeric"
                    placeholder="0.00"
                    placeholderTextColor={theme.colors.textMuted}
                    style={[theme.typography.h2, { color: theme.colors.text, flex: 1 }]}
                  />
                  <Text variant="label" tone="muted">
                    {monetizationConfig.withdrawalCurrency}
                  </Text>
                </View>

                {belowMin ? (
                  <Text variant="caption" tone="danger" style={{ marginTop: 4 }}>
                    Minimum for {method.label} is {formatMoney(method.minAmount)}
                  </Text>
                ) : overBalance ? (
                  <Text variant="caption" tone="danger" style={{ marginTop: 4 }}>
                    You only have {formatMoney(available)} available
                  </Text>
                ) : null}
              </View>

              {/* Breakdown */}
              {numericAmount > 0 ? (
                <View
                  style={[
                    styles.breakdown,
                    { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md },
                  ]}
                >
                  <View style={styles.summaryRow}>
                    <Text variant="caption" tone="muted" style={styles.flex}>
                      Amount
                    </Text>
                    <Text variant="caption">{formatMoney(numericAmount)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text variant="caption" tone="muted" style={styles.flex}>
                      Fee ({method.feePercent}%)
                    </Text>
                    <Text variant="caption" tone="danger">
                      −{formatMoney(fee)}
                    </Text>
                  </View>
                  <Divider />
                  <View style={styles.summaryRow}>
                    <Text variant="label" style={styles.flex}>
                      You receive
                    </Text>
                    <Text variant="labelStrong" tone="success">
                      {formatMoney(receives)}
                    </Text>
                  </View>
                </View>
              ) : null}
            </Card>

            <Card padded style={{ marginTop: theme.spacing.lg }}>
              <View style={styles.noticeRow}>
                <Ionicons name="information-circle-outline" size={16} color={theme.colors.info} />
                <Text variant="caption" tone="secondary" style={styles.flex}>
                  Only live gift earnings can be withdrawn. Task rewards, referral rewards and
                  purchased coins stay inside the app for promotion and gifting.
                </Text>
              </View>
            </Card>
          </ScrollView>

          <View
            style={[
              styles.footer,
              {
                backgroundColor: theme.colors.bg,
                borderTopColor: theme.colors.border,
                padding: theme.spacing.md,
              },
            ]}
          >
            <View style={styles.flex}>
              <Text variant="caption" tone="muted">
                You receive
              </Text>
              <Text variant="h3">{formatMoney(receives)}</Text>
            </View>
            <Button
              label="Request withdrawal"
              variant="gradient"
              size="lg"
              disabled={!valid}
              onPress={() => setConfirming(true)}
            />
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Confirm */}
      <Sheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm withdrawal"
        height={0.55}
        showClose
      >
        <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
          {[
            { label: 'Method', value: method.label },
            { label: 'Destination', value: destination || '—' },
            { label: 'Amount', value: formatMoney(numericAmount) },
            { label: `Fee (${method.feePercent}%)`, value: `−${formatMoney(fee)}` },
            { label: 'You receive', value: formatMoney(receives) },
            { label: 'Processing time', value: method.processingTime },
            { label: 'Balance after', value: formatMoney(available - numericAmount) },
          ].map((row) => (
            <View key={row.label} style={styles.summaryRow}>
              <Text variant="label" tone="secondary" style={styles.flex}>
                {row.label}
              </Text>
              <Text variant="label" numberOfLines={1}>
                {row.value}
              </Text>
            </View>
          ))}

          <View style={[styles.noticeRow, { marginTop: theme.spacing.xs }]}>
            <Ionicons name="warning-outline" size={14} color={theme.colors.warning} />
            <Text variant="caption" tone="muted" style={styles.flex}>
              Check the destination carefully. Payouts sent to a wrong address cannot be recovered.
            </Text>
          </View>

          {requestError ? (
            <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.sm }}>
              {requestError}
            </Text>
          ) : null}

          <Button
            label="Submit request"
            variant="gradient"
            fullWidth
            loading={requesting}
            style={{ marginTop: theme.spacing.sm }}
            onPress={submitRequest}
          />
        </View>
      </Sheet>

      {/* Submitted */}
      <Sheet
        visible={submitted}
        onClose={() => setSubmitted(false)}
        title="Request submitted"
        height={0.45}
        showClose
      >
        <View style={{ padding: theme.spacing.md, alignItems: 'center' }}>
          <View
            style={[
              styles.doneIcon,
              { backgroundColor: theme.colors.successSoft, borderRadius: theme.radius.pill },
            ]}
          >
            <Ionicons name="checkmark" size={30} color={theme.colors.success} />
          </View>
          <Text variant="h3" align="center" style={{ marginTop: theme.spacing.md }}>
            Withdrawal requested
          </Text>
          <Text variant="label" tone="secondary" align="center" style={{ marginTop: theme.spacing.xs }}>
            {formatMoney(receives)} to {method.label}. Expect it within {method.processingTime}. You
            can follow the status in your withdrawal history.
          </Text>
          <Button
            label="View history"
            variant="gradient"
            fullWidth
            style={{ marginTop: theme.spacing.lg }}
            onPress={() => {
              setSubmitted(false);
              setTab('history');
              setAmount('');
              setDestination('');
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  amountLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  amountInput: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 56, borderWidth: 1.5 },
  input: { height: 48, paddingHorizontal: 14 },
  breakdown: { padding: 12, gap: 6 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  historyTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  historyMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  noteBox: { padding: 8, marginTop: 8 },
  noticeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  doneIcon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
});
