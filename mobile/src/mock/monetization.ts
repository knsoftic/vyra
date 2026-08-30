import {
  WalletBalances,
  MonetizationStatus,
  DailyTask,
  ReferralStats,
  ReferralEntry,
  PaymentMethod,
  CurrencyRate,
  CoinPurchaseRequest,
  WithdrawalMethod,
  WithdrawalRequest,
  MonetizationConfig,
  Gift,
} from '../types';
import { currentUser, users } from './users';
import { hoursAgo, daysAgo, minutesAgo } from '../utils/format';

/**
 * Monetization mock data.
 *
 * Every threshold, rate and reward here is **configuration**, not a constant —
 * it mirrors what Super Admin will serve so the app always renders the currently
 * active values rather than numbers compiled into the build.
 */

// ────────────────────────── Platform configuration ──────────────────────

export const monetizationConfig: MonetizationConfig = {
  /** 1 reward point converts to this many coins. */
  rewardToCoinRate: 1,
  /** Display rate for gift value. */
  giftCoinsPerUsd: 100,
  withdrawalEnabled: true,
  minWithdrawal: 20,
  withdrawalCurrency: 'USD',
  clearingDays: 7,
};

// ──────────────────────────── Wallet balances ───────────────────────────

/**
 * Four balances, deliberately separate (ADR-018):
 *  - coins        purchased or converted, spendable on promotion and gifting
 *  - reward       earned from tasks/referrals, convertible to coins, never payable
 *  - liveGift     gift coins received while live — the only payable source
 *  - withdrawable the cleared portion of liveGift
 */
export const walletBalances: WalletBalances = {
  coins: 12480,
  reward: 4820,
  liveGift: 68400,
  withdrawable: 512.4,
  pendingReward: 640,
  totalEarned: 9260,
  todayEarned: 310,
  pendingWithdrawal: 120,
};

/** Legacy single-balance export kept so existing screens keep working. */
export const walletBalance = walletBalances.coins;

// ───────────────────────────── Monetization ─────────────────────────────

export const monetizationStatus: MonetizationStatus = {
  state: 'locked',
  progress: 68,
  criteria: [
    { id: 'followers', label: 'Followers', metric: 'followers', current: 750, required: 1000 },
    { id: 'views', label: 'Total views', metric: 'views', current: 8500, required: 10000 },
    { id: 'likes', label: 'Total likes', metric: 'likes', current: 85, required: 100 },
    { id: 'videos', label: 'Videos uploaded', metric: 'videos', current: 87, required: 50 },
    {
      id: 'watch_time',
      label: 'Watch time',
      metric: 'watch_hours',
      current: 3200,
      required: 4000,
      unit: 'hours',
    },
    {
      id: 'account_age',
      label: 'Account age',
      metric: 'account_age_days',
      current: 640,
      required: 30,
      unit: 'days',
    },
    { id: 'referrals', label: 'Referrals', metric: 'referrals', current: 12, required: 10 },
    {
      id: 'verified',
      label: 'Account verified',
      metric: 'verification',
      current: 1,
      required: 1,
      isBoolean: true,
      hint: 'Creator badge approved',
    },
  ],
};

// ───────────────────────────── Daily tasks ──────────────────────────────

const endOfDay = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

