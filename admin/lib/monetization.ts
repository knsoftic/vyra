/**
 * Monetization admin data.
 *
 * These are the operator-side counterparts to the user monetization system:
 * approval queues for money moving in (coin purchases) and out (withdrawals),
 * plus the configuration the app reads for criteria, tasks and rates.
 *
 * Shapes mirror the Phase 11 admin API.
 */

const avatar = (n: number) => `https://i.pravatar.cc/80?img=${n}`;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/* ───────────────────── Coin purchase approval queue ───────────────────── */

export type CoinRequestStatus = 'pending' | 'under_review' | 'approved' | 'rejected';

export interface CoinRequest {
  id: string;
  user: string;
  avatar: string;
  coins: number;
  amount: number;
  currency: string;
  method: string;
  methodKind: 'easypaisa' | 'jazzcash' | 'bank' | 'usdt' | 'card';
  txRef: string;
  proof: boolean;
  status: CoinRequestStatus;
  submittedAt: string;
  note?: string;
  /** Signals that help the reviewer decide. */
  flags: string[];
  userPurchases: number;
  accountAgeDays: number;
}

export const coinRequests: CoinRequest[] = [
  {
    id: 'CP-88251',
    user: 'ravi.builds',
    avatar: avatar(59),
    coins: 2000,
    amount: 5720,
    currency: 'PKR',
    method: 'JazzCash',
    methodKind: 'jazzcash',
    txRef: 'JC7719002',
    proof: false,
    status: 'pending',
    submittedAt: minutesAgo(35),
    flags: ['No screenshot attached'],
    userPurchases: 0,
    accountAgeDays: 35,
  },
  {
    id: 'CP-88240',
    user: 'pixelforge',
    avatar: avatar(15),
    coins: 500,
    amount: 5,
    currency: 'USD',
    method: 'USDT (TRC-20)',
    methodKind: 'usdt',
    txRef: '0x9f2a…c41e',
    proof: true,
    status: 'under_review',
    submittedAt: hoursAgo(4),
    flags: ['Chain confirmation pending'],
    userPurchases: 2,
    accountAgeDays: 88,
  },
  {
    id: 'CP-88248',
    user: 'kofi.eats',
    avatar: avatar(52),
    coins: 1000,
    amount: 2860,
    currency: 'PKR',
    method: 'EasyPaisa',
    methodKind: 'easypaisa',
    txRef: 'EP8842190231',
    proof: true,
    status: 'pending',
    submittedAt: hoursAgo(1),
    flags: [],
    userPurchases: 6,
    accountAgeDays: 430,
  },
  {
    id: 'CP-88252',
    user: 'spam.account.7741',
    avatar: avatar(70),
    coins: 10000,
    amount: 28600,
    currency: 'PKR',
    method: 'Bank Transfer',
    methodKind: 'bank',
    txRef: 'TRX-0001',
    proof: true,
    status: 'pending',
    submittedAt: minutesAgo(12),
    flags: ['Account 12 days old', 'Amount 10x their average', 'Account has 42 reports'],
    userPurchases: 0,
    accountAgeDays: 12,
  },
  {
    id: 'CP-88214',
    user: 'maya.codes',
    avatar: avatar(5),
    coins: 1000,
    amount: 2860,
    currency: 'PKR',
    method: 'EasyPaisa',
    methodKind: 'easypaisa',
    txRef: 'EP8842190231',
    proof: true,
    status: 'approved',
    submittedAt: daysAgo(2),
    flags: [],
    userPurchases: 14,
    accountAgeDays: 920,
  },
  {
    id: 'CP-88190',
    user: 'nova.fitness',
    avatar: avatar(45),
    coins: 500,
    amount: 1430,
    currency: 'PKR',
    method: 'Bank Transfer',
    methodKind: 'bank',
    txRef: 'TRX-2291',
    proof: true,
    status: 'rejected',
    submittedAt: daysAgo(6),
    note: 'Screenshot did not match the amount sent.',
    flags: [],
    userPurchases: 1,
    accountAgeDays: 210,
  },
];

/* ────────────────────── Withdrawal approval queue ─────────────────────── */

export type WithdrawalStatus = 'pending' | 'under_review' | 'approved' | 'paid' | 'rejected';

