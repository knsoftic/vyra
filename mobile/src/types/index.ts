/**
 * Domain types.
 *
 * These deliberately mirror the shape the backend will return in Phase 3+, so the
 * mock layer can be replaced by real API calls without touching a single screen.
 * Keep in sync with `/shared/contracts`.
 */

// ─────────────────────────────── Accounts ───────────────────────────────

export type IndividualAccountType = 'normal' | 'creator' | 'public_figure' | 'professional';
export type BusinessAccountType =
  | 'company'
  | 'brand'
  | 'shop'
  | 'organization'
  | 'advertiser'
  | 'service_provider';

export type AccountCategory = 'individual' | 'business';
export type VerificationTier = 'none' | 'individual' | 'creator' | 'business';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio?: string;
  accountCategory: AccountCategory;
  accountType: IndividualAccountType | BusinessAccountType;
  verification: VerificationTier;
  followers: number;
  following: number;
  likes: number;
  videos: number;
  isFollowing?: boolean;
  isFollowedBy?: boolean;
  isBlocked?: boolean;
  isPrivate?: boolean;
  isLive?: boolean;
  links?: string[];
  // Business-only
  businessCategory?: string;
  website?: string;
  contactEmail?: string;
  contactPhone?: string;
  cta?: { label: string; url: string };
  joinedAt?: string;
}

// ──────────────────────────────── Video ─────────────────────────────────

export type VideoPrivacy = 'public' | 'followers' | 'friends' | 'private';

export interface VideoInteractionSettings {
  allowComments: boolean;
  allowShare: boolean;
  allowDownload: boolean;
  allowRemix: boolean;
  allowDuet: boolean;
}

export interface Sound {
  id: string;
  title: string;
  artist: string;
  cover: string;
  durationSec: number;
  isOriginal: boolean;
  usageCount?: number;
  category?: string;
  isTrending?: boolean;
  isFavorite?: boolean;
}

export interface VideoStats {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

/** Decomposed quality — never a single opaque number (see ADR-011). */
export interface VideoQualityScore {
  overall: number; // 0-100
  technical: number;
  contentRelevance: number;
  thumbnailQuality: number;
  captionRelevance: number;
  spamProbability: number;
  duplicateProbability: number;
  safetyStatus: 'safe' | 'review' | 'restricted';
}

export interface Video {
  id: string;
  author: User;
  caption: string;
  hashtags: string[];
  mentions: string[];
  sound: Sound;
  /** Playback source. Poster shows while loading and whenever playback is unavailable. */
  url: string;
  poster: string;
  durationSec: number;
  privacy: VideoPrivacy;
  interaction: VideoInteractionSettings;
  stats: VideoStats;
  liked?: boolean;
  saved?: boolean;
  category: string;
  location?: string;
  createdAt: string;
  quality?: VideoQualityScore;
  /** Which feed pool surfaced this video — used by the behaviour engine in Phase 6. */
  feedSource?: 'for_you' | 'following' | 'trending' | 'category' | 'search' | 'profile' | 'promoted';
  isPromoted?: boolean;
}

export interface VideoDraft {
  id: string;
  poster: string;
  caption: string;
  durationSec: number;
  updatedAt: string;
  clipCount: number;
}

// ─────────────────────────────── Comments ───────────────────────────────

export interface Comment {
  id: string;
  author: User;
  text: string;
  createdAt: string;
  likes: number;
  liked?: boolean;
  replyCount: number;
  replies?: Comment[];
  isPinned?: boolean;
  isCreator?: boolean;
}

// ─────────────────────────────── Messaging ──────────────────────────────

/** `system` covers a withdrawn message and any server-generated notice. */
export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'voice'
  | 'shared_video'
  | 'system';
/** `failed` is a client-only state: a send the server never accepted. */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'seen' | 'failed';

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  kind: MessageKind;
  text?: string;
  mediaUrl?: string;
  durationSec?: number;
  fileName?: string;
  fileSize?: string;
  createdAt: string;
  status: MessageStatus;
  replyTo?: { id: string; senderName: string; preview: string };
  isDeleted?: boolean;
}

export type ChatKind = 'private' | 'group' | 'community';

export interface Chat {
  id: string;
  kind: ChatKind;
  title: string;
  avatar: string;
  participants: User[];
  lastMessage?: Message;
  unreadCount: number;
  isMuted?: boolean;
  isOnline?: boolean;
  lastSeen?: string;
  isTyping?: boolean;
  pinnedMessageId?: string;
}

