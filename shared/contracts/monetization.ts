/**
 * Monetization contract — eligibility, daily tasks, referrals.
 *
 * Every threshold, reward value and rate here is server-supplied and
 * admin-configurable (ADR-015). The client renders whatever the server sends and
 * hard-codes none of it: changing "1,000 followers" to "800" is an admin edit,
 * not an app release.
 */

import type { WalletKind } from './money.ts';

export type MonetizationState = 'locked' | 'eligible' | 'review' | 'enabled' | 'suspended';

export interface MonetizationCriterion {
  key: string;
  label: string;
  /** Progress as "current / required", e.g. 750 / 1000 followers. */
  current: number;
  required: number;
  unit?: string;
  met: boolean;
  /** Yes/no criteria (e.g. "no active strikes") render as a check, not a bar. */
  isBoolean: boolean;
}

export interface MonetizationStatus {
  state: MonetizationState;
  /** 0–100, computed server-side across all enabled criteria. */
  progress: number;
  criteria: MonetizationCriterion[];
  criteriaMet: number;
  criteriaTotal: number;
  /** True only when every criterion is met and the user has not yet applied. */
  canApply: boolean;
  appliedAt?: string;
  enabledAt?: string;
  reviewNote?: string;
}

export type TaskState = 'active' | 'completed' | 'claimed' | 'expired';

export interface DailyTask {
  id: string;
  key: string;
  title: string;
  description: string;
  icon?: string;
  progress: number;
  target: number;
  state: TaskState;
  /** Credited to the reward wallet — never directly withdrawable (ADR-018). */
  rewardCoins: number;
  /** Optional display hint, e.g. "$2 equivalent". Server-formatted. */
  rewardLabel?: string;
  wallet: WalletKind;
}

export interface DailyTasksResponse {
  tasks: DailyTask[];
  /** Server time the current task day rolls over, so the client can show a countdown. */
  resetsAt: string;
  claimedToday: number;
  earnedToday: number;
}

export interface ClaimTaskResult {
  task: DailyTask;
  rewardCoins: number;
  rewardBalance: number;
}

export interface ReferralStats {
  code: string;
  shareUrl: string;
  totalReferred: number;
  qualifiedReferred: number;
  pendingReferred: number;
  totalEarned: number;
  rewardPerReferral: number;
  /** What the referred user must do before the reward is credited. */
  qualificationRule: string;
  dailyTarget?: number;
  dailyProgress?: number;
}

export interface ReferralEntry {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  qualified: boolean;
  rewardCoins: number;
  joinedAt: string;
}

/**
 * The single config payload the app fetches at launch and caches. Everything the
 * monetization screens need to render correct numbers without a build.
 */
export interface MonetizationConfig {
  enabled: boolean;
  minWithdrawal: number;
  payoutCurrency: string;
  /** e.g. { USD: 100, PKR: 0.35, INR: 0.40 } — coins per one unit of currency. */
  coinsPerCurrencyUnit: Record<string, number>;
  /** How many coins one reward coin converts into. */
  rewardToCoinRate: number;
  /** Coins → payout currency, used to show live gift earnings in money terms. */
  coinToPayoutRate: number;
  /** Platform share of a gift, 0–1. The creator receives the remainder. */
  giftPlatformShare: number;
  /** Days a gift earning is held before it becomes withdrawable. */
  giftClearingDays: number;
  taskResetHourUtc: number;
  referralRewardCoins: number;
  withdrawalsOpen: boolean;
}
