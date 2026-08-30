/**
 * Promotion and campaigns.
 *
 * There is no function in this file for buying likes, followers or comments,
 * because there is no endpoint for it. A campaign increases how many people are
 * shown a video; what they do next is theirs.
 */

import { api } from './client';
import type {
  Campaign,
  CampaignEstimate,
  CampaignMetrics,
  CampaignTargeting,
  CreateCampaignBody,
} from '../../../shared/contracts/promotion';

export const promotion = {
  list: () => api.get<Campaign[]>('/campaigns').then((r) => r.data),

  get: (id: string) => api.get<Campaign>(`/campaigns/${id}`).then((r) => r.data),

  metrics: (id: string) => api.get<CampaignMetrics>(`/campaigns/${id}/metrics`).then((r) => r.data),

  /** A forecast, not a promise — the response carries its own caveat. */
  estimate: (budgetCoins: number, durationDays: number, targeting: CampaignTargeting) =>
    api
      .post<CampaignEstimate>('/campaigns/estimate', { budgetCoins, durationDays, targeting })
      .then((r) => r.data),

  /**
   * Creates a campaign. The budget leaves the wallet immediately and is held
   * until the campaign ends, so the key is made once per intent.
   */
  create: (input: CreateCampaignBody & { kind?: 'promotion' | 'campaign' }, idempotencyKey: string) =>
    api
      .post<Campaign>('/campaigns', input, { headers: { 'idempotency-key': idempotencyKey } })
      .then((r) => r.data),

  setState: (id: string, action: 'pause' | 'resume' | 'stop') =>
    api.post<Campaign>(`/campaigns/${id}/state`, { action }).then((r) => r.data),

  /** A promoted video was watched. Charged once per delivery, by the server. */
  signalView: (campaignId: string, impressionId: string) =>
    api
      .post<{ charged: boolean }>('/campaigns/signals/view', { campaignId, impressionId })
      .then((r) => r.data),

  /** The call to action was tapped. Recorded, never charged. */
  signalClick: (campaignId: string, impressionId: string) =>
    api
      .post<{ recorded: boolean }>('/campaigns/signals/click', { campaignId, impressionId })
      .then((r) => r.data),
};
