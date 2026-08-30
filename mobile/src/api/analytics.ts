/**
 * Creator and business analytics.
 *
 * Rates are nullable, and that is the point: `null` means nobody has watched
 * yet, `0` means people watched and left. Collapsing the two into zero tells a
 * new creator their work has a 0% completion rate, which is not true and not
 * kind.
 */

import { api } from './client';

export interface SeriesPoint {
  day: string;
  value: number;
}

export interface TopVideo {
  id: string;
  caption: string | null;
  posterUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  watchMinutes: number;
  publishedAt: string | null;
}

export interface CreatorAnalytics {
  days: number;
  followers: number;
  followerGrowth: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profileVisits: number;
  giftCoins: number;
  watchTimeHours: number;
  /** Null until at least one person has watched something. */
  avgWatchSeconds: number | null;
  completionRate: number | null;
  rewatchRate: number | null;
  viewsSeries: SeriesPoint[];
  followerSeries: SeriesPoint[];
  watchMinutesSeries: SeriesPoint[];
  categories: { label: string; percent: number }[];
  sources: { label: string; percent: number }[];
  topVideos: TopVideo[];
  hasNoVideos: boolean;
}

export interface BusinessAnalytics {
  days: number;
  profileVisits: number;
  followerGrowth: number;
  views: number;
  ctaClicks: number;

  /** Percent change against the previous window of the same length. */
  profileVisitsChange: number | null;
  followerGrowthChange: number | null;
  viewsChange: number | null;
  ctaClicksChange: number | null;

  /** Spend inside the window, not lifetime. */
  adSpendCoins: number;
  adImpressions: number;
  adReach: number;
  adClicks: number;
  /** Null while nothing has been clicked — a cost with no result is not zero. */
  costPerClickCoins: number | null;
  campaignsRunning: number;
  hasCampaigns: boolean;

  reachSeries: SeriesPoint[];
  visitSeries: SeriesPoint[];
  topCategories: { label: string; percent: number }[];
}

export const analytics = {
  creator: (days = 28) =>
    api.get<CreatorAnalytics>(`/me/analytics?days=${days}`).then((r) => r.data),

  business: (days = 28) =>
    api.get<BusinessAnalytics>(`/me/analytics/business?days=${days}`).then((r) => r.data),
};
