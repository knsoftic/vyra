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
  ChipRow,
} from '../../components';
import { useTheme } from '../../theme';
import {
  coinPackages as samplePackages,
  currencyRates,
  coinsFor,
  paymentMethods as sampleMethods,
  coinPurchaseRequests,
  walletBalances,
} from '../../mock';
import { SourceNote } from '../../components/DataSource';
import { useApiData } from '../../hooks/useApiData';
import { money, moneyKey, ApiError } from '../../api';

/** Payment kinds have no icon in the database; the app supplies the glyph. */
const ICON_FOR_KIND: Record<string, string> = {
  easypaisa: 'phone-portrait-outline',
  jazzcash: 'phone-portrait-outline',
  bank: 'business-outline',
  usdt: 'logo-bitcoin',
  card: 'card-outline',
};
import { formatCount } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';
import type { PaymentMethod, PurchaseStatus, CurrencyRate } from '../../types';

const statusMeta: Record<PurchaseStatus, { label: string; tone: 'warning' | 'accent' | 'success' | 'danger' }> = {
  pending: { label: 'Pending', tone: 'warning' },
  under_review: { label: 'Under review', tone: 'accent' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export function BuyCoinsScreen({ navigation }: RootScreenProps<'BuyCoins'>) {
  const theme = useTheme();

  const [tab, setTab] = useState<'buy' | 'requests'>('buy');
  const [currency, setCurrency] = useState('PKR');
  const [amount, setAmount] = useState('2000');
  const [packageId, setPackageId] = useState<string | null>(null);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [step, setStep] = useState<'none' | 'pay' | 'done'>('none');
  const [txRef, setTxRef] = useState('');
  const [proof, setProof] = useState(false);

  const rate = useMemo(
    () => currencyRates.find((r) => r.code === currency) ?? currencyRates[0],
    [currency],
  );

  const numericAmount = Number(amount.replace(/[^\d.]/g, '')) || 0;
  const calculatedCoins = coinsFor(numericAmount, currency);
  const belowMinimum = numericAmount > 0 && numericAmount < rate.minAmount;

  /**
   * Packages and methods come from the server.
   *
   * Prices are admin-editable, and the account number a buyer is told to pay
   * into must be the live one — a stale copy in the app sends money somewhere
   * nobody is watching.
   */
  const { data: livePackages, source: packageSource } = useApiData(
    () => money.packages(currency),
    [],
    [currency],
  );
  const { data: liveMethods, source: methodSource } = useApiData(
    () => money.paymentMethods(),
    [],
    [],
  );

  const coinPackages =
    packageSource === 'live'
      ? livePackages.map((pkg) => ({
          id: pkg.id,
          coins: pkg.coins,
          bonusCoins: pkg.bonusCoins,
          priceUsd: pkg.price,
          isPopular: pkg.isPopular,
          discountPercent: pkg.discountPercent,
        }))
      : samplePackages;

  const paymentMethods =
    methodSource === 'live'
      ? liveMethods.map<PaymentMethod>((m) => ({
          id: m.id,
          kind: m.kind as PaymentMethod['kind'],
          label: m.label,
          accountName: m.accountName,
          accountNumber: m.accountNumber,
          instructions: m.instructions,
          // An empty list from the server means "no restriction"; the filter
          // below needs a concrete list, so it gets every currency on offer.
          currencies: m.currencies.length > 0 ? m.currencies : ['USD', 'PKR', 'INR'],
          icon: ICON_FOR_KIND[m.kind] ?? 'card-outline',
          enabled: true,
          // Every method the platform supports today is a manual transfer that
          // an administrator confirms; no gateway settles on its own yet.
          manual: true,
        }))
      : sampleMethods;

  const live = packageSource === 'live' && methodSource === 'live';
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedPackage = coinPackages.find((p) => p.id === packageId) ?? null;
  const coinsToBuy = selectedPackage ? selectedPackage.coins + selectedPackage.bonusCoins : calculatedCoins;
  const payAmount = selectedPackage
    ? // package prices are quoted in USD, converted at the active rate
      Math.round((selectedPackage.coins + selectedPackage.bonusCoins) / rate.coinsPerUnit)
    : numericAmount;

  const availableMethods = paymentMethods.filter(
    (method) => method.enabled && method.currencies.includes(currency),
  );
  const method = availableMethods.find((m) => m.id === methodId) ?? null;

  const canContinue = coinsToBuy > 0 && !belowMinimum && method !== null;

  /**
   * Submits the claim that money was sent.
   *
   * Nothing is credited here — coins arrive when an administrator confirms the
   * transfer. The idempotency key is made once, at the moment of committing, so
   * a retry cannot create a second request for someone to reconcile by hand.
   */
  const submit = () => {
    if (!live || !method) {
      setStep('done');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);

    void money
      .requestPurchase(
        {
          ...(selectedPackage ? { packageId: selectedPackage.id } : { coins: coinsToBuy }),
          methodId: method.id,
          transactionRef: txRef.trim(),
          currency,
        },
        moneyKey('purchase'),
      )
      .then(() => setStep('done'))
      .catch((err: unknown) => {
        setSubmitError(
          err instanceof ApiError ? err.message : 'The request could not be submitted.',
        );
      })
      .finally(() => setSubmitting(false));
  };

  const reset = () => {
    setStep('none');
    setTxRef('');
    setProof(false);
  };

  return (
    <Screen>
      <Header
        title="Buy coins"
        subtitle={`${formatCount(walletBalances.coins)} coins available`}
      />

      <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Segmented
          options={[
            { id: 'buy', label: 'Buy coins' },
            { id: 'requests', label: `Requests (${coinPurchaseRequests.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {tab === 'requests' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <SourceNote source={live ? 'live' : 'sample'} noun="packages" sampleHint="sign in to buy coins" />
          {coinPurchaseRequests.length === 0 ? (
            <EmptyState icon="receipt-outline" title="No purchase requests yet" />
          ) : (
            <Card>
              {coinPurchaseRequests.map((request, index) => {
                const meta = statusMeta[request.status];
                return (
                  <View key={request.id}>
                    {index > 0 ? <Divider inset={16} /> : null}
                    <View style={{ padding: theme.spacing.md }}>
                      <View style={styles.requestTop}>
                        <View style={styles.flex}>
                          <View style={styles.coinRow}>
                            <Ionicons name="logo-bitcoin" size={14} color={theme.colors.gold} />
                            <Text variant="bodyStrong">{formatCount(request.coins)} coins</Text>
                          </View>
                          <Text variant="caption" tone="muted">
                            {request.methodLabel} · {rate.symbol === '$' ? '' : ''}
                            {request.amount.toLocaleString()} {request.currency}
                          </Text>
                        </View>
                        <Badge label={meta.label} tone={meta.tone} size="sm" />
                      </View>

                      <View style={[styles.requestMeta, { marginTop: theme.spacing.xs }]}>
                        <Text variant="caption" tone="muted">
                          #{request.id}
                        </Text>
                        <Text variant="caption" tone="muted">
                          Ref {request.transactionRef}
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

          <Card padded style={{ marginTop: theme.spacing.lg }}>
            <View style={styles.noticeRow}>
              <Ionicons name="time-outline" size={16} color={theme.colors.info} />
              <Text variant="caption" tone="secondary" style={styles.flex}>
                Manual payments are checked by our team, usually within a few hours. Coins are added
                to your wallet as soon as the payment is approved.
              </Text>
            </View>
          </Card>
        </ScrollView>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
            {/* Currency + amount calculator */}
            <SectionHeader title="Choose amount" />
            <Card padded style={{ gap: theme.spacing.sm }}>
              <View>
                <Text variant="caption" tone="muted" style={{ marginBottom: theme.spacing.xs }}>
                  Currency
                </Text>
                <View style={{ marginHorizontal: -theme.spacing.md }}>
                  <ChipRow
                    items={currencyRates
                      .filter((r) => r.enabled)
                      .map((r) => ({ id: r.code, label: `${r.code}` }))}
                    selectedId={currency}
                    onSelect={(code) => {
                      setCurrency(code);
                      setPackageId(null);
                      setMethodId(null);
                    }}
                    contentPadding={theme.spacing.md}
                  />
                </View>
              </View>

              <View>
                <Text variant="caption" tone="muted" style={{ marginBottom: theme.spacing.xs }}>
                  Amount in {rate.label}
                </Text>
                <View
                  style={[
                    styles.amountInput,
                    {
                      backgroundColor: theme.colors.surfaceAlt,
                      borderRadius: theme.radius.md,
                      borderColor: belowMinimum ? theme.colors.danger : 'transparent',
                    },
                  ]}
                >
                  <Text variant="h3" tone="muted">
                    {rate.symbol}
                  </Text>
                  <TextInput
                    value={amount}
                    onChangeText={(value) => {
                      setAmount(value);
                      setPackageId(null);
                    }}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={theme.colors.textMuted}
                    style={[theme.typography.h2, { color: theme.colors.text, flex: 1 }]}
                  />
                  <Text variant="label" tone="muted">
                    {rate.code}
                  </Text>
                </View>
                {belowMinimum ? (
                  <Text variant="caption" tone="danger" style={{ marginTop: 4 }}>
                    Minimum is {rate.symbol}
                    {rate.minAmount.toLocaleString()} {rate.code}
                  </Text>
                ) : null}
              </View>

              {/* Live conversion */}
              <View
                style={[
                  styles.conversion,
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
                      {formatCount(coinsToBuy)}
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
                    1 {rate.code} = {rate.coinsPerUnit} coins
                  </Text>
                </View>
              </View>
            </Card>

            {/* Packages */}
            <SectionHeader title="Or pick a package" />
            <View style={[styles.packages, { paddingHorizontal: theme.spacing.md }]}>
              {coinPackages.map((pack) => {
                const active = packageId === pack.id;
                const total = pack.coins + pack.bonusCoins;
                const price = Math.round(total / rate.coinsPerUnit);
                return (
                  <Pressable
                    key={pack.id}
                    onPress={() => {
                      setPackageId(pack.id);
                      setAmount(String(price));
                    }}
                    style={[
                      styles.package,
                      {
                        backgroundColor: active ? theme.colors.brandSoft : theme.colors.surface,
                        borderColor: active ? theme.colors.brand : 'transparent',
                        borderRadius: theme.radius.lg,
                      },
                    ]}
                  >
                    {pack.isPopular ? (
                      <Badge label="Popular" tone="brand" size="sm" style={styles.packBadge} />
                    ) : pack.discountPercent ? (
                      <Badge label={`-${pack.discountPercent}%`} tone="success" size="sm" style={styles.packBadge} />
                    ) : null}

                    <Ionicons name="logo-bitcoin" size={22} color={theme.colors.gold} />
                    <Text variant="bodyStrong" style={{ marginTop: 2 }}>
                      {formatCount(total)}
                    </Text>
                    {pack.bonusCoins > 0 ? (
                      <Text variant="caption" tone="success">
                        +{formatCount(pack.bonusCoins)} bonus
                      </Text>
                    ) : (
                      <Text variant="caption" tone="muted">
                        coins
                      </Text>
                    )}
                    <Text variant="label" style={{ marginTop: 4 }}>
                      {rate.symbol}
                      {price.toLocaleString()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Payment method */}
            <SectionHeader title="Payment method" />
            {availableMethods.length === 0 ? (
              <Card padded>
                <Text variant="label" tone="muted">
                  No payment method accepts {rate.code} yet. Pick another currency.
                </Text>
              </Card>
            ) : (
              <Card>
                {availableMethods.map((item, index) => (
                  <View key={item.id}>
                    {index > 0 ? <Divider inset={60} /> : null}
                    <ListRow
                      label={item.label}
                      description={item.manual ? 'Manual — needs payment proof' : 'Instant confirmation'}
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
            )}

            <Card padded style={{ marginTop: theme.spacing.lg }}>
              <View style={styles.noticeRow}>
                <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.success} />
                <Text variant="caption" tone="secondary" style={styles.flex}>
                  Purchased coins are spendable on video promotion and live gifting. They are not
                  withdrawable and cannot be converted back to money.
                </Text>
              </View>
            </Card>
          </ScrollView>

          {/* Footer */}
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
                {formatCount(coinsToBuy)} coins
              </Text>
              <Text variant="h3">
                {rate.symbol}
                {payAmount.toLocaleString()} {rate.code}
              </Text>
            </View>
            <Button
              label="Continue"
              variant="gradient"
              size="lg"
              disabled={!canContinue}
              onPress={() => setStep('pay')}
            />
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Payment instructions + proof */}
      <Sheet
        visible={step === 'pay'}
        onClose={reset}
        title={method ? `Pay with ${method.label}` : 'Payment'}
        subtitle={`${formatCount(coinsToBuy)} coins · ${rate.symbol}${payAmount.toLocaleString()} ${rate.code}`}
        height={0.86}
        showClose
      >
        {method ? (
          <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: theme.spacing.xxl }}>
            {/* Account to pay */}
            {method.manual ? (
              <View
                style={[
                  styles.payBox,
                  { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg },
                ]}
              >
                <Text variant="caption" tone="muted">
                  {method.kind === 'usdt' ? 'Wallet address' : 'Send payment to'}
                </Text>
                <Text variant="bodyStrong" style={{ marginTop: 2 }} selectable>
                  {method.accountNumber}
                </Text>
                {method.accountName ? (
                  <Text variant="caption" tone="secondary">
                    {method.accountName}
                  </Text>
                ) : null}

                <View style={[styles.amountDue, { borderTopColor: theme.colors.border }]}>
                  <Text variant="label" tone="secondary" style={styles.flex}>
                    Exact amount
                  </Text>
                  <Text variant="bodyStrong" tone="brand">
                    {rate.symbol}
                    {payAmount.toLocaleString()} {rate.code}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Steps */}
            <Text variant="labelStrong" tone="muted" style={{ marginTop: theme.spacing.lg }}>
              INSTRUCTIONS
            </Text>
            <View style={{ marginTop: theme.spacing.xs, gap: theme.spacing.sm }}>
              {method.instructions.map((instruction, index) => (
                <View key={instruction} style={styles.stepRow}>
                  <View style={[styles.stepNumber, { backgroundColor: theme.colors.brandSoft }]}>
                    <Text variant="caption" tone="brand">
                      {index + 1}
                    </Text>
                  </View>
                  <Text variant="label" tone="secondary" style={styles.flex}>
                    {instruction}
                  </Text>
                </View>
              ))}
            </View>

            {method.manual ? (
              <>
                {/* Proof */}
                <Text variant="labelStrong" tone="muted" style={{ marginTop: theme.spacing.lg }}>
                  CONFIRM YOUR PAYMENT
                </Text>

                <View style={{ marginTop: theme.spacing.xs, gap: theme.spacing.sm }}>
                  <View>
                    <Text variant="caption" tone="muted" style={{ marginBottom: theme.spacing.xs }}>
                      {method.kind === 'usdt' ? 'Transaction hash' : 'Transaction ID / reference'}
                    </Text>
                    <TextInput
                      value={txRef}
                      onChangeText={setTxRef}
                      placeholder={method.kind === 'usdt' ? '0x…' : 'e.g. EP8842190231'}
                      placeholderTextColor={theme.colors.textMuted}
                      autoCapitalize="characters"
                      style={[
                        theme.typography.body,
                        styles.input,
                        {
                          color: theme.colors.text,
                          backgroundColor: theme.colors.surface,
                          borderRadius: theme.radius.md,
                        },
                      ]}
                    />
                  </View>

                  <Pressable
                    onPress={() => setProof((p) => !p)}
                    style={[
                      styles.upload,
                      {
                        borderColor: proof ? theme.colors.success : theme.colors.borderStrong,
                        borderRadius: theme.radius.md,
                      },
                    ]}
                  >
                    <Ionicons
                      name={proof ? 'checkmark-circle' : 'cloud-upload-outline'}
                      size={22}
                      color={proof ? theme.colors.success : theme.colors.textMuted}
                    />
                    <Text variant="label" tone={proof ? 'success' : 'secondary'}>
                      {proof ? 'Screenshot attached' : 'Attach payment screenshot'}
                    </Text>
                    <Text variant="caption" tone="muted">
                      PNG or JPG, under 5 MB
                    </Text>
                  </Pressable>
                </View>

                <Button
                  label="Submit for approval"
                  variant="gradient"
                  size="lg"
                  fullWidth
                  disabled={!txRef.trim() || !proof}
                  onPress={submit}
                  style={{ marginTop: theme.spacing.lg }}
                />

                <View style={[styles.noticeRow, { marginTop: theme.spacing.md }]}>
                  <Ionicons name="information-circle-outline" size={14} color={theme.colors.textMuted} />
                  <Text variant="caption" tone="muted" style={styles.flex}>
                    Coins are added once our team confirms the payment. You can track the status
                    under Requests.
                  </Text>
                </View>
              </>
            ) : (
              <Button
                label={`Pay ${rate.symbol}${payAmount.toLocaleString()}`}
                variant="gradient"
                size="lg"
                fullWidth
                onPress={submit}
                style={{ marginTop: theme.spacing.lg }}
              />
            )}
          </ScrollView>
        ) : null}
      </Sheet>

      {/* Submitted confirmation */}
      <Sheet visible={step === 'done'} onClose={reset} height={0.45} showClose title="Request submitted">
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
            We got your payment
          </Text>
          <Text variant="label" tone="secondary" align="center" style={{ marginTop: theme.spacing.xs }}>
            {formatCount(coinsToBuy)} coins will be added once the payment is approved. This
            usually takes a few hours.
          </Text>

          <Button
            label="Track request"
            variant="gradient"
            fullWidth
            style={{ marginTop: theme.spacing.lg }}
            onPress={() => {
              reset();
              setTab('requests');
            }}
          />
          <Button
            label="Back to wallet"
            variant="secondary"
            fullWidth
            style={{ marginTop: theme.spacing.xs }}
            onPress={() => {
              reset();
              navigation.navigate('Wallet');
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  amountInput: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 56, borderWidth: 1.5 },
  conversion: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rateBox: { alignItems: 'flex-end' },
  packages: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  package: { width: '31.5%', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6, borderWidth: 1.5 },
  packBadge: { position: 'absolute', top: -8, alignSelf: 'center' },
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
  requestTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  requestMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  noteBox: { padding: 8, marginTop: 8 },
  payBox: { padding: 14 },
  amountDue: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNumber: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  input: { height: 48, paddingHorizontal: 14 },
  upload: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', gap: 4, paddingVertical: 20 },
  noticeRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  doneIcon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
});
