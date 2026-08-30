/**
 * Ad delivery.
 *
 * Picking which promoted videos a person sees, and charging for the ones that
 * were actually shown.
 *
 * **Charging follows delivery, never precedes it.** A campaign is charged when
 * an impression is recorded, and `campaign_impressions` carries the feed's own
 * impression id under a unique key — so a replayed signal is recognised as the
 * same delivery rather than billed again. An advertiser paying twice for showing
 * one person one video is the failure this table exists to prevent.
 *
 * **A campaign cannot outspend its budget or its daily cap.** Both are checked
 * inside the charging transaction against the row as it stands, not against a
 * value read earlier.
 *
 * **Promotion buys distribution only.** Selecting a video for a slot is the
 * entire product. Nothing here likes, follows, comments or inflates a view
 * count; the only counters that move are counts of what really happened.
 *
 * **Every promoted item is labelled.** `isPromoted` travels with the item all
 * the way to the client, and the client shows it. Blending paid placement into
 * organic content without saying so is the thing this whole design refuses to
 * do.
 */

import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { getSetting } from '../../core/settings.ts';
import { logger } from '../../core/logger.ts';

export interface PromotedCandidate {
  campaignId: number;
  campaignPublicId: string;
  videoId: number;
  advertiserId: number;
  objective: string;
  ctaLabel: string | null;
  destinationUrl: string | null;
}

export interface ViewerContext {
  userId: number;
  countryCode?: string | null;
  language?: string | null;
  age?: number | null;
  interests?: string[];
}

/**
 * Campaigns eligible to be shown to this viewer.
 *
 * Targeting is applied as a filter, never as a ranking boost — a campaign
 * either matches the audience or it does not. An empty targeting list means "no
 * restriction on this dimension", which is what makes broad targeting the
 * default rather than something that has to be spelled out.
 *
 * The advertiser's own account is excluded: paying to show a video to yourself
 * is a way to burn budget by accident, not a use case.
 */
export async function eligibleCampaigns(
  viewer: ViewerContext,
  limit = 20,
): Promise<PromotedCandidate[]> {
  if ((await getSetting('ads.enabled')) === false) return [];

  const frequencyCap = Number(await getSetting('ads.frequency_cap_per_day')) || 4;

  const rows = await query<{
    id: number;
    public_id: string;
    video_id: number;
    user_id: number;
    objective: string;
    cta_label: string | null;
    destination_url: string | null;
  }>(
    `SELECT c.id, c.public_id, c.video_id, c.user_id, c.objective,
            c.cta_label, c.destination_url
       FROM campaigns c
       JOIN videos v ON v.id = c.video_id
       LEFT JOIN campaign_targeting t ON t.campaign_id = c.id
      WHERE c.status = 'active'
        AND c.deleted_at IS NULL
        AND c.spent_coins < c.budget_coins
        AND (c.starts_at IS NULL OR c.starts_at <= CURRENT_TIMESTAMP(3))
        AND (c.ends_at IS NULL OR c.ends_at > CURRENT_TIMESTAMP(3))
        -- The video must still be publishable in its own right. A campaign
        -- cannot keep a deleted or privated video in circulation.
        AND v.deleted_at IS NULL
        AND v.status = 'published'
        AND v.privacy = 'public'
        AND v.processing_status = 'complete'
        -- Never to the advertiser themselves.
        AND c.user_id <> :userId
        -- Never to someone either party has blocked.
        AND NOT EXISTS (
              SELECT 1 FROM blocks b
               WHERE b.deleted_at IS NULL
                 AND ((b.blocker_id = :userId AND b.blocked_id = c.user_id)
                   OR (b.blocker_id = c.user_id AND b.blocked_id = :userId)))
        -- Frequency cap: the same campaign is not shown to one person all day.
        AND (SELECT COUNT(*) FROM campaign_impressions ci
              WHERE ci.campaign_id = c.id AND ci.user_id = :userId
                AND ci.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY))
            < :frequencyCap
        -- Targeting. An empty list means no restriction on that dimension, so
        -- JSON_LENGTH = 0 passes everyone.
        AND (t.countries IS NULL OR JSON_LENGTH(t.countries) = 0
             OR (:country IS NOT NULL AND JSON_CONTAINS(t.countries, JSON_QUOTE(:country))))
        AND (t.languages IS NULL OR JSON_LENGTH(t.languages) = 0
             OR (:language IS NOT NULL AND JSON_CONTAINS(t.languages, JSON_QUOTE(:language))))
        AND (:age IS NULL OR t.age_min IS NULL OR :age >= t.age_min)
        AND (:age IS NULL OR t.age_max IS NULL OR :age <= t.age_max)
      ORDER BY (c.budget_coins - c.spent_coins) DESC, c.created_at
      LIMIT :limit`,
    {
      userId: viewer.userId,
      frequencyCap,
      country: viewer.countryCode ?? null,
      language: viewer.language ?? null,
      age: viewer.age ?? null,
      limit,
    },
  ).catch((err: unknown) => {
    // Delivery failing must not take the feed with it: a page of organic
    // content is a working product, a 500 is not.
    logger.error({ err, userId: viewer.userId }, 'could not select promoted candidates');
    return [];
  });

  return rows.map((row) => ({
    campaignId: row.id,
    campaignPublicId: row.public_id,
    videoId: row.video_id,
    advertiserId: row.user_id,
    objective: row.objective,
    ctaLabel: row.cta_label,
    destinationUrl: row.destination_url,
  }));
}