export const dailyTasks: DailyTask[] = [
  {
    id: 't_likes',
    title: 'Get 100 likes',
    description: 'Across any videos you posted today',
    icon: 'heart-outline',
    metric: 'likes',
    current: 67,
    target: 100,
    reward: 200,
    rewardKind: 'coins',
    rewardLabel: '$2.00',
    state: 'active',
    expiresAt: endOfDay(),
  },
  {
    id: 't_views',
    title: 'Get 1,000 qualified views',
    description: 'Views counted after 5 seconds of watch time',
    icon: 'play-outline',
    metric: 'views',
    current: 1000,
    target: 1000,
    reward: 500,
    rewardKind: 'coins',
    rewardLabel: '$5.00',
    state: 'completed',
    expiresAt: endOfDay(),
  },
  {
    id: 't_followers',
    title: 'Gain 50 followers',
    description: 'New followers gained today',
    icon: 'person-add-outline',
    metric: 'followers',
    current: 18,
    target: 50,
    reward: 300,
    rewardKind: 'coins',
    rewardLabel: '$3.00',
    state: 'active',
    expiresAt: endOfDay(),
  },
  {
    id: 't_referrals',
    title: 'Refer 5 new users',
    description: 'They must install and watch for 2 minutes',
    icon: 'people-outline',
    metric: 'referrals',
    current: 3,
    target: 5,
    reward: 500,
    rewardKind: 'coins',
    rewardLabel: '$5.00',
    state: 'active',
    expiresAt: endOfDay(),
  },
  {
    id: 't_upload',
    title: 'Upload 3 videos',
    description: 'Public videos, at least 10 seconds each',
    icon: 'videocam-outline',
    metric: 'uploads',
    current: 3,
    target: 3,
    reward: 150,
    rewardKind: 'coins',
    rewardLabel: '$1.50',
    state: 'claimed',
    expiresAt: endOfDay(),
  },
  {
    id: 't_watch',
    title: 'Watch 60 minutes',
    description: 'Time spent watching other creators',
    icon: 'time-outline',
    metric: 'watch_minutes',
    current: 42,
    target: 60,
    reward: 100,
    rewardKind: 'coins',
    rewardLabel: '$1.00',
    state: 'active',
    expiresAt: endOfDay(),
  },
];

// ───────────────────────────── Referrals ────────────────────────────────

export const referralStats: ReferralStats = {
  code: 'ALEX2026',
  link: 'https://vyra.app/i/ALEX2026',
  total: 42,
  today: 3,
  qualified: 31,
  pending: 11,
  earned: 3100,
  rewardPerReferral: 100,
  todayTarget: 5,
};

export const referralEntries: ReferralEntry[] = [
  { id: 'r_1', username: 'pixelforge', avatar: users[7].avatar, joinedAt: hoursAgo(2), qualified: true, reward: 100 },
  { id: 'r_2', username: 'ravi.builds', avatar: users[10].avatar, joinedAt: hoursAgo(5), qualified: true, reward: 100 },
  { id: 'r_3', username: 'nova.fitness', avatar: users[3].avatar, joinedAt: hoursAgo(9), qualified: false, reward: 0 },
  { id: 'r_4', username: 'kofi.eats', avatar: users[5].avatar, joinedAt: daysAgo(1), qualified: true, reward: 100 },
  { id: 'r_5', username: 'echo.music', avatar: users[11].avatar, joinedAt: daysAgo(2), qualified: true, reward: 100 },
  { id: 'r_6', username: 'sana.travels', avatar: users[6].avatar, joinedAt: daysAgo(3), qualified: false, reward: 0 },
];

// ─────────────────────── Currencies and coin pricing ────────────────────

export const currencyRates: CurrencyRate[] = [
  { code: 'USD', label: 'US Dollar', symbol: '$', coinsPerUnit: 100, minAmount: 1, enabled: true },
  { code: 'PKR', label: 'Pakistani Rupee', symbol: 'Rs', coinsPerUnit: 0.35, minAmount: 300, enabled: true },
  { code: 'INR', label: 'Indian Rupee', symbol: '₹', coinsPerUnit: 0.4, minAmount: 250, enabled: true },
  { code: 'USDT', label: 'Tether', symbol: '₮', coinsPerUnit: 100, minAmount: 1, enabled: true },
  { code: 'AED', label: 'UAE Dirham', symbol: 'د.إ', coinsPerUnit: 27, minAmount: 5, enabled: true },
  { code: 'GBP', label: 'British Pound', symbol: '£', coinsPerUnit: 126, minAmount: 1, enabled: false },
];

export const coinsFor = (amount: number, currencyCode: string): number => {
  const rate = currencyRates.find((r) => r.code === currencyCode);
  if (!rate || !Number.isFinite(amount) || amount <= 0) return 0;
  return Math.floor(amount * rate.coinsPerUnit);
};

// ─────────────────────────── Payment methods ────────────────────────────