export interface WithdrawalRequest {
  id: string;
  user: string;
  avatar: string;
  amount: number;
  currency: string;
  fee: number;
  net: number;
  method: string;
  destination: string;
  status: WithdrawalStatus;
  requestedAt: string;
  settledAt?: string;
  note?: string;
  /** Compliance context the reviewer needs. */
  verified: boolean;
  liveGiftBalance: number;
  previousPayouts: number;
  flags: string[];
}

export const withdrawalQueue: WithdrawalRequest[] = [
  {
    id: 'WD-4412',
    user: 'alex.rivera',
    avatar: avatar(12),
    amount: 120,
    currency: 'USD',
    fee: 1.2,
    net: 118.8,
    method: 'USDT (TRC-20)',
    destination: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
    status: 'under_review',
    requestedAt: hoursAgo(20),
    verified: true,
    liveGiftBalance: 684,
    previousPayouts: 3,
    flags: [],
  },
  {
    id: 'WD-4420',
    user: 'driftlab',
    avatar: avatar(33),
    amount: 1800,
    currency: 'USD',
    fee: 18,
    net: 1782,
    method: 'USDT (TRC-20)',
    destination: 'TWd8Y…9xQa',
    status: 'pending',
    requestedAt: hoursAgo(3),
    verified: true,
    liveGiftBalance: 2480,
    previousPayouts: 11,
    flags: ['Large amount — needs finance sign-off'],
  },
  {
    id: 'WD-4421',
    user: 'echo.music',
    avatar: avatar(20),
    amount: 240,
    currency: 'USD',
    fee: 4.8,
    net: 235.2,
    method: 'Bank transfer (USD)',
    destination: 'PK36 SCBL •••• 6702',
    status: 'pending',
    requestedAt: hoursAgo(6),
    verified: true,
    liveGiftBalance: 412,
    previousPayouts: 2,
    flags: ['Account frozen — review before paying'],
  },
  {
    id: 'WD-4419',
    user: 'sana.travels',
    avatar: avatar(26),
    amount: 60,
    currency: 'USD',
    fee: 0.9,
    net: 59.1,
    method: 'EasyPaisa',
    destination: '0300-1234567',
    status: 'pending',
    requestedAt: hoursAgo(9),
    verified: true,
    liveGiftBalance: 148,
    previousPayouts: 5,
    flags: [],
  },
  {
    id: 'WD-4380',
    user: 'alex.rivera',
    avatar: avatar(12),
    amount: 250,
    currency: 'USD',
    fee: 2.5,
    net: 247.5,
    method: 'USDT (TRC-20)',
    destination: 'TQn9Y…bLSE',
    status: 'paid',
    requestedAt: daysAgo(12),
    settledAt: daysAgo(10),
    verified: true,
    liveGiftBalance: 684,
    previousPayouts: 3,
    flags: [],
  },
  {
    id: 'WD-4302',
    user: 'nova.fitness',
    avatar: avatar(45),
    amount: 80,
    currency: 'USD',
    fee: 1.2,
    net: 78.8,
    method: 'EasyPaisa',
    destination: '0300-9988776',
    status: 'rejected',
    requestedAt: daysAgo(24),
    settledAt: daysAgo(22),
    note: 'Account name did not match the verified profile name.',
    verified: false,
    liveGiftBalance: 92,
    previousPayouts: 0,
    flags: [],
  },
];

/* ────────────────────── Monetization configuration ────────────────────── */

export interface CriterionConfig {
  id: string;
  label: string;
  metric: string;
  required: number;
  unit?: string;
  enabled: boolean;
  isBoolean?: boolean;
}

export const criteriaConfig: CriterionConfig[] = [
  { id: 'followers', label: 'Followers', metric: 'followers', required: 1000, enabled: true },
  { id: 'views', label: 'Total views', metric: 'views', required: 10000, enabled: true },
  { id: 'likes', label: 'Total likes', metric: 'likes', required: 100, enabled: true },
  { id: 'videos', label: 'Videos uploaded', metric: 'videos', required: 50, enabled: true },
  { id: 'watch_time', label: 'Watch time', metric: 'watch_hours', required: 4000, unit: 'hours', enabled: true },
  { id: 'account_age', label: 'Account age', metric: 'account_age_days', required: 30, unit: 'days', enabled: true },
  { id: 'referrals', label: 'Referrals', metric: 'referrals', required: 10, enabled: true },
  { id: 'verified', label: 'Account verified', metric: 'verification', required: 1, enabled: true, isBoolean: true },
];