/**
 * How many promoted slots a page of this size may carry.
 *
 * Density is configuration and is a ceiling, not a target: if fewer campaigns
 * are eligible the page is simply more organic. There is no filling of unsold
 * inventory with paid-looking content.
 */
export async function promotedSlotCount(pageSize: number): Promise<number> {
  const density = Number(await getSetting('ads.feed_density'));
  const safe = Number.isFinite(density) ? Math.min(Math.max(density, 0), 0.5) : 0.15;
  return Math.floor(pageSize * safe);
}

/**
 * Places promoted items into a page.
 *
 * Never in the first position. The first thing someone sees when they open the
 * app should be something chosen for them, not something bought — and a feed
 * that opens on an advertisement is one people stop opening.
 */
export function blend<T>(organic: T[], promoted: T[]): T[] {
  if (promoted.length === 0) return organic;

  const result = [...organic];
  const spacing = Math.max(3, Math.floor(organic.length / (promoted.length + 1)));

  let inserted = 0;
  for (const item of promoted) {
    const at = spacing * (inserted + 1) + inserted;
    if (at > result.length) break;
    result.splice(at, 0, item);
    inserted += 1;
  }
  return result;
}

export interface ChargeResult {
  charged: number;
  /** Impressions that were already recorded and therefore not charged again. */
  duplicates: number;
}

/**
 * Records delivery and charges for it.
 *
 * The unique key on (campaign, user, impression) does the deduplication, so a
 * retried or replayed signal costs nothing. Budget and daily cap are both
 * re-read inside the transaction, so a campaign cannot be pushed past either by
 * concurrent deliveries.
 */
export async function chargeImpressions(
  deliveries: { campaignId: number; userId: number; impressionId: string }[],
): Promise<ChargeResult> {
  if (deliveries.length === 0) return { charged: 0, duplicates: 0 };

  const costPerImpression = Number(await getSetting('ads.cost_per_impression')) || 0;
  if (costPerImpression <= 0) return { charged: 0, duplicates: 0 };

  let charged = 0;
  let duplicates = 0;

  for (const delivery of deliveries) {
    try {
      const result = await transaction(async (tx) => {
        // Claim the impression first. A duplicate loses here and costs nothing.
        const claimed = await execute(
          `INSERT IGNORE INTO campaign_impressions
             (campaign_id, user_id, impression_id, charged_coins)
           VALUES (:campaignId, :userId, :impressionId, :cost)`,
          {
            campaignId: delivery.campaignId,
            userId: delivery.userId,
            impressionId: delivery.impressionId,
            cost: costPerImpression,
          },
          tx,
        );
        if (claimed.affectedRows === 0) return 'duplicate' as const;

        const campaign = await queryOne<{
          budget_coins: string | number;
          spent_coins: string | number;
          daily_cap_coins: string | number | null;
          status: string;
        }>(
          `SELECT budget_coins, spent_coins, daily_cap_coins, status
             FROM campaigns WHERE id = :id FOR UPDATE`,
          { id: delivery.campaignId },
          tx,
        );
        if (!campaign || campaign.status !== 'active') return 'skipped' as const;

        const budget = Number(campaign.budget_coins);
        const spent = Number(campaign.spent_coins);
        if (spent + costPerImpression > budget) {
          // The budget ran out between selection and charging. The impression
          // was already served, so it is recorded — at zero, because the
          // advertiser did not agree to spend more than their budget.
          await execute(
            `UPDATE campaign_impressions SET charged_coins = 0
              WHERE campaign_id = :campaignId AND user_id = :userId
                AND impression_id = :impressionId`,
            delivery,
            tx,
          );
          return 'over_budget' as const;
        }

        // Daily cap, measured from the impressions actually charged today.
        const cap = campaign.daily_cap_coins === null ? null : Number(campaign.daily_cap_coins);
        if (cap !== null && cap > 0) {
          const today = await queryOne<{ spent: string | number }>(
            `SELECT COALESCE(SUM(charged_coins), 0) AS spent
               FROM campaign_impressions
              WHERE campaign_id = :campaignId
                AND created_at >= CURRENT_DATE()`,
            { campaignId: delivery.campaignId },
            tx,
          );
          if (Number(today?.spent ?? 0) > cap) {
            await execute(
              `UPDATE campaign_impressions SET charged_coins = 0
                WHERE campaign_id = :campaignId AND user_id = :userId
                  AND impression_id = :impressionId`,
              delivery,
              tx,
            );
            return 'capped' as const;
          }
        }

        await execute(
          'UPDATE campaigns SET spent_coins = spent_coins + :cost WHERE id = :id',
          { cost: costPerImpression, id: delivery.campaignId },
          tx,
        );

        // Hourly rollup for the advertiser's chart.
        await execute(
          `INSERT INTO campaign_analytics
             (campaign_id, bucket_hour, impressions, reach, spent_coins)
           VALUES (:campaignId, DATE_FORMAT(CURRENT_TIMESTAMP(3), '%Y-%m-%d %H:00:00'), 1, 1, :cost)
           ON DUPLICATE KEY UPDATE
             impressions = impressions + 1,
             spent_coins = spent_coins + :cost`,
          { campaignId: delivery.campaignId, cost: costPerImpression },
          tx,
        );

        return 'charged' as const;
      });

      if (result === 'charged') charged += 1;
      else if (result === 'duplicate') duplicates += 1;
    } catch (err) {
      // One failed charge must not stop the batch, and must not fail the feed
      // that produced it.
      logger.error({ err, delivery }, 'could not charge impression');
    }
  }

  return { charged, duplicates };
}

