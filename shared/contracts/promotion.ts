/**
 * Promotion and advertising contract.
 *
 * Promotion buys distribution — it never buys engagement. There is no field
 * anywhere in this file for purchasing likes, followers or comments, because the
 * platform does not sell them. Campaigns increase how many real people see a
 * video; whether they engage is up to them.
 */

import type { Page } from './http.ts';

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

export type CampaignStatus =
  | 'draft'
  | 'pending_review'
  | 'active'
  | 'paused'
  | 'completed'
  | 'rejected';

export type AudienceMode = 'automatic' | 'custom' | 'broad';

export interface CampaignTargeting {
  mode: AudienceMode;
  countries?: string[];
  cities?: string[];
  languages?: string[];
  interests?: string[];
  categories?: string[];
  devices?: string[];
  os?: string[];
  ageMin?: number;
  ageMax?: number;
}

export interface Campaign {
  id: string;
  name: string;
  kind: 'promotion' | 'campaign';
  videoId?: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  budgetCoins: number;
  spentCoins: number;
  dailyCapCoins?: number;
  durationDays: number;
  targeting: CampaignTargeting;
  ctaLabel?: string;
  destinationUrl?: string;
  startsAt?: string;
  endsAt?: string;
  decisionNote?: string;
  createdAt: string;
}

/** Real delivery numbers only. Every figure here is a count of actual people. */
export interface CampaignMetrics {
  impressions: number;
  reach: number;
  views: number;
  clicks: number;
  engagements: number;
  followers: number;
  profileVisits: number;
  spentCoins: number;
  costPerView?: number;
  series: { at: string; impressions: number; views: number; spentCoins: number }[];
}

export interface CreateCampaignBody {
  name: string;
  videoId?: string;
  objective: CampaignObjective;
  budgetCoins: number;
  durationDays: number;
  targeting: CampaignTargeting;
  dailyCapCoins?: number;
  ctaLabel?: string;
  destinationUrl?: string;
}

/** Server-computed forecast shown before the user commits coins. */
export interface CampaignEstimate {
  estimatedReachMin: number;
  estimatedReachMax: number;
  estimatedViewsMin: number;
  estimatedViewsMax: number;
  dailyBudgetCoins: number;
  /** Plain-language caveat rendered under the numbers. */
  disclaimer: string;
}

export type CampaignPage = Page<Campaign>;