export const paymentMethods: PaymentMethod[] = [
  {
    id: 'pm_easypaisa',
    kind: 'easypaisa',
    label: 'EasyPaisa',
    accountName: 'Vyra Technologies',
    accountNumber: '0300-1234567',
    currencies: ['PKR'],
    icon: 'phone-portrait-outline',
    enabled: true,
    manual: true,
    instructions: [
      'Open EasyPaisa and choose Send Money.',
      'Send the exact amount to the number above.',
      'Copy the transaction ID from your receipt.',
      'Enter the transaction ID below and attach a screenshot.',
    ],
  },
  {
    id: 'pm_jazzcash',
    kind: 'jazzcash',
    label: 'JazzCash',
    accountName: 'Vyra Technologies',
    accountNumber: '0301-7654321',
    currencies: ['PKR'],
    icon: 'wallet-outline',
    enabled: true,
    manual: true,
    instructions: [
      'Open JazzCash and choose Mobile Account transfer.',
      'Send the exact amount to the number above.',
      'Copy the TID from the confirmation SMS.',
      'Enter the TID below and attach a screenshot.',
    ],
  },
  {
    id: 'pm_bank',
    kind: 'bank',
    label: 'Bank Transfer',
    accountName: 'Vyra Technologies Pvt Ltd',
    accountNumber: 'PK36 SCBL 0000 0011 2345 6702',
    currencies: ['PKR', 'USD', 'AED'],
    icon: 'business-outline',
    enabled: true,
    manual: true,
    instructions: [
      'Transfer the exact amount to the IBAN above.',
      'Use your username as the payment reference.',
      'Bank transfers can take up to 1 business day to appear.',
      'Enter the reference number below and attach the receipt.',
    ],
  },
  {
    id: 'pm_usdt',
    kind: 'usdt',
    label: 'USDT (TRC-20)',
    accountName: 'Vyra Technologies',
    accountNumber: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
    currencies: ['USDT'],
    icon: 'logo-bitcoin',
    enabled: true,
    manual: true,
    instructions: [
      'Send USDT on the TRC-20 network only.',
      'Sending on another network will lose the funds.',
      'Copy the transaction hash after it confirms.',
      'Paste the hash below to verify your payment.',
    ],
  },
  {
    id: 'pm_card',
    kind: 'card',
    label: 'Card payment',
    accountName: '',
    accountNumber: '',
    currencies: ['USD', 'AED', 'GBP'],
    icon: 'card-outline',
    enabled: true,
    manual: false,
    instructions: ['Coins are credited automatically once the payment clears.'],
  },
];

export const coinPurchaseRequests: CoinPurchaseRequest[] = [
  {
    id: 'CP-88214',
    coins: 1000,
    amount: 2860,
    currency: 'PKR',
    methodId: 'pm_easypaisa',
    methodLabel: 'EasyPaisa',
    transactionRef: 'EP8842190231',
    proofUploaded: true,
    status: 'approved',
    createdAt: daysAgo(2),
  },
  {
    id: 'CP-88240',
    coins: 500,
    amount: 5,
    currency: 'USD',
    methodId: 'pm_usdt',
    methodLabel: 'USDT (TRC-20)',
    transactionRef: '0x9f2a…c41e',
    proofUploaded: true,
    status: 'under_review',
    createdAt: hoursAgo(4),
  },
  {
    id: 'CP-88251',
    coins: 2000,
    amount: 5720,
    currency: 'PKR',
    methodId: 'pm_jazzcash',
    methodLabel: 'JazzCash',
    transactionRef: 'JC7719002',
    proofUploaded: false,
    status: 'pending',
    createdAt: minutesAgo(35),
  },
  {
    id: 'CP-88190',
    coins: 500,
    amount: 1430,
    currency: 'PKR',
    methodId: 'pm_bank',
    methodLabel: 'Bank Transfer',
    transactionRef: 'TRX-2291',
    proofUploaded: true,
    status: 'rejected',
    note: 'Screenshot did not match the amount sent. Please resubmit.',
    createdAt: daysAgo(6),
  },
];

// ───────────────────────────── Withdrawals ──────────────────────────────