export type GroupRole = 'owner' | 'admin' | 'member';

export interface Group extends Chat {
  kind: 'group';
  description: string;
  ownerId: string;
  adminIds: string[];
  memberCount: number;
}

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface CommunityPermissions {
  canPost: boolean;
  canComment: boolean;
  canSendMedia: boolean;
  canSendLinks: boolean;
  canInvite: boolean;
}

export interface Community {
  id: string;
  name: string;
  logo: string;
  banner?: string;
  description: string;
  rules: string[];
  isPrivate: boolean;
  memberCount: number;
  /**
   * Ordinary members never receive the roster (ADR-014) — this is populated
   * only for owner / admin / moderator viewers.
   */
  members?: User[];
  pendingRequests?: number;
  myRole: CommunityRole;
  permissions: CommunityPermissions;
  announcement?: string;
  unreadCount?: number;
}

// ───────────────────────────────── Calls ────────────────────────────────

export type CallKind = 'voice' | 'video';
export type CallDirection = 'incoming' | 'outgoing' | 'missed';

export interface CallRecord {
  id: string;
  kind: CallKind;
  direction: CallDirection;
  participants: User[];
  isGroup: boolean;
  startedAt: string;
  durationSec: number;
}

// ───────────────────────────────── Live ─────────────────────────────────

export interface LiveStream {
  id: string;
  host: User;
  title: string;
  category: string;
  thumbnail: string;
  viewers: number;
  likes: number;
  coinsEarned: number;
  startedAt: string;
  guests?: User[];
  isCoHosting?: boolean;
}

export interface LiveComment {
  id: string;
  author: User;
  text: string;
  createdAt: string;
  kind?: 'comment' | 'join' | 'gift' | 'follow';
  giftName?: string;
}

export interface Gift {
  id: string;
  name: string;
  icon: string;
  coins: number;
  isFeatured?: boolean;
  isActive: boolean;
}

// ──────────────────────────────── Wallet ────────────────────────────────

/**
 * Which of the four balances a transaction moves. Balances never mix:
 * purchased coins, promotional rewards and real creator earnings are
 * economically different and only `live_gift` is ever withdrawable (ADR-018).
 */
export type WalletKind = 'coin' | 'reward' | 'live_gift' | 'withdrawable';

export type TransactionType =
  | 'purchase'
  | 'gift_sent'
  | 'gift_received'
  | 'promotion'
  | 'ad_spend'
  | 'refund'
  | 'admin_credit'
  | 'admin_debit'
  // Reward wallet
  | 'task_reward'
  | 'referral_reward'
  | 'milestone_reward'
  // Movement between wallets
  | 'reward_to_coins'
  // Creator earnings
  | 'withdrawal_request'
  | 'withdrawal_paid'
  | 'withdrawal_rejected';

export type TransactionStatus =
  | 'successful'
  | 'pending'
  | 'failed'
  | 'refunded'
  | 'under_review'
  | 'approved'
  | 'rejected';

/** Every row carries previous and new balance — the ledger is the truth (ADR-013). */
export interface CoinTransaction {
  id: string;
  type: TransactionType;
  /** Which balance this row moved. */
  wallet: WalletKind;
  description: string;
  coins: number; // signed
  previousBalance: number;
  newBalance: number;
  status: TransactionStatus;
  reference?: string;
  /** Fiat leg, when the row came from a purchase or a payout. */
  amount?: number;
  currency?: string;
  createdAt: string;
}

export interface CoinPackage {
  id: string;
  coins: number;
  bonusCoins: number;
  price: number;
  currency: string;
  isPopular?: boolean;
  discountPercent?: number;
}

/**
 * The four balances a user holds. Kept apart in the UI and in the schema so
 * bought coins, earned promo credit and real payable earnings never blend.
 */
export interface WalletBalances {
  /** Spendable in-app: promotion and live gifting. Purchased or converted. */
  coins: number;
  /** Earned from tasks, referrals and milestones. Convertible to coins, not payable. */
  reward: number;
  /** Gift coins received while live. The only balance that can become payable. */
  liveGift: number;
  /** Portion of `liveGift` that has cleared and can be requested for payout. */
  withdrawable: number;
  /** Reward still maturing (task verified but inside the hold window). */
  pendingReward: number;
  totalEarned: number;
  todayEarned: number;
  /** Payout requested and not yet settled. */
  pendingWithdrawal: number;
}

