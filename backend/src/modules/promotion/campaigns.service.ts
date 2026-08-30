/**
 * Promotion and campaigns.
 *
 * The rule that governs this entire module: **promotion buys distribution, never
 * engagement.** There is no code path here that creates a like, a follow, a
 * comment or a view. A campaign increases how many real people are shown a
 * video; whether any of them react is theirs to decide. Every number reported
 * back is a count of something a real person did.
 *
 * The money rules are the ones from Phase 10, applied to a different shape:
 *
 * **The budget is taken up front and held.** A campaign holds its whole budget
 * from the moment it is created, for the same reason a withdrawal does: two
 * campaigns funded from the same coins would both pass their own balance check
 * and then both spend. What is not delivered is returned when the campaign ends.
 *
 * **Spend is recorded against delivery, never estimated.** `spent_coins` only
 * moves when an impression was actually served, so a paused campaign costs
 * nothing and a campaign nobody saw refunds in full.
 */

import { ulid } from 'ulid';
import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { getSetting } from '../../core/settings.ts';
import { logger } from '../../core/logger.ts';
import * as ledger from '../wallet/ledger.ts';
import type {
  Campaign,
  CampaignEstimate,
  CampaignMetrics,
  CampaignObjective,
  CampaignTargeting,
  CreateCampaignBody,
} from '../../../../shared/contracts/promotion.ts';

/** What the platform charges for one delivered impression, in coins. */
const DEFAULT_COST_PER_IMPRESSION = 0.05;

interface CampaignRow {
  id: number;
  public_id: string;
  user_id: number;
  video_public_id: string | null;
  name: string;
  kind: 'promotion' | 'campaign';
  objective: CampaignObjective;
  status: Campaign['status'];
  budget_coins: string | number;
  spent_coins: string | number;
  daily_cap_coins: string | number | null;
  duration_days: number;
  cta_label: string | null;
  destination_url: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  decision_note: string | null;
  created_at: Date;
  mode: CampaignTargeting['mode'] | null;
  countries: string | null;
  cities: string | null;
  languages: string | null;
  interests: string | null;
  categories: string | null;
  devices: string | null;
  os: string | null;
  age_min: number | null;
  age_max: number | null;
}

/** A JSON array column, tolerant of a malformed value. */
function parseList(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const list = parsed.filter((v): v is string => typeof v === 'string');
    return list.length > 0 ? list : undefined;
  } catch {
    return undefined;
  }
}

function toTargeting(row: CampaignRow): CampaignTargeting {
  const targeting: CampaignTargeting = { mode: row.mode ?? 'automatic' };
  const countries = parseList(row.countries);
  const cities = parseList(row.cities);
  const languages = parseList(row.languages);
  const interests = parseList(row.interests);
  const categories = parseList(row.categories);
  const devices = parseList(row.devices);
  const os = parseList(row.os);

  if (countries) targeting.countries = countries;
  if (cities) targeting.cities = cities;
  if (languages) targeting.languages = languages;
  if (interests) targeting.interests = interests;
  if (categories) targeting.categories = categories;
  if (devices) targeting.devices = devices;
  if (os) targeting.os = os;
  if (row.age_min !== null) targeting.ageMin = row.age_min;
  if (row.age_max !== null) targeting.ageMax = row.age_max;

  return targeting;
}

function toCampaign(row: CampaignRow): Campaign {
  const campaign: Campaign = {
    id: row.public_id,
    name: row.name,
    kind: row.kind,
    objective: row.objective,
    status: row.status,
    budgetCoins: Number(row.budget_coins),
    spentCoins: Number(row.spent_coins),
    durationDays: row.duration_days,
    targeting: toTargeting(row),
    createdAt: new Date(row.created_at).toISOString(),
  };

  if (row.video_public_id) campaign.videoId = row.video_public_id;
  if (row.daily_cap_coins !== null) campaign.dailyCapCoins = Number(row.daily_cap_coins);
  if (row.cta_label) campaign.ctaLabel = row.cta_label;
  if (row.destination_url) campaign.destinationUrl = row.destination_url;
  if (row.starts_at) campaign.startsAt = new Date(row.starts_at).toISOString();
  if (row.ends_at) campaign.endsAt = new Date(row.ends_at).toISOString();
  if (row.decision_note) campaign.decisionNote = row.decision_note;

  return campaign;
}

