/**
 * Money contract.
 *
 * ADR-018 — four balances that never merge:
 *
 *   coin        purchased or converted. Spendable on promotion and gifts. Not payable.
 *   reward      earned from tasks and referrals. Converts one-way into coins. Not payable.
 *   live_gift   gift coins received while live. The only source that can become payable.
 *   withdrawable  the cleared portion of live_gift, denominated in real currency.
 *
 * The types below make the rule structural: `WalletKind` is required on every
 * ledger entry, and only `WithdrawableBalance` is expressed in currency.
 */

import type { Page } from './http.ts';

export type WalletKind = 'coin' | 'reward' | 'live_gift' | 'withdrawable';

/** The only wallet that can fund a withdrawal. Referenced by the payout service. */
export const PAYABLE_WALLET: WalletKind = 'withdrawable';

/** Conversions the platform permits. Anything not listed here is rejected. */
export const ALLOWED_CONVERSIONS: ReadonlyArray<{ from: WalletKind; to: WalletKind }> = [
  { from: 'reward', to: 'coin' },
  { from: 'live_gift', to: 'withdrawable' },
];

export interface WalletBalances {
  /** Whole coins. */
  coin: number;
  reward: number;
  liveGift: number;
  /** Currency, two decimals, in `payoutCurrency`. */
  withdrawable: number;
  payoutCurrency: string;
  /**
   * What one coin is worth in `payoutCurrency`.
   *
   * Sent with the balances so a client showing "≈ $x" beside a coin figure uses
   * the rate the server would actually pay at. Without it the estimate is a
   * constant compiled into the app, which drifts the moment an operator changes
   * the rate — and a stale estimate beside a live balance is worse than none.
   */
  coinToPayoutRate: number;
  pendingReward: number;
  pendingWithdrawal: number;
  totalEarned: number;
  isFrozen: boolean;
  frozenReason?: string;
}

export type TransactionType =
  | 'purchase'
  | 'gift_sent'
  | 'gift_received'
  | 'promotion'
  | 'ad_spend'
  | 'refund'
  | 'admin_credit'
  | 'admin_debit'
  | 'task_reward'
  | 'referral_reward'
  | 'milestone_reward'
  | 'reward_to_coins'
  | 'withdrawal_request'
  | 'withdrawal_paid'
  | 'withdrawal_rejected'
  | 'reversal'
  | 'clearing';

export type TransactionStatus =
  | 'successful'
  | 'pending'
  | 'failed'
  | 'refunded'
  | 'under_review'
  | 'approved'
  | 'rejected';

/** One immutable ledger row as the client sees it. */
export interface LedgerEntry {
  id: string;
  wallet: WalletKind;
  type: TransactionType;
  description: string;
  /** Signed. Coins for coin/reward/live_gift; currency for withdrawable. */
  amount: number;
  balanceAfter: number;
  status: TransactionStatus;
  reference?: string;
  fiatAmount?: number;
  fiatCurrency?: string;
  counterparty?: { id: string; username: string; displayName: string; avatar?: string };
  createdAt: string;
}

export interface LedgerQuery {
  wallet?: WalletKind;
  type?: TransactionType;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

// ── Coin pricing ──

export interface CurrencyRate {
  code: string;
  label: string;
  symbol: string;
  /** How many coins one unit of this currency buys. Admin-configurable (ADR-015). */
  coinsPerUnit: number;
  minAmount: number;
  isEnabled: boolean;
}

export interface CoinPackage {
  id: string;
  coins: number;
  bonusCoins: number;
  basePrice: number;
  baseCurrency: string;
  discountPercent: number;
  isPopular: boolean;
}

/** The calculator the buy-coins screen renders. Server-computed so the client cannot drift. */
export interface CoinQuote {
  currency: string;
  amount: number;
  coins: number;
  bonusCoins: number;
  totalCoins: number;
  rateUsed: number;
  /** Quotes are short-lived; a purchase created after this must re-quote. */
  expiresAt: string;
}

export type PaymentMethodKind = 'easypaisa' | 'jazzcash' | 'bank' | 'usdt' | 'card';

export interface PaymentMethod {
  id: string;
  slug: string;
  label: string;
  kind: PaymentMethodKind;
  accountName?: string;
  accountNumber?: string;
  currencies: string[];
  instructions: string[];
  /** Manual methods need proof and admin approval; gateways settle automatically. */
  isManual: boolean;
}

export type PurchaseStatus = 'pending' | 'under_review' | 'approved' | 'rejected';

export interface CoinPurchaseRequest {
  id: string;
  methodId: string;
  methodLabel: string;
  coins: number;
  fiatAmount: number;
  fiatCurrency: string;
  transactionRef?: string;
  proofUrl?: string;
  status: PurchaseStatus;
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface CreateCoinPurchaseBody {
  methodId: string;
  currency: string;
  amount: number;
  transactionRef?: string;
  /** Storage key returned by the upload endpoint, not the file itself. */
  proofKey?: string;
}

// ── Gifts ──

export interface Gift {
  id: string;
  slug: string;
  name: string;
  icon: string;
  animationUrl?: string;
  coins: number;
  isFeatured: boolean;
}

export interface SendGiftBody {
  giftId: string;
  recipientId: string;
  streamId?: string;
  quantity: number;
}

export interface SendGiftResult {
  transactionId: string;
  coinsSpent: number;
  /** What the creator actually receives after the platform share. */
  coinsToCreator: number;
  balances: WalletBalances;
}

export interface LiveGiftEarning {
  id: string;
  streamTitle: string;
  giftName: string;
  giftIcon: string;
  senderUsername: string;
  coins: number;
  /** Gift earnings mature before becoming withdrawable. */
  clearsAt?: string;
  cleared: boolean;
  createdAt: string;
}

// ── Withdrawals ──

export type WithdrawalStatus = 'pending' | 'under_review' | 'approved' | 'paid' | 'rejected';

export interface WithdrawalMethod {
  id: string;
  slug: string;
  label: string;
  kind: 'usdt' | 'bank' | 'easypaisa' | 'jazzcash';
  /** What to call the destination field in the UI, e.g. "USDT (TRC-20) address". */
  fieldLabel: string;
  network?: string;
  minAmount: number;
  feePercent: number;
  processingTime: string;
  isEnabled: boolean;
}

export interface WithdrawalRequest {
  id: string;
  methodId: string;
  methodLabel: string;
  amount: number;
  fee: number;
  netAmount: number;
  currency: string;
  /** Masked for display — the server never returns the full destination back. */
  destinationMasked: string;
  status: WithdrawalStatus;
  decisionNote?: string;
  payoutRef?: string;
  createdAt: string;
  settledAt?: string;
}

export interface CreateWithdrawalBody {
  methodId: string;
  amount: number;
  destination: string;
}

/** Converting reward coins into spendable coins. One-way, per ALLOWED_CONVERSIONS. */
export interface ConvertRewardBody {
  amount: number;
}

export interface ConvertRewardResult {
  converted: number;
  coinsCredited: number;
  balances: WalletBalances;
}

export type WalletSummary = {
  balances: WalletBalances;
  recentEntries: LedgerEntry[];
};

export type LedgerPage = Page<LedgerEntry>;