export const withdrawalMethods: WithdrawalMethod[] = [
  {
    id: 'wm_usdt',
    kind: 'usdt',
    label: 'USDT (TRC-20)',
    fieldLabel: 'USDT wallet address',
    fieldPlaceholder: 'T… (TRC-20 only)',
    network: 'TRC-20',
    minAmount: 20,
    feePercent: 1,
    processingTime: '1–2 business days',
    enabled: true,
    icon: 'logo-bitcoin',
  },
  {
    id: 'wm_bank',
    kind: 'bank',
    label: 'Bank transfer (USD)',
    fieldLabel: 'IBAN / account number',
    fieldPlaceholder: 'PK36 SCBL 0000 …',
    minAmount: 50,
    feePercent: 2,
    processingTime: '3–5 business days',
    enabled: true,
    icon: 'business-outline',
  },
  {
    id: 'wm_easypaisa',
    kind: 'easypaisa',
    label: 'EasyPaisa',
    fieldLabel: 'EasyPaisa number',
    fieldPlaceholder: '03xx-xxxxxxx',
    minAmount: 20,
    feePercent: 1.5,
    processingTime: '1 business day',
    enabled: true,
    icon: 'phone-portrait-outline',
  },
];

export const withdrawalRequests: WithdrawalRequest[] = [
  {
    id: 'WD-4412',
    amount: 120,
    currency: 'USD',
    coins: 12000,
    methodId: 'wm_usdt',
    methodLabel: 'USDT (TRC-20)',
    destination: 'TQn9…bLSE',
    status: 'under_review',
    requestedAt: hoursAgo(20),
  },
  {
    id: 'WD-4380',
    amount: 250,
    currency: 'USD',
    coins: 25000,
    methodId: 'wm_usdt',
    methodLabel: 'USDT (TRC-20)',
    destination: 'TQn9…bLSE',
    status: 'paid',
    requestedAt: daysAgo(12),
    settledAt: daysAgo(10),
  },
  {
    id: 'WD-4302',
    amount: 80,
    currency: 'USD',
    coins: 8000,
    methodId: 'wm_easypaisa',
    methodLabel: 'EasyPaisa',
    destination: '0300-1234567',
    status: 'rejected',
    note: 'Account name did not match the verified profile name.',
    requestedAt: daysAgo(24),
    settledAt: daysAgo(22),
  },
];

// ─────────────────────── Live gift earnings summary ─────────────────────

export const liveGiftEarnings = {
  totalGifts: 1842,
  giftCoins: walletBalances.liveGift,
  estimatedUsd: walletBalances.liveGift / monetizationConfig.giftCoinsPerUsd,
  availableUsd: walletBalances.withdrawable,
  pendingUsd: walletBalances.pendingWithdrawal,
  clearingUsd: 55.6,
  topGifters: [
    { user: users[5], coins: 12400, gifts: 214 },
    { user: users[9], coins: 8900, gifts: 142 },
    { user: users[1], coins: 6200, gifts: 98 },
    { user: users[6], coins: 4100, gifts: 76 },
  ],
  recentGifts: [
    { id: 'g1', from: users[5], gift: 'Crown', icon: '👑', coins: 500, at: minutesAgo(12) },
    { id: 'g2', from: users[9], gift: 'Diamond', icon: '💎', coins: 1500, at: hoursAgo(2) },
    { id: 'g3', from: users[1], gift: 'Fire', icon: '🔥', coins: 100, at: hoursAgo(5) },
    { id: 'g4', from: users[3], gift: 'Rose', icon: '🌹', coins: 10, at: hoursAgo(8) },
    { id: 'g5', from: users[6], gift: 'Star', icon: '⭐', coins: 50, at: daysAgo(1) },
  ],
  weekly: [
    { label: 'Mon', value: 4200 },
    { label: 'Tue', value: 6100 },
    { label: 'Wed', value: 3800 },
    { label: 'Thu', value: 8400 },
    { label: 'Fri', value: 12100 },
    { label: 'Sat', value: 18400 },
    { label: 'Sun', value: 9200 },
  ],
};