/**
 * Records that a promoted video was actually watched.
 *
 * A view is a different event from an impression and is charged separately for
 * view objectives. `viewed_at` is set once — a viewer rewatching does not cost
 * the advertiser again for the same delivery.
 */
export async function recordView(
  campaignId: number,
  userId: number,
  impressionId: string,
): Promise<{ charged: boolean }> {
  const costPerView = Number(await getSetting('ads.cost_per_view')) || 0;

  try {
    return await transaction(async (tx) => {
      const claimed = await execute(
        `UPDATE campaign_impressions SET viewed_at = CURRENT_TIMESTAMP(3)
          WHERE campaign_id = :campaignId AND user_id = :userId
            AND impression_id = :impressionId AND viewed_at IS NULL`,
        { campaignId, userId, impressionId },
        tx,
      );
      if (claimed.affectedRows === 0) return { charged: false };

      const campaign = await queryOne<{
        budget_coins: string | number;
        spent_coins: string | number;
        objective: string;
        status: string;
      }>(
        'SELECT budget_coins, spent_coins, objective, status FROM campaigns WHERE id = :id FOR UPDATE',
        { id: campaignId },
        tx,
      );
      if (!campaign || campaign.status !== 'active') return { charged: false };

      // Only view-priced objectives pay for a view; the rest already paid for
      // the impression that produced it.
      const viewPriced = ['video_views', 'engagement'].includes(campaign.objective);
      const cost = viewPriced ? costPerView : 0;

      const remaining = Number(campaign.budget_coins) - Number(campaign.spent_coins);
      const chargeable = Math.min(cost, Math.max(0, remaining));

      if (chargeable > 0) {
        await execute(
          'UPDATE campaigns SET spent_coins = spent_coins + :cost WHERE id = :id',
          { cost: chargeable, id: campaignId },
          tx,
        );
      }

      await execute(
        `INSERT INTO campaign_analytics
           (campaign_id, bucket_hour, views, spent_coins)
         VALUES (:campaignId, DATE_FORMAT(CURRENT_TIMESTAMP(3), '%Y-%m-%d %H:00:00'), 1, :cost)
         ON DUPLICATE KEY UPDATE views = views + 1, spent_coins = spent_coins + :cost`,
        { campaignId, cost: chargeable },
        tx,
      );

      return { charged: chargeable > 0 };
    });
  } catch (err) {
    logger.error({ err, campaignId, impressionId }, 'could not record promoted view');
    return { charged: false };
  }
}

/**
 * Records a click on the campaign's call to action.
 *
 * Not charged — the impression already was. This exists so the advertiser can
 * see whether their destination is worth the traffic, which is a measurement,
 * not a second billing event.
 */
export async function recordClick(
  campaignId: number,
  userId: number,
  impressionId: string,
): Promise<{ recorded: boolean }> {
  try {
    const claimed = await execute(
      `UPDATE campaign_impressions SET clicked_at = CURRENT_TIMESTAMP(3)
        WHERE campaign_id = :campaignId AND user_id = :userId
          AND impression_id = :impressionId AND clicked_at IS NULL`,
      { campaignId, userId, impressionId },
    );
    if (claimed.affectedRows === 0) return { recorded: false };

    await execute(
      `INSERT INTO campaign_analytics
         (campaign_id, bucket_hour, clicks)
       VALUES (:campaignId, DATE_FORMAT(CURRENT_TIMESTAMP(3), '%Y-%m-%d %H:00:00'), 1)
       ON DUPLICATE KEY UPDATE clicks = clicks + 1`,
      { campaignId },
    );
    return { recorded: true };
  } catch (err) {
    logger.error({ err, campaignId }, 'could not record promoted click');
    return { recorded: false };
  }
}
