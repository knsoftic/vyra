/**
 * Progressive distribution rules.
 *
 * Pure policy: the levels, their thresholds, and the decision function. Kept
 * free of database imports so the rules that decide who sees a video can be
 * tested exactly, with no infrastructure and no ambiguity about what produced a
 * given verdict.
 *
 * `distribution.ts` applies these decisions and records them.
 */

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

export interface LevelThreshold {
  level: number;
  label: string;
  /** Impressions needed before the level can be judged at all. */
  minImpressions: number;
  /** Completion rate required to move up from this level. */
  minCompletionRate: number;
  /** Engagement rate required to move up. */
  minEngagementRate: number;
  /** Above this quick-skip rate, the video moves down instead. */
  maxQuickSkipRate: number;
}

/**
 * Defaults. Deliberately gentle at L1 and demanding at L4.
 *
 * The sample sizes rise with the level because the cost of a wrong promotion
 * rises with it: sending a mediocre video to a hundred people is a small waste,
 * sending it to the whole platform is not.
 */
export const LEVEL_THRESHOLDS: readonly LevelThreshold[] = [
  { level: 1, label: 'Test audience', minImpressions: 50, minCompletionRate: 0.25, minEngagementRate: 0.02, maxQuickSkipRate: 0.7 },
  { level: 2, label: 'Similar audience', minImpressions: 300, minCompletionRate: 0.28, minEngagementRate: 0.025, maxQuickSkipRate: 0.65 },
  { level: 3, label: 'Category audience', minImpressions: 1500, minCompletionRate: 0.3, minEngagementRate: 0.03, maxQuickSkipRate: 0.6 },
  { level: 4, label: 'Broad For You', minImpressions: 10_000, minCompletionRate: 0.35, minEngagementRate: 0.04, maxQuickSkipRate: 0.55 },
  { level: 5, label: 'Trending', minImpressions: 100_000, minCompletionRate: 0.4, minEngagementRate: 0.05, maxQuickSkipRate: 0.5 },
];

export interface PerformanceMetrics {
  impressions: number;
  views: number;
  completions: number;
  quickSkips: number;
  engagements: number;
}

export interface PerformanceRates {
  completionRate: number;
  engagementRate: number;
  quickSkipRate: number;
}

export type DistributionDecision = 'promoted' | 'demoted' | 'held' | 'suppressed';

export interface DistributionVerdict {
  decision: DistributionDecision;
  fromLevel: number;
  toLevel: number;
  reason: string;
  rates: PerformanceRates;
}

const safeRate = (numerator: number, denominator: number): number => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
};

/** Rates from raw counters, guarding against division by zero. */
export function computeRates(metrics: PerformanceMetrics): PerformanceRates {
  return {
    // Completion is measured against views, not impressions: a video scrolled
    // past was never given the chance to be completed.
    completionRate: safeRate(metrics.completions, metrics.views),
    engagementRate: safeRate(metrics.engagements, metrics.impressions),
    quickSkipRate: safeRate(metrics.quickSkips, metrics.impressions),
  };
}

/**
 * Decides whether a video moves.
 *
 * Order matters: suppression beats demotion beats promotion, so a video with an
 * awful skip rate goes down even if its completion rate would have promoted it.
 */
export function evaluate(
  currentLevel: number,
  metrics: PerformanceMetrics,
  thresholds: readonly LevelThreshold[] = LEVEL_THRESHOLDS,
): DistributionVerdict {
  const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(currentLevel) || MIN_LEVEL));
  const rates = computeRates(metrics);
  const threshold = thresholds.find((t) => t.level === level) ?? thresholds[0]!;

  const base = { fromLevel: level, rates };

  // Not enough data yet — holding is the honest answer, not a guess.
  if (metrics.impressions < threshold.minImpressions) {
    return {
      ...base,
      decision: 'held',
      toLevel: level,
      reason: `Only ${metrics.impressions} of ${threshold.minImpressions} impressions needed to judge level ${level}.`,
    };
  }

  if (rates.quickSkipRate > threshold.maxQuickSkipRate) {
    const toLevel = Math.max(MIN_LEVEL, level - 1);
    return {
      ...base,
      decision: level > MIN_LEVEL ? 'demoted' : 'suppressed',
      toLevel,
      reason: `Quick-skip rate ${rates.quickSkipRate} exceeds the ${threshold.maxQuickSkipRate} limit for level ${level}.`,
    };
  }

  const meetsCompletion = rates.completionRate >= threshold.minCompletionRate;
  const meetsEngagement = rates.engagementRate >= threshold.minEngagementRate;

  if (meetsCompletion && meetsEngagement) {
    if (level >= MAX_LEVEL) {
      return { ...base, decision: 'held', toLevel: level, reason: 'Already at the highest level.' };
    }
    return {
      ...base,
      decision: 'promoted',
      toLevel: level + 1,
      reason: `Completion ${rates.completionRate} and engagement ${rates.engagementRate} both cleared level ${level}.`,
    };
  }

  // Performing below its level after a real sample: step back down.
  const badlyShort =
    rates.completionRate < threshold.minCompletionRate * 0.6 ||
    rates.engagementRate < threshold.minEngagementRate * 0.5;

  if (badlyShort && level > MIN_LEVEL) {
    return {
      ...base,
      decision: 'demoted',
      toLevel: level - 1,
      reason: `Completion ${rates.completionRate} and engagement ${rates.engagementRate} fell well short of level ${level}.`,
    };
  }

  return {
    ...base,
    decision: 'held',
    toLevel: level,
    reason: meetsCompletion
      ? `Engagement ${rates.engagementRate} is below the ${threshold.minEngagementRate} needed to advance.`
      : `Completion ${rates.completionRate} is below the ${threshold.minCompletionRate} needed to advance.`,
  };
}