export interface Applicant {
  id: string;
  user: string;
  avatar: string;
  progress: number;
  met: number;
  total: number;
  state: 'locked' | 'eligible' | 'enabled' | 'review' | 'suspended';
  followers: number;
  appliedAt?: string;
}

export const monetizationApplicants: Applicant[] = [
  { id: 'm_1', user: 'kofi.eats', avatar: avatar(52), progress: 88, met: 7, total: 8, state: 'review', followers: 67400, appliedAt: hoursAgo(5) },
  { id: 'm_2', user: 'pixelforge', avatar: avatar(15), progress: 50, met: 4, total: 8, state: 'locked', followers: 12800 },
  { id: 'm_3', user: 'alex.rivera', avatar: avatar(12), progress: 68, met: 4, total: 8, state: 'locked', followers: 128400 },
  { id: 'm_4', user: 'maya.codes', avatar: avatar(5), progress: 100, met: 8, total: 8, state: 'enabled', followers: 892300, appliedAt: daysAgo(40) },
  { id: 'm_5', user: 'driftlab', avatar: avatar(33), progress: 100, met: 8, total: 8, state: 'enabled', followers: 2340000, appliedAt: daysAgo(120) },
  { id: 'm_6', user: 'sana.travels', avatar: avatar(26), progress: 100, met: 8, total: 8, state: 'enabled', followers: 1120000, appliedAt: daysAgo(90) },
  { id: 'm_7', user: 'theo.finance', avatar: avatar(68), progress: 100, met: 8, total: 8, state: 'suspended', followers: 534000, appliedAt: daysAgo(200) },
];

/* ─────────────────────────── Daily task config ────────────────────────── */

export interface TaskConfig {
  id: string;
  title: string;
  metric: string;
  target: number;
  reward: number;
  rewardLabel: string;
  enabled: boolean;
  /** How many users completed it in the last 24h. */
  completions: number;
  /** Coins paid out in the last 24h. */
  payout: number;
}

export const taskConfigs: TaskConfig[] = [
  { id: 't_likes', title: 'Get 100 likes', metric: 'likes', target: 100, reward: 200, rewardLabel: '$2.00', enabled: true, completions: 18420, payout: 3684000 },
  { id: 't_views', title: 'Get 1,000 qualified views', metric: 'views', target: 1000, reward: 500, rewardLabel: '$5.00', enabled: true, completions: 9840, payout: 4920000 },
  { id: 't_followers', title: 'Gain 50 followers', metric: 'followers', target: 50, reward: 300, rewardLabel: '$3.00', enabled: true, completions: 4210, payout: 1263000 },
  { id: 't_referrals', title: 'Refer 5 new users', metric: 'referrals', target: 5, reward: 500, rewardLabel: '$5.00', enabled: true, completions: 1240, payout: 620000 },
  { id: 't_upload', title: 'Upload 3 videos', metric: 'uploads', target: 3, reward: 150, rewardLabel: '$1.50', enabled: true, completions: 24800, payout: 3720000 },
  { id: 't_watch', title: 'Watch 60 minutes', metric: 'watch_minutes', target: 60, reward: 100, rewardLabel: '$1.00', enabled: true, completions: 42100, payout: 4210000 },
  { id: 't_share', title: 'Share 10 videos', metric: 'shares', target: 10, reward: 80, rewardLabel: '$0.80', enabled: false, completions: 0, payout: 0 },
];

export const referralConfig = {
  rewardPerReferral: 100,
  dailyTarget: 5,
  qualificationRule: 'Install + 2 minutes watch time',
  enabled: true,
  todayReferrals: 8420,
  todayPayout: 842000,
  fraudBlocked: 214,
};

/* ──────────────────── Currency rates and payment methods ──────────────── */

export interface RateConfig {
  code: string;
  label: string;
  symbol: string;
  coinsPerUnit: number;
  minAmount: number;
  enabled: boolean;
  volume30d: number;
}

export const rateConfigs: RateConfig[] = [
  { code: 'USD', label: 'US Dollar', symbol: '$', coinsPerUnit: 100, minAmount: 1, enabled: true, volume30d: 84200 },
  { code: 'PKR', label: 'Pakistani Rupee', symbol: 'Rs', coinsPerUnit: 0.35, minAmount: 300, enabled: true, volume30d: 12400000 },
  { code: 'INR', label: 'Indian Rupee', symbol: '₹', coinsPerUnit: 0.4, minAmount: 250, enabled: true, volume30d: 3800000 },
  { code: 'USDT', label: 'Tether', symbol: '₮', coinsPerUnit: 100, minAmount: 1, enabled: true, volume30d: 42100 },
  { code: 'AED', label: 'UAE Dirham', symbol: 'د.إ', coinsPerUnit: 27, minAmount: 5, enabled: true, volume30d: 184000 },
  { code: 'GBP', label: 'British Pound', symbol: '£', coinsPerUnit: 126, minAmount: 1, enabled: false, volume30d: 0 },
];

