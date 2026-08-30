/**
 * Monetization eligibility.
 *
 * Whether an account may start earning is decided here, and it is decided by
 * measurement. Every criterion names a metric, every metric is a count of rows
 * the platform recorded, and nothing an account can assert about itself is
 * consulted.
 *
 * Three rules this module holds to:
 *
 * **The requirements are the operator's, not the code's.** Thresholds, labels,
 * which criteria are enforced at all — every one of those lives in
 * `monetization_criteria` and is editable in the admin panel. This module
 * knows how to *measure* things; it does not know what the bar is.
 *
 * **A metric nobody measures never counts as met.** If a criterion names a
 * metric this module cannot evaluate, it is reported as unmeasurable and it
 * blocks eligibility. Quietly skipping it would hand out earning rights on the
 * strength of a requirement no code ever checked, which is the failure worth
 * being loudest about.
 *
 * **Recomputation never overrides a decision.** Progress is recalculated on
 * every read, but a state a human set — under review, enabled, suspended — is
 * left exactly as it is. Losing a follower must not silently switch off an
 * account an admin approved.
 */

import { query, queryOne, execute } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';

export type MonetizationState = 'locked' | 'eligible' | 'review' | 'enabled' | 'suspended';

export interface CriterionProgress {
  id: string;
  label: string;
  metric: string;
  current: number;
  required: number;
  unit: string | null;
  isBoolean: boolean;
  met: boolean;
  /** False when no code measures this metric — it blocks rather than passes. */
  measurable: boolean;
}

export interface MonetizationStatus {
  state: MonetizationState;
  /** 0–100, averaged across criteria so partial progress on each one shows. */
  progress: number;
  criteriaMet: number;
  criteria: CriterionProgress[];
  /** True when every enforced criterion is met and no decision has been made yet. */
  canApply: boolean;
  appliedAt: string | null;
  enabledAt: string | null;
  reviewNote: string | null;
  /** Set when a criterion names a metric nothing measures — an operator error. */
  unmeasurable: string[];
}

/**
 * The metrics a criterion may be measured by.
 *
 * Adding a key here is what makes it usable in the admin panel; the create
 * route validates against this list so a typo is refused at the point it is
 * made rather than silently blocking every creator later.
 */
export const MONETIZATION_METRICS = [
  'followers',
  'videos_published',
  'views_30d',
  'watch_minutes_30d',
  'account_age_days',
  'email_verified',
  'no_active_restriction',
] as const;

export type MonetizationMetric = (typeof MONETIZATION_METRICS)[number];

export function isMonetizationMetric(value: string): value is MonetizationMetric {
  return (MONETIZATION_METRICS as readonly string[]).includes(value);
}

interface CriterionRow {
  criterion_key: string;
  label: string;
  metric: string;
  required: number;
  unit: string | null;
  is_boolean: number;
}

/**
 * Every measurement for one account, in one pass.
 *
 * Taken together rather than per criterion: two criteria on the same metric —
 * a starter threshold and a higher one, say — must not produce two different
 * numbers because they were counted a moment apart.
 */
