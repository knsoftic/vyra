/** Identity, profile and auth contract. */

import type { Page } from './http.ts';

export type VerificationTier = 'none' | 'individual' | 'creator' | 'business';

export type AccountCategory = 'individual' | 'business';

export type IndividualAccountType = 'normal' | 'creator' | 'public_figure' | 'professional';

export type BusinessAccountType =
  | 'company'
  | 'brand'
  | 'shop'
  | 'organization'
  | 'advertiser'
  | 'service_provider';

export type AccountType = IndividualAccountType | BusinessAccountType;

/** Which types belong to which category. Used to validate a switch request. */
export const ACCOUNT_TYPES: Record<AccountCategory, readonly AccountType[]> = {
  individual: ['normal', 'creator', 'public_figure', 'professional'],
  business: ['company', 'brand', 'shop', 'organization', 'advertiser', 'service_provider'],
};

/** Capabilities a business account unlocks. Business profile, CTA, campaigns, analytics. */
export const BUSINESS_ONLY_FEATURES = [
  'business_profile',
  'cta_button',
  'campaign_manager',
  'business_analytics',
] as const;

export type UserStatus = 'active' | 'suspended' | 'banned' | 'frozen';

export interface ProfileLink {
  label: string;
  url: string;
}

/** The shape returned for any user other than the caller. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  bio: string;
  verified: boolean;
  verificationTier: VerificationTier;
  accountCategory: AccountCategory;
  accountType: AccountType;
  followers: number;
  following: number;
  likes: number;
  videos: number;
  isPrivate: boolean;
  /** Relative to the caller. Absent when unauthenticated. */
  isFollowing?: boolean;
  isFollowedBy?: boolean;
  /** True when the caller has blocked this user. */
  isBlocked?: boolean;
  links?: ProfileLink[];
  business?: BusinessProfile;
  createdAt: string;
}

export interface BusinessProfile {
  category?: string;
  website?: string;
  contactEmail?: string;
  contactPhone?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

/** Who may interact with the account. Enforced server-side, not just in the UI. */
export interface PrivacySettings {
  isPrivate: boolean;
  whoCanComment: 'everyone' | 'followers' | 'nobody';
  whoCanMessage: 'everyone' | 'followers' | 'nobody';
  whoCanDuet: 'everyone' | 'followers' | 'nobody';
  allowDownload: boolean;
}

/** Adds fields only the account owner may see. */
export interface PrivateUser extends PublicUser {
  email?: string;
  emailVerified: boolean;
  country?: string;
  language: string;
  status: UserStatus;
  privacy: PrivacySettings;
  monetizationEnabled: boolean;
  unreadNotifications: number;
  unreadMessages: number;
}

// ── Auth ──

export interface AuthTokens {
  accessToken: string;
  /** Rotated on every refresh; the previous one is invalidated immediately. */
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface AuthSession {
  user: PrivateUser;
  tokens: AuthTokens;
  /** True on first login, so the client can route to interest onboarding. */
  isNewAccount: boolean;
}

/** Matches the `otp_codes.purpose` column. */
export type OtpPurpose = 'signup' | 'login' | 'reset' | 'email_change';

export interface DeviceInfo {
  /** Stable per install. Not an advertising identifier (ADR-008). */
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  appVersion?: string;
  pushToken?: string;
}

export interface RegisterBody {
  email: string;
  password: string;
  username: string;
  displayName?: string;
  birthdate: string;
  referralCode?: string;
  device: DeviceInfo;
}

export interface LoginBody {
  email: string;
  password: string;
  device: DeviceInfo;
}

export interface OtpRequestBody {
  email: string;
  purpose: OtpPurpose;
}

export interface OtpVerifyBody {
  email: string;
  code: string;
  purpose: OtpPurpose;
}

export interface RefreshBody {
  refreshToken: string;
}

export interface ResetPasswordBody {
  email: string;
  code: string;
  newPassword: string;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateProfileBody {
  displayName?: string;
  bio?: string;
  avatarKey?: string;
  links?: ProfileLink[];
  language?: string;
}

export interface SwitchAccountTypeBody {
  category: AccountCategory;
  type: AccountType;
}

export interface UpdateBusinessProfileBody {
  category?: string;
  website?: string;
  contactEmail?: string;
  contactPhone?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export interface UsernameAvailability {
  username: string;
  available: boolean;
  /** Present when unavailable, so the UI can explain rather than just refuse. */
  reason?: 'taken' | 'reserved' | 'invalid' | 'previously_used';
}

export interface SessionInfo {
  id: string;
  device: string;
  platform: string;
  location?: string;
  isCurrent: boolean;
  lastActiveAt: string;
  createdAt: string;
}

/** One row of the account activity list the user can see. */
export interface SecurityEvent {
  id: string;
  event: string;
  outcome: 'success' | 'failure' | 'blocked';
  detail?: string;
  device?: string;
  createdAt: string;
}

export type ReportTargetType = 'user' | 'video' | 'comment' | 'live' | 'community' | 'message';

export interface ReportBody {
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  detail?: string;
}

export type UserPage = Page<PublicUser>;
export type SessionList = SessionInfo[];