// ───────────────────────────── Monetization ─────────────────────────────

export type MonetizationState = 'locked' | 'eligible' | 'enabled' | 'review' | 'suspended';

/** One requirement gate. Targets come from platform config, never hard-coded. */
export interface MonetizationCriterion {
  id: string;
  label: string;
  /** e.g. 'followers', 'views', 'watch_hours', 'account_age_days' */
  metric: string;
  current: number;
  required: number;
  unit?: string;
  /** Boolean gates (verification) render as a tick rather than a bar. */
  isBoolean?: boolean;
  hint?: string;
}

export interface MonetizationStatus {
  state: MonetizationState;
  criteria: MonetizationCriterion[];
  /** 0–100, share of criteria met. */
  progress: number;
  enabledAt?: string;
  reviewNote?: string;
}

// ───────────────────────────── Daily tasks ──────────────────────────────

export type TaskState = 'active' | 'completed' | 'claimed' | 'expired';

export type TaskRewardKind = 'coins' | 'cash';

export interface DailyTask {
  id: string;
  title: string;
  description: string;
  icon: string;
  metric: string;
  current: number;
  target: number;
  reward: number;
  rewardKind: TaskRewardKind;
  /** Display value for a cash-equivalent reward, e.g. "$2.00". */
  rewardLabel: string;
  state: TaskState;
  /** ISO timestamp the task resets/expires. */
  expiresAt: string;
}

// ───────────────────────────── Referrals ────────────────────────────────

export interface ReferralStats {
  code: string;
  link: string;
  total: number;
  today: number;
  /** Referrals that met the qualification bar (installed + activity). */
  qualified: number;
  pending: number;
  earned: number;
  rewardPerReferral: number;
  todayTarget: number;
}

export interface ReferralEntry {
  id: string;
  username: string;
  avatar: string;
  joinedAt: string;
  qualified: boolean;
  reward: number;
}

// ──────────────────────── Coin purchase (manual) ────────────────────────

export type PaymentMethodKind = 'easypaisa' | 'jazzcash' | 'bank' | 'usdt' | 'card';

export interface PaymentMethod {
  id: string;
  kind: PaymentMethodKind;
  label: string;
  /** Account name/number or wallet address the user pays into. */
  accountName: string;
  accountNumber: string;
  /** Currencies this method accepts. */
  currencies: string[];
  instructions: string[];
  icon: string;
  enabled: boolean;
  /** Manual methods need proof + admin approval; card/USDT gateways settle automatically. */
  manual: boolean;
}

export type PurchaseStatus = 'pending' | 'under_review' | 'approved' | 'rejected';

export interface CoinPurchaseRequest {
  id: string;
  coins: number;
  amount: number;
  currency: string;
  methodId: string;
  methodLabel: string;
  transactionRef: string;
  proofUploaded: boolean;
  status: PurchaseStatus;
  note?: string;
  createdAt: string;
}

/** Conversion rate, config-driven. `coinsPerUnit` × amount = coins credited. */
export interface CurrencyRate {
  code: string;
  label: string;
  symbol: string;
  coinsPerUnit: number;
  minAmount: number;
  enabled: boolean;
}

// ───────────────────────────── Withdrawals ──────────────────────────────

export type WithdrawalStatus =
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'paid'
  | 'rejected';

export interface WithdrawalMethod {
  id: string;
  kind: 'usdt' | 'bank' | 'easypaisa' | 'jazzcash';
  label: string;
  /** What the user must supply, e.g. wallet address or IBAN. */
  fieldLabel: string;
  fieldPlaceholder: string;
  network?: string;
  minAmount: number;
  feePercent: number;
  processingTime: string;
  enabled: boolean;
  icon: string;
}

export interface WithdrawalRequest {
  id: string;
  amount: number;
  currency: string;
  coins: number;
  methodId: string;
  methodLabel: string;
  destination: string;
  status: WithdrawalStatus;
  note?: string;
  requestedAt: string;
  settledAt?: string;
}

/**
 * Everything operationally tunable, served by the backend so the app always
 * shows the currently active values rather than compiled-in numbers.
 */
export interface MonetizationConfig {
  /** How many coins one unit of reward currency converts into. */
  rewardToCoinRate: number;
  /** Coins earned per 1 USD of gift value, for display. */
  giftCoinsPerUsd: number;
  withdrawalEnabled: boolean;
  minWithdrawal: number;
  withdrawalCurrency: string;
  /** Days gift earnings are held before becoming withdrawable. */
  clearingDays: number;
}