async function measure(userId: number): Promise<Record<MonetizationMetric, number>> {
  const [profile, videos, recent, account, restriction] = await Promise.all([
    queryOne<{ followers: number }>(
      'SELECT follower_count AS followers FROM user_profiles WHERE user_id = :userId',
      { userId },
    ),
    queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM videos
        WHERE user_id = :userId AND deleted_at IS NULL AND status = 'published'`,
      { userId },
    ),
    queryOne<{ views: number; watch_ms: number }>(
      `SELECT COUNT(*) AS views, COALESCE(SUM(watch_ms), 0) AS watch_ms
         FROM watch_events
        WHERE creator_id = :userId AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      { userId },
    ),
    queryOne<{ age_days: number; verified: number }>(
      `SELECT DATEDIFF(CURDATE(), DATE(created_at)) AS age_days,
              CASE WHEN email_verified_at IS NULL THEN 0 ELSE 1 END AS verified
         FROM users WHERE id = :userId`,
      { userId },
    ),
    // A restriction still in force: not reverted, and either open-ended or not
    // yet expired. An expired suspension is not a restriction any more.
    queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM moderation_actions
        WHERE target_type = 'user' AND target_id = :userId
          AND action IN ('temporary_restriction','suspension','permanent_ban','restrict_distribution')
          AND reverted_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW(3))`,
      { userId },
    ),
  ]);

  return {
    followers: Number(profile?.followers ?? 0),
    videos_published: Number(videos?.c ?? 0),
    views_30d: Number(recent?.views ?? 0),
    watch_minutes_30d: Math.floor(Number(recent?.watch_ms ?? 0) / 60_000),
    account_age_days: Math.max(0, Number(account?.age_days ?? 0)),
    email_verified: Number(account?.verified ?? 0),
    no_active_restriction: Number(restriction?.c ?? 0) === 0 ? 1 : 0,
  };
}

/**
 * The account's standing against the requirements in force right now.
 *
 * Writes the computed progress back to `user_monetization` so the admin
 * queue can sort by it, but never writes the state over a decided one.
 */
export async function monetizationStatus(userId: number): Promise<MonetizationStatus> {
  const [rows, existing, measured] = await Promise.all([
    query<CriterionRow>(
      `SELECT criterion_key, label, metric, required, unit, is_boolean
         FROM monetization_criteria WHERE is_enabled = 1 ORDER BY sort_order, id`,
    ),
    queryOne<{
      state: MonetizationState;
      applied_at: Date | null;
      enabled_at: Date | null;
      review_note: string | null;
    }>(
      'SELECT state, applied_at, enabled_at, review_note FROM user_monetization WHERE user_id = :userId',
      { userId },
    ),
    measure(userId),
  ]);

  const unmeasurable: string[] = [];

  const criteria: CriterionProgress[] = rows.map((row) => {
    const measurable = isMonetizationMetric(row.metric);
    if (!measurable) unmeasurable.push(row.metric);

    const current = measurable ? measured[row.metric as MonetizationMetric] : 0;
    const required = Number(row.required);

    return {
      id: row.criterion_key,
      label: row.label,
      metric: row.metric,
      current,
      required,
      unit: row.unit,
      isBoolean: row.is_boolean === 1,
      met: measurable && current >= required,
      measurable,
    };
  });

  const criteriaMet = criteria.filter((c) => c.met).length;

  /*
   * Progress averages each criterion's own completion rather than counting
   * whole requirements. Someone at 999 of 1,000 followers with everything else
   * done has all but finished, and "0 of 1 met" on that row would tell them
   * nothing about how close they are.
   */
  const progress =
    criteria.length === 0
      ? 0
      : Math.round(
          (criteria.reduce(
            (sum, c) => sum + (c.required > 0 ? Math.min(1, c.current / c.required) : 1),
            0,
          ) /
            criteria.length) *
            100,
        );

  const allMet = criteria.length > 0 && criteriaMet === criteria.length;
  const decided = existing?.state === 'review' || existing?.state === 'enabled' || existing?.state === 'suspended';

  // Only the computed half of the state machine moves here.
  const state: MonetizationState = decided ? existing!.state : allMet ? 'eligible' : 'locked';

  await execute(
    `INSERT INTO user_monetization (user_id, state, progress, criteria_met)
     VALUES (:userId, :state, :progress, :criteriaMet)
     ON DUPLICATE KEY UPDATE progress = VALUES(progress), criteria_met = VALUES(criteria_met),
                             state = IF(state IN ('review','enabled','suspended'), state, VALUES(state))`,
    { userId, state, progress, criteriaMet },
  );

  return {
    state,
    progress,
    criteriaMet,
    criteria,
    canApply: allMet && !decided,
    appliedAt: existing?.applied_at ? new Date(existing.applied_at).toISOString() : null,
    enabledAt: existing?.enabled_at ? new Date(existing.enabled_at).toISOString() : null,
    reviewNote: existing?.review_note ?? null,
    unmeasurable: [...new Set(unmeasurable)],
  };
}

/**
 * Applying for monetization.
 *
 * The requirements are re-measured here rather than trusted from whatever the
 * screen last showed — the app cannot be the thing that decides an account has
 * qualified. Applying twice is not an error; the second one finds the account
 * already in review and says so.
 */
export async function applyForMonetization(userId: number): Promise<MonetizationStatus> {
  const status = await monetizationStatus(userId);

  if (status.state === 'review') return status;
  if (status.state === 'enabled') {
    throw new AppError('conflict', 'Monetization is already enabled on this account.');
  }
  if (status.state === 'suspended') {
    throw new AppError('forbidden', 'Monetization is suspended on this account.');
  }
  if (status.unmeasurable.length > 0) {
    throw new AppError(
      'dependency_unavailable',
      'A monetization requirement cannot currently be checked. Support has been notified.',
    );
  }
  if (!status.canApply) {
    const short = status.criteria.filter((c) => !c.met).length;
    throw new AppError(
      'validation_failed',
      `${short} requirement${short === 1 ? '' : 's'} still to go.`,
    );
  }

  await execute(
    `INSERT INTO user_monetization (user_id, state, progress, criteria_met, applied_at)
     VALUES (:userId, 'review', :progress, :criteriaMet, NOW(3))
     ON DUPLICATE KEY UPDATE state = 'review', applied_at = COALESCE(applied_at, NOW(3)),
                             progress = VALUES(progress), criteria_met = VALUES(criteria_met)`,
    { userId, progress: status.progress, criteriaMet: status.criteriaMet },
  );

  /*
   * Read the stored row back rather than describing what was just written.
   * `applied_at` is set by `NOW(3)` and preserved by COALESCE on a re-apply,
   * so a client-side `new Date()` here would differ from the truth by however
   * long the round trip took — and on the second apply it would report the
   * moment of the retry as the moment the account joined the queue.
   */
  return monetizationStatus(userId);
}
