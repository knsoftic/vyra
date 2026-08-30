/**
 * Wallet, coins, withdrawals, tasks and referrals.
 *
 * Every call here that moves value takes an idempotency key as an argument
 * rather than generating one internally. That is deliberate: a key generated
 * inside the call would be new on every retry, which turns the one protection
 * these routes have into decoration. The caller creates it once per intent —
 * one tap on "withdraw" — and passes the same one back if it has to retry.
 */

import { api } from './client';
import type { WalletBalances } from '../../../shared/contracts/money';

export interface CoinPackage {
  id: string;
  coins: number;
  bonusCoins: number;
  totalCoins: number;
  price: number;
  currency: string;
  discountPercent: number;
  isPopular: boolean;
}

export interface PaymentMethodOption {
  id: string;
  slug: string;
  label: string;
  kind: string;
  accountName: string;
  accountNumber: string;
  instructions: string[];
  currencies: string[];
}

export interface PayoutMethodOption {
  id: string;
  slug: string;
  label: string;
  kind: string;
  fieldLabel: string;
  network?: string;
  minAmount: number;
  feePercent: number;
  processingTime: string;
}

export interface PurchaseRequest {
  id: string;
  coins: number;
  fiatAmount: number;
  fiatCurrency: string;
  quotedRate: number;
  method: string;
  transactionRef: string;
  proofUrl?: string;
  status: 'pending' | 'under_review' | 'approved' | 'rejected';
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface WithdrawalRequest {
  id: string;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  method: string;
  /** Masked — the server never echoes a full account number back. */
  destination: string;
  status: 'pending' | 'under_review' | 'approved' | 'paid' | 'rejected';
  decisionNote?: string;
  payoutRef?: string;
  createdAt: string;
  decidedAt?: string;
  settledAt?: string;
}

export interface DailyTask {
  id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  progress: number;
  rewardCoins: number;
  rewardLabel: string;
  state: 'active' | 'completed' | 'claimed' | 'expired';
  claimedAt?: string;
}

export interface ReferralSummary {
  code: string;
  rewardCoins: number;
  qualificationRule: string;
  invited: number;
  qualified: number;
  earned: number;
  recent: { username: string; qualified: boolean; rewardCoins: number; createdAt: string }[];
}

export const money = {
  balances: () => api.get<WalletBalances>('/me/wallet').then((r) => r.data),

  packages: (currency = 'USD') =>
    api.get<CoinPackage[]>(`/coins/packages?currency=${currency}`).then((r) => r.data),

  paymentMethods: () =>
    api.get<PaymentMethodOption[]>('/coins/payment-methods').then((r) => r.data),

  payoutMethods: () => api.get<PayoutMethodOption[]>('/payouts/methods').then((r) => r.data),

  purchases: () => api.get<PurchaseRequest[]>('/me/purchases').then((r) => r.data),

  /** Submits a claim that money was sent. Coins arrive when it is approved. */
  requestPurchase: (
    input: {
      packageId?: string;
      coins?: number;
      methodId: string;
      transactionRef: string;
      proofKey?: string;
      currency?: string;
    },
    idempotencyKey: string,
  ) =>
    api
      .post<PurchaseRequest>('/coins/purchases', input, {
        headers: { 'idempotency-key': idempotencyKey },
      })
      .then((r) => r.data),

  withdrawals: () => api.get<WithdrawalRequest[]>('/me/withdrawals').then((r) => r.data),

  /** The balance is debited when this succeeds, not when the payout lands. */
  requestWithdrawal: (
    input: { methodId: string; amount: number; destination: string },
    idempotencyKey: string,
  ) =>
    api
      .post<WithdrawalRequest>('/withdrawals', input, {
        headers: { 'idempotency-key': idempotencyKey },
      })
      .then((r) => r.data),

  cancelWithdrawal: (id: string) =>
    api.post<WithdrawalRequest>(`/withdrawals/${id}/cancel`).then((r) => r.data),

  tasks: () => api.get<DailyTask[]>('/me/tasks').then((r) => r.data),

  claimTask: (id: string) =>
    api
      .post<{ taskId: string; rewardCoins: number; rewardBalance: number; alreadyClaimed: boolean }>(
        `/me/tasks/${id}/claim`,
      )
      .then((r) => r.data),

  convertReward: (amount: number, idempotencyKey: string) =>
    api
      .post<{ converted: number; coins: number; rewardBalance: number; coinBalance: number }>(
        '/me/rewards/convert',
        { amount },
        { headers: { 'idempotency-key': idempotencyKey } },
      )
      .then((r) => r.data),

  referrals: () => api.get<ReferralSummary>('/me/referrals').then((r) => r.data),

  monetization: () => api.get<MonetizationStatus>('/me/monetization').then((r) => r.data),

  applyForMonetization: () =>
    api.post<MonetizationStatus>('/me/monetization/apply').then((r) => r.data),
};

export type MonetizationState = 'locked' | 'eligible' | 'review' | 'enabled' | 'suspended';

export interface MonetizationCriterion {
  id: string;
  label: string;
  metric: string;
  current: number;
  required: number;
  unit: string | null;
  isBoolean: boolean;
  met: boolean;
  /** False when nothing measures this metric — it blocks rather than passes. */
  measurable: boolean;
}

export interface MonetizationStatus {
  state: MonetizationState;
  progress: number;
  criteriaMet: number;
  criteria: MonetizationCriterion[];
  canApply: boolean;
  appliedAt: string | null;
  enabledAt: string | null;
  reviewNote: string | null;
  unmeasurable: string[];
}

/**
 * A key for one money-moving intent.
 *
 * Call this once when the user commits to the action, and reuse the result for
 * every retry of that same action.
 */
export function moneyKey(prefix = 'money'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