// ─────────────────────────── Promotion and ads ──────────────────────────

export type CampaignObjective =
  | 'awareness'
  | 'reach'
  | 'video_views'
  | 'engagement'
  | 'followers'
  | 'profile_visits'
  | 'website_traffic'
  | 'leads'
  | 'app_promotion';

export type CampaignStatus = 'draft' | 'pending_review' | 'active' | 'paused' | 'completed' | 'rejected';
export type AudienceMode = 'automatic' | 'custom' | 'broad';

export interface CampaignTargeting {
  mode: AudienceMode;
  countries?: string[];
  cities?: string[];
  languages?: string[];
  interests?: string[];
  categories?: string[];
  devices?: string[];
  operatingSystems?: string[];
  ageRange?: [number, number];
}

export interface Campaign {
  id: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  videoId?: string;
  poster: string;
  budgetCoins: number;
  spentCoins: number;
  durationDays: number;
  targeting: CampaignTargeting;
  results: {
    impressions: number;
    reach: number;
    views: number;
    clicks: number;
    engagements: number;
    followers: number;
    profileVisits: number;
  };
  createdAt: string;
}

// ─────────────────────────── Notifications ──────────────────────────────

export type NotificationKind =
  | 'like'
  | 'comment'
  | 'follow'
  | 'mention'
  | 'gift'
  | 'system'
  | 'verification'
  | 'campaign'
  | 'task';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  actor?: User;
  text: string;
  videoThumb?: string;
  createdAt: string;
  read: boolean;
}

// ─────────────────────────── Creative assets ────────────────────────────

export interface VideoFilter {
  id: string;
  name: string;
  /** Preview tint used in the carousel; the real shader runs on the GPU. */
  previewColor: string;
  intensity: number;
  isPremium?: boolean;
  isTrending?: boolean;
  isNew?: boolean;
  order: number;
}

export interface VideoEffect {
  id: string;
  name: string;
  category: 'motion' | 'light' | 'color' | 'transition' | 'background' | 'time';
  icon: string;
  isPremium?: boolean;
  isTrending?: boolean;
  isNew?: boolean;
}

export interface AdjustmentControl {
  id: string;
  label: string;
  value: number; // -100..100, or 0..100 for one-sided controls
  min: number;
  max: number;
  defaultValue: number;
}

export interface StickerPack {
  id: string;
  name: string;
  stickers: string[];
  isNew?: boolean;
}

// ─────────────────────────── Verification ───────────────────────────────

export type VerificationStatus = 'not_applied' | 'pending' | 'more_info' | 'approved' | 'rejected';

export interface VerificationRequest {
  id: string;
  tier: Exclude<VerificationTier, 'none'>;
  status: VerificationStatus;
  submittedAt?: string;
  reviewedAt?: string;
  note?: string;
}

// ───────────────────────────── Support ──────────────────────────────────

export type TicketCategory =
  | 'account'
  | 'payment'
  | 'coins'
  | 'video'
  | 'verification'
  | 'advertisement'
  | 'technical';

export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';

export interface SupportTicket {
  id: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ReportRecord {
  id: string;
  targetType: 'user' | 'video' | 'comment' | 'live' | 'group' | 'community';
  targetLabel: string;
  reason: string;
  status: 'submitted' | 'reviewing' | 'action_taken' | 'no_action';
  createdAt: string;
}

// ─────────────────────────── Analytics ──────────────────────────────────

export interface TimeSeriesPoint {
  label: string;
  value: number;
}

export interface CreatorAnalytics {
  followers: number;
  followerGrowth: number;
  views: number;
  likes: number;
  watchTimeHours: number;
  avgWatchSeconds: number;
  completionRate: number;
  rewatchRate: number;
  shares: number;
  saves: number;
  profileVisits: number;
  giftsCoins: number;
  viewsSeries: TimeSeriesPoint[];
  followerSeries: TimeSeriesPoint[];
  audienceCategories: { label: string; percent: number }[];
  topVideos: Video[];
}

// ───────────────────────────── Discovery ────────────────────────────────

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  videoCount: number;
}

export interface Hashtag {
  id: string;
  tag: string;
  views: number;
  isOfficial?: boolean;
  isSponsored?: boolean;
}