export interface MethodConfig {
  id: string;
  label: string;
  kind: 'easypaisa' | 'jazzcash' | 'bank' | 'usdt' | 'card';
  accountName: string;
  accountNumber: string;
  currencies: string[];
  manual: boolean;
  enabled: boolean;
  volume30d: number;
  pendingCount: number;
}

export const methodConfigs: MethodConfig[] = [
  { id: 'pm_easypaisa', label: 'EasyPaisa', kind: 'easypaisa', accountName: 'Vyra Technologies', accountNumber: '0300-1234567', currencies: ['PKR'], manual: true, enabled: true, volume30d: 6200000, pendingCount: 1 },
  { id: 'pm_jazzcash', label: 'JazzCash', kind: 'jazzcash', accountName: 'Vyra Technologies', accountNumber: '0301-7654321', currencies: ['PKR'], manual: true, enabled: true, volume30d: 4100000, pendingCount: 1 },
  { id: 'pm_bank', label: 'Bank Transfer', kind: 'bank', accountName: 'Vyra Technologies Pvt Ltd', accountNumber: 'PK36 SCBL 0000 0011 2345 6702', currencies: ['PKR', 'USD', 'AED'], manual: true, enabled: true, volume30d: 2100000, pendingCount: 1 },
  { id: 'pm_usdt', label: 'USDT (TRC-20)', kind: 'usdt', accountName: 'Vyra Technologies', accountNumber: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', currencies: ['USDT'], manual: true, enabled: true, volume30d: 42100, pendingCount: 1 },
  { id: 'pm_card', label: 'Card payment', kind: 'card', accountName: '', accountNumber: '', currencies: ['USD', 'AED', 'GBP'], manual: false, enabled: true, volume30d: 128000, pendingCount: 0 },
];

export interface PayoutMethodConfig {
  id: string;
  label: string;
  minAmount: number;
  feePercent: number;
  processingTime: string;
  enabled: boolean;
  volume30d: number;
}

export const payoutMethodConfigs: PayoutMethodConfig[] = [
  { id: 'wm_usdt', label: 'USDT (TRC-20)', minAmount: 20, feePercent: 1, processingTime: '1–2 business days', enabled: true, volume30d: 42800 },
  { id: 'wm_bank', label: 'Bank transfer (USD)', minAmount: 50, feePercent: 2, processingTime: '3–5 business days', enabled: true, volume30d: 18400 },
  { id: 'wm_easypaisa', label: 'EasyPaisa', minAmount: 20, feePercent: 1.5, processingTime: '1 business day', enabled: true, volume30d: 9200 },
];

/* ─────────────────────── Global monetization settings ─────────────────── */

export const monetizationSettings = {
  rewardToCoinRate: 1,
  giftCoinsPerUsd: 100,
  creatorGiftShare: 50,
  withdrawalEnabled: true,
  minWithdrawal: 20,
  withdrawalCurrency: 'USD',
  clearingDays: 7,
  dailyRewardCap: 2000,
  tasksEnabled: true,
  autoApproveUnder: 0,
};

/* ──────────────────────────── Summary metrics ─────────────────────────── */

export const monetizationStats = {
  pendingCoinRequests: coinRequests.filter((r) => r.status === 'pending' || r.status === 'under_review').length,
  pendingWithdrawals: withdrawalQueue.filter((w) => w.status === 'pending' || w.status === 'under_review').length,
  pendingWithdrawalValue: withdrawalQueue
    .filter((w) => w.status === 'pending' || w.status === 'under_review')
    .reduce((sum, w) => sum + w.amount, 0),
  monetizedCreators: monetizationApplicants.filter((a) => a.state === 'enabled').length,
  awaitingReview: monetizationApplicants.filter((a) => a.state === 'review').length,
  rewardPayout24h: taskConfigs.reduce((sum, t) => sum + t.payout, 0),
  coinRevenue30d: 184920,
  paidOut30d: 70400,
};