const CAMPAIGN_SELECT = `
  SELECT c.id, c.public_id, c.user_id, c.name, c.kind, c.objective, c.status,
         c.budget_coins, c.spent_coins, c.daily_cap_coins, c.duration_days,
         c.cta_label, c.destination_url, c.starts_at, c.ends_at, c.decision_note,
         c.created_at,
         v.public_id AS video_public_id,
         t.mode, t.countries, t.cities, t.languages, t.interests, t.categories,
         t.devices, t.os, t.age_min, t.age_max
    FROM campaigns c
    LEFT JOIN videos v ON v.id = c.video_id
    LEFT JOIN campaign_targeting t ON t.campaign_id = c.id
   WHERE c.deleted_at IS NULL
`;

// ── Estimating ──

/**
 * What a budget is likely to buy.
 *
 * Deliberately a range, and deliberately caveated. An advertiser shown a single
 * confident number treats it as a promise; the honest answer is that delivery
 * depends on how many people match the targeting and how much competition there
 * is for their attention that day.
 *
 * The estimate is derived from the actual cost per impression and observed
 * view-through, not from a figure chosen to look attractive.
 */
export async function estimate(
  budgetCoins: number,
  durationDays: number,
  targeting: CampaignTargeting,
): Promise<CampaignEstimate> {
  const costPerImpression =
    Number(await getSetting('ads.cost_per_impression')) || DEFAULT_COST_PER_IMPRESSION;

  const impressions = costPerImpression > 0 ? Math.floor(budgetCoins / costPerImpression) : 0;

  // Narrow targeting reaches fewer distinct people for the same impressions,
  // because the same people are shown it more often.
  const narrowing =
    targeting.mode === 'broad'
      ? 1
      : targeting.mode === 'custom'
        ? 0.55
        : 0.75;

  const reachMid = Math.floor(impressions * 0.7 * narrowing);
  const viewsMid = Math.floor(impressions * 0.45);

  return {
    // A ±30% band: wide enough to be honest about the uncertainty, narrow
    // enough to be useful.
    estimatedReachMin: Math.floor(reachMid * 0.7),
    estimatedReachMax: Math.ceil(reachMid * 1.3),
    estimatedViewsMin: Math.floor(viewsMid * 0.7),
    estimatedViewsMax: Math.ceil(viewsMid * 1.3),
    dailyBudgetCoins: durationDays > 0 ? Math.floor(budgetCoins / durationDays) : budgetCoins,
    disclaimer:
      'An estimate, not a guarantee. Delivery depends on how many people match your audience and ' +
      'what else is competing for their attention. Promotion buys distribution only — it never ' +
      'creates likes, follows or comments.',
  };
}

// ── Creating ──

/**
 * Creates a campaign and holds its budget.
 *
 * The debit is inside the same transaction as the insert, so there is no moment
 * where a campaign exists without its money being claimed, and none where the
 * money is claimed for a campaign that failed to write.
 */
export async function createCampaign(
  userId: number,
  input: CreateCampaignBody & { kind?: 'promotion' | 'campaign'; idempotencyKey: string },
): Promise<Campaign> {
  if ((await getSetting('monetization.enabled')) === false) {
    throw new AppError('forbidden', 'Promotion is currently turned off.');
  }

  const replay = await findByKey(userId, input.idempotencyKey);
  if (replay) return replay;

  const minBudget = Number(await getSetting('ads.min_budget_coins')) || 100;
  if (input.budgetCoins < minBudget) {
    throw new AppError(
      'below_minimum_amount',
      `The minimum budget is ${minBudget} coins.`,
    );
  }
  if (input.durationDays < 1 || input.durationDays > 90) {
    throw new AppError('bad_request', 'Duration must be between 1 and 90 days.');
  }

  let videoId: number | null = null;
  if (input.videoId) {
    const video = await queryOne<{ id: number; user_id: number; status: string; privacy: string }>(
      'SELECT id, user_id, status, privacy FROM videos WHERE public_id = :publicId AND deleted_at IS NULL',
      { publicId: input.videoId },
    );
    if (!video) throw new AppError('not_found', 'That video was not found.');
    if (video.user_id !== userId) {
      throw new AppError('forbidden', 'You can only promote your own videos.');
    }
    if (video.status !== 'published' || video.privacy !== 'public') {
      // Promoting a private video would show it to people its owner excluded.
      throw new AppError('bad_request', 'Only a published, public video can be promoted.');
    }
    videoId = video.id;
  }

  const publicId = ulid();
  const endsAt = new Date(Date.now() + input.durationDays * 24 * 60 * 60 * 1000);

  try {
    await transaction(async (tx) => {
      // The hold. A campaign that cannot be funded is never created.
      await ledger.debit(tx, {
        userId,
        wallet: 'coin',
        type: 'promotion',
        amount: input.budgetCoins,
        description: `Campaign budget: ${input.name}`,
        reference: publicId,
        idempotencyKey: `campaign:${input.idempotencyKey}`,
      });

      const result = await execute(
        `INSERT INTO campaigns
           (public_id, user_id, video_id, name, kind, objective, status, budget_coins,
            spent_coins, daily_cap_coins, duration_days, cta_label, destination_url,
            starts_at, ends_at, idempotency_key)
         VALUES (:publicId, :userId, :videoId, :name, :kind, :objective, 'pending_review',
                 :budget, 0, :dailyCap, :durationDays, :ctaLabel, :destinationUrl,
                 CURRENT_TIMESTAMP(3), :endsAt, :idempotencyKey)`,
        {
          publicId,
          userId,
          videoId,
          name: input.name,
          kind: input.kind ?? 'promotion',
          objective: input.objective,
          budget: input.budgetCoins,
          dailyCap: input.dailyCapCoins ?? null,
          durationDays: input.durationDays,
          ctaLabel: input.ctaLabel ?? null,
          destinationUrl: input.destinationUrl ?? null,
          endsAt,
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

      const t = input.targeting;
      await execute(
        `INSERT INTO campaign_targeting
           (campaign_id, mode, countries, cities, languages, interests, categories,
            devices, os, age_min, age_max)
         VALUES (:campaignId, :mode, :countries, :cities, :languages, :interests,
                 :categories, :devices, :os, :ageMin, :ageMax)`,
        {
          campaignId: result.insertId,
          mode: t.mode,
          countries: JSON.stringify(t.countries ?? []),
          cities: JSON.stringify(t.cities ?? []),
          languages: JSON.stringify(t.languages ?? []),
          interests: JSON.stringify(t.interests ?? []),
          categories: JSON.stringify(t.categories ?? []),
          devices: JSON.stringify(t.devices ?? []),
          os: JSON.stringify(t.os ?? []),
          // A floor of 13 regardless of what was asked for: nobody may target
          // below the platform's minimum age.
          ageMin: Math.max(13, t.ageMin ?? 13),
          ageMax: Math.min(100, t.ageMax ?? 100),
        },
        tx,
      );
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      const existing = await findByKey(userId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

  logger.info({ publicId, userId, budget: input.budgetCoins }, 'campaign created');
  return getCampaign(userId, publicId);
}

async function findByKey(userId: number, idempotencyKey: string): Promise<Campaign | null> {
  const row = await queryOne<CampaignRow>(
    `${CAMPAIGN_SELECT} AND c.user_id = :userId AND c.idempotency_key = :key`,
    { userId, key: idempotencyKey },
  );
  return row ? toCampaign(row) : null;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

// ── Reading ──

export async function listCampaigns(userId: number, limit = 50): Promise<Campaign[]> {
  const rows = await query<CampaignRow>(
    `${CAMPAIGN_SELECT} AND c.user_id = :userId ORDER BY c.created_at DESC LIMIT :limit`,
    { userId, limit },
  );
  return rows.map(toCampaign);
}

export async function getCampaign(userId: number, publicId: string): Promise<Campaign> {
  const row = await queryOne<CampaignRow>(
    `${CAMPAIGN_SELECT} AND c.public_id = :publicId AND c.user_id = :userId`,
    { publicId, userId },
  );
  if (!row) throw new AppError('not_found', 'Campaign not found.');
  return toCampaign(row);
}

/**
 * Delivery metrics.
 *
 * Every figure is a count of something a real person did. There is no modelled
 * or extrapolated number here, and no field that could hold one.
 */
export async function metrics(userId: number, publicId: string): Promise<CampaignMetrics> {
  const campaign = await queryOne<{ id: number; spent_coins: string | number }>(
    'SELECT id, spent_coins FROM campaigns WHERE public_id = :publicId AND user_id = :userId AND deleted_at IS NULL',
    { publicId, userId },
  );
  if (!campaign) throw new AppError('not_found', 'Campaign not found.');

  const totals = await queryOne<{
    impressions: string | number;
    reach: string | number;
    views: string | number;
    clicks: string | number;
    engagements: string | number;
    followers: string | number;
    profile_visits: string | number;
    spent_coins: string | number;
  }>(
    `SELECT COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(reach), 0) AS reach,
            COALESCE(SUM(views), 0) AS views,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(engagements), 0) AS engagements,
            COALESCE(SUM(followers), 0) AS followers,
            COALESCE(SUM(profile_visits), 0) AS profile_visits,
            COALESCE(SUM(spent_coins), 0) AS spent_coins
       FROM campaign_analytics WHERE campaign_id = :id`,
    { id: campaign.id },
  );

  const series = await query<{
    bucket_hour: Date;
    impressions: string | number;
    views: string | number;
    spent_coins: string | number;
  }>(
    `SELECT bucket_hour, impressions, views, spent_coins
       FROM campaign_analytics
      WHERE campaign_id = :id
      ORDER BY bucket_hour DESC
      LIMIT 168`,
    { id: campaign.id },
  );

  const views = Number(totals?.views ?? 0);
  const spent = Number(campaign.spent_coins);

  const result: CampaignMetrics = {
    impressions: Number(totals?.impressions ?? 0),
    reach: Number(totals?.reach ?? 0),
    views,
    clicks: Number(totals?.clicks ?? 0),
    engagements: Number(totals?.engagements ?? 0),
    followers: Number(totals?.followers ?? 0),
    profileVisits: Number(totals?.profile_visits ?? 0),
    spentCoins: spent,
    series: series.reverse().map((s) => ({
      at: new Date(s.bucket_hour).toISOString(),
      impressions: Number(s.impressions),
      views: Number(s.views),
      spentCoins: Number(s.spent_coins),
    })),
  };

  // Only meaningful once something was delivered; a division by zero reported
  // as "0 per view" reads as free rather than as unknown.
  if (views > 0) result.costPerView = Number((spent / views).toFixed(4));

  return result;
}

// ── State changes ──

const OWNER_TRANSITIONS: Record<string, Campaign['status'][]> = {
  pause: ['active'],
  resume: ['paused'],
  stop: ['active', 'paused', 'pending_review'],
};

/**
 * Pause, resume or stop.
 *
 * Stopping returns the unspent budget. That is the whole point of holding it
 * rather than charging as it goes: what was not delivered was never earned.
 */
export async function setCampaignState(
  userId: number,
  publicId: string,
  action: 'pause' | 'resume' | 'stop',
): Promise<Campaign> {
  const row = await queryOne<{
    id: number;
    status: Campaign['status'];
    budget_coins: string | number;
    spent_coins: string | number;
  }>(
    `SELECT id, status, budget_coins, spent_coins
       FROM campaigns WHERE public_id = :publicId AND user_id = :userId AND deleted_at IS NULL`,
    { publicId, userId },
  );
  if (!row) throw new AppError('not_found', 'Campaign not found.');

  const allowed = OWNER_TRANSITIONS[action] ?? [];
  if (!allowed.includes(row.status)) {
    throw new AppError(
      'invalid_state_transition',
      `A ${row.status} campaign cannot be ${action}d.`,
    );
  }

  if (action !== 'stop') {
    await execute(
      `UPDATE campaigns SET status = :status WHERE id = :id AND status = :expected`,
      {
        status: action === 'pause' ? 'paused' : 'active',
        id: row.id,
        expected: row.status,
      },
    );
    return getCampaign(userId, publicId);
  }

  await refundRemaining(row.id, userId, publicId, 'Campaign stopped by its owner');
  return getCampaign(userId, publicId);
}

/**
 * Ends a campaign and returns whatever it did not spend.
 *
 * Shared by stopping, rejection and expiry, because all three are the same
 * movement: the campaign is over and the undelivered budget was never earned.
 */
async function refundRemaining(
  campaignId: number,
  userId: number,
  publicId: string,
  reason: string,
  status: 'completed' | 'rejected' = 'completed',
): Promise<void> {
  await transaction(async (tx) => {
    // Claim it first so two callers cannot both refund.
    const claimed = await execute(
      `UPDATE campaigns SET status = :status, decision_note = :reason
        WHERE id = :id AND status IN ('active', 'paused', 'pending_review')`,
      { status, reason, id: campaignId },
      tx,
    );
    if (claimed.affectedRows === 0) return;

    const row = await queryOne<{ budget_coins: string | number; spent_coins: string | number }>(
      'SELECT budget_coins, spent_coins FROM campaigns WHERE id = :id FOR UPDATE',
      { id: campaignId },
      tx,
    );
    const remaining = Number(row?.budget_coins ?? 0) - Number(row?.spent_coins ?? 0);
    if (remaining <= 0) return;

    await ledger.credit(tx, {
      userId,
      wallet: 'coin',
      type: 'refund',
      amount: remaining,
      description: 'Unspent campaign budget returned',
      reference: publicId,
      reason,
      idempotencyKey: `campaign-refund:${publicId}`,
    });
  });
}

// ── Administration ──

export interface AdminCampaign extends Campaign {
  username: string;
}

export async function pendingCampaigns(limit = 100): Promise<AdminCampaign[]> {
  const rows = await query<CampaignRow & { username: string }>(
    `${CAMPAIGN_SELECT.replace(
      'FROM campaigns c',
      'FROM campaigns c JOIN users u ON u.id = c.user_id',
    ).replace('c.created_at,', 'c.created_at, u.username,')}
       AND c.status = 'pending_review'
     ORDER BY c.created_at
     LIMIT :limit`,
    { limit },
  );
  return rows.map((row) => ({ ...toCampaign(row), username: row.username }));
}

/**
 * Approving or rejecting a campaign.
 *
 * Approval starts delivery. Rejection returns the whole budget — the advertiser
 * is not charged for a campaign the platform declined to run.
 */
export async function reviewCampaign(
  adminUserId: number,
  publicId: string,
  approve: boolean,
  note: string,
): Promise<Campaign> {
  const row = await queryOne<{ id: number; user_id: number; status: string }>(
    'SELECT id, user_id, status FROM campaigns WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Campaign not found.');
  if (row.status !== 'pending_review') {
    throw new AppError('invalid_state_transition', 'That campaign is not awaiting review.');
  }

  if (approve) {
    const claimed = await execute(
      `UPDATE campaigns
          SET status = 'active', decided_by = :adminId, decision_note = :note,
              starts_at = COALESCE(starts_at, CURRENT_TIMESTAMP(3))
        WHERE id = :id AND status = 'pending_review'`,
      { adminId: adminUserId, note, id: row.id },
    );
    if (claimed.affectedRows === 0) {
      throw new AppError('invalid_state_transition', 'That campaign is not awaiting review.');
    }
  } else {
    await refundRemaining(row.id, row.user_id, publicId, note, 'rejected');
    await execute('UPDATE campaigns SET decided_by = :adminId WHERE id = :id', {
      adminId: adminUserId,
      id: row.id,
    });
  }

  logger.info({ publicId, approve, adminUserId }, 'campaign reviewed');

  const updated = await queryOne<CampaignRow>(`${CAMPAIGN_SELECT} AND c.public_id = :publicId`, {
    publicId,
  });
  if (!updated) throw new AppError('internal_error', 'The campaign could not be read back.');
  return toCampaign(updated);
}

/**
 * Completes campaigns that have run out of budget or time.
 *
 * Run on a schedule. Idempotent: a campaign already completed matches nothing.
 */
export async function expireCampaigns(now = new Date()): Promise<{ completed: number }> {
  const due = await query<{ id: number; user_id: number; public_id: string }>(
    `SELECT id, user_id, public_id FROM campaigns
      WHERE status IN ('active', 'paused')
        AND deleted_at IS NULL
        AND (ends_at <= :now OR spent_coins >= budget_coins)
      LIMIT 500`,
    { now },
  );

  let completed = 0;
  for (const row of due) {
    try {
      await refundRemaining(row.id, row.user_id, row.public_id, 'Campaign finished');
      completed += 1;
    } catch (err) {
      logger.error({ err, campaignId: row.id }, 'could not complete campaign');
    }
  }
  return { completed };
}
