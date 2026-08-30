/**
 * Scoring.
 *
 * Two rankers, and the relationship between them is the important part.
 *
 * The **ML ranker** is a Python service that predicts engagement probabilities.
 * The **rules ranker** is this file: a weighted sum over signals we already have.
 *
 * The rules ranker is not a stub. It is the production fallback, and PHASE_07
 * exit criterion 2 requires that killing the ML service degrades to it with no
 * user-visible failure. A feed that returns an error because a model host is
 * down is worse than a feed that is slightly less personalised, so the rules
 * path has to be genuinely good — not merely present.
 *
 * Everything here is pure arithmetic over a candidate's features, so the whole
 * ranking can be tested exactly and any single score can be explained.
 */

import type { Weights } from './weights.ts';

/**
 * What we know about a candidate before scoring.
 *
 * Probabilities are 0..1. Everything else is normalised to 0..1 as well, so a
 * weight means the same thing wherever it is applied.
 */
export interface CandidateFeatures {
  videoId: number;
  creatorId: number;
  categoryId: number | null;
  /** Which pool retrieved it, for explanation and diversity. */
  pool: string;
  /** Agreement with the viewer's interest profile, 0..1. */
  interestMatch: number;
  /** Viewer's affinity with this creator, normalised to 0..1. */
  creatorAffinity: number;
  /** Recency, 1 at publication decaying over hours. */
  freshness: number;
  /** Platform-wide momentum, 0..1. */
  trending: number;
  /** Technical quality, 0..1. Capped in influence by ADR-011. */
  quality: number;
  /** Times the viewer has already been shown this. */
  seenCount: number;
  /** True when the creator has no established audience. */
  isNewCreator: boolean;
  /** Predicted probabilities. The rules ranker derives them; ML overrides them. */
  predictions: Predictions;
}

export interface Predictions {
  watch: number;
  completion: number;
  rewatch: number;
  like: number;
  comment: number;
  share: number;
  save: number;
  follow: number;
  profileVisit: number;
  quickSkip: number;
  notInterested: number;
  hide: number;
  report: number;
}

export const NEUTRAL_PREDICTIONS: Predictions = {
  watch: 0.5, completion: 0.3, rewatch: 0.05,
  like: 0.05, comment: 0.01, share: 0.01, save: 0.02,
  follow: 0.01, profileVisit: 0.02,
  quickSkip: 0.2, notInterested: 0.01, hide: 0.005, report: 0.001,
};

export interface ScoredCandidate extends CandidateFeatures {
  /** 0..100. What the ordering is done by. */
  score: number;
  /** Per-component contributions, so any placement can be explained. */
  breakdown: Record<string, number>;
  /** Which ranker produced this. */
  ranker: 'ml' | 'rules';
}

const clamp01 = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

/**
 * Estimates engagement probabilities from the signals we already have.
 *
 * This is what stands in for the model when it is unavailable. The estimates are
 * intentionally conservative — closer to the population average than a confident
 * model would be — because a wrong confident guess is worse than a mild one.
 */
export function predictFromRules(features: CandidateFeatures): Predictions {
  const interest = clamp01(features.interestMatch);
  const affinity = clamp01(features.creatorAffinity);
  const relevance = clamp01(interest * 0.6 + affinity * 0.4);

  // Someone who has engaged with this creator before is much more likely to
  // engage again — that is the single most predictive thing available here.
  return {
    watch: clamp01(0.35 + relevance * 0.5),
    completion: clamp01(0.15 + relevance * 0.45),
    rewatch: clamp01(0.02 + relevance * 0.12),
    like: clamp01(0.02 + relevance * 0.16),
    comment: clamp01(0.005 + relevance * 0.04),
    share: clamp01(0.005 + relevance * 0.035),
    save: clamp01(0.01 + relevance * 0.06),
    follow: clamp01(0.003 + affinity * 0.05),
    profileVisit: clamp01(0.01 + affinity * 0.07),
    // Negative predictions move opposite to relevance.
    quickSkip: clamp01(0.4 - relevance * 0.3),
    notInterested: clamp01(0.03 - relevance * 0.025),
    hide: clamp01(0.01 - relevance * 0.008),
    report: 0.001,
  };
}

/**
 * The FYP distribution score, 0–100.
 *
 * A weighted sum of positives minus weighted negatives, squashed into 0..100.
 * The breakdown is returned alongside because an unexplainable ranking decision
 * cannot be debugged, tuned, or defended to a creator asking why their video
 * stopped being shown.
 */
export function scoreCandidate(
  features: CandidateFeatures,
  weights: Weights,
  ranker: 'ml' | 'rules' = 'rules',
): ScoredCandidate {
  const p = features.predictions;
  const w = (key: string, fallback = 0): number => {
    const value = weights[key];
    return Number.isFinite(value) ? (value as number) : fallback;
  };

  const breakdown: Record<string, number> = {
    watch: clamp01(p.watch) * w('w_watch'),
    completion: clamp01(p.completion) * w('w_completion'),
    rewatch: clamp01(p.rewatch) * w('w_rewatch'),
    like: clamp01(p.like) * w('w_like'),
    comment: clamp01(p.comment) * w('w_comment'),
    share: clamp01(p.share) * w('w_share'),
    save: clamp01(p.save) * w('w_save'),
    follow: clamp01(p.follow) * w('w_follow'),
    profileVisit: clamp01(p.profileVisit) * w('w_profile_visit'),
    interestMatch: clamp01(features.interestMatch) * w('w_interest_match'),
    creatorAffinity: clamp01(features.creatorAffinity) * w('w_creator_affinity'),
    freshness: clamp01(features.freshness) * w('w_freshness'),
    trending: clamp01(features.trending) * w('w_trending'),
    // Deliberately the smallest positive contribution available (ADR-011).
    quality: clamp01(features.quality) * w('w_quality'),
  };

  const penalties: Record<string, number> = {
    quickSkip: clamp01(p.quickSkip) * w('p_quick_skip'),
    notInterested: clamp01(p.notInterested) * w('p_not_interested'),
    hide: clamp01(p.hide) * w('p_hide'),
    report: clamp01(p.report) * w('p_report'),
    // Growing, not flat: a second showing is a nudge, a fifth is a problem.
    repetition: features.seenCount > 0
      ? Math.min(features.seenCount, 5) * w('p_repetition')
      : 0,
  };

  for (const [key, value] of Object.entries(penalties)) {
    breakdown[`penalty_${key}`] = -value;
  }

  const positive = Object.values(breakdown).filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const negative = Object.values(penalties).reduce((a, b) => a + b, 0);
  const raw = positive - negative;

  // Squashed rather than linearly rescaled: the weights are admin-tunable, so
  // the achievable maximum moves, and a linear map would silently change what a
  // given score means every time someone edited a weight.
  const score = Math.round(100 * (1 / (1 + Math.exp(-raw / 4))) * 100) / 100;

  return { ...features, score, breakdown, ranker };
}

/** Scores and orders a candidate set. */
export function rankCandidates(
  candidates: CandidateFeatures[],
  weights: Weights,
  ranker: 'ml' | 'rules' = 'rules',
): ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, weights, ranker))
    .sort((a, b) => b.score - a.score);
}

/**
 * Interest agreement between a viewer's profile and a video's category.
 *
 * A topic the viewer has actively rejected returns 0, not a small positive —
 * "never seen" and "explicitly refused" must not look the same to the ranker.
 */
export function interestMatchFor(
  interests: Record<string, number>,
  categorySlug: string | null,
): number {
  if (!categorySlug) return 0.3; // Uncategorised: neither favoured nor punished.
  const weight = interests[categorySlug];
  if (weight === undefined) return 0.25;
  if (weight <= 0) return 0;

  const strongest = Math.max(...Object.values(interests).filter((v) => v > 0), 1);
  return clamp01(weight / strongest);
}

/**
 * Recency, decaying by half every `halfLifeHours`.
 *
 * Rounded to four decimals like the other scoring helpers, so a value is stable
 * and comparable rather than carrying floating-point noise from the elapsed
 * milliseconds. A future timestamp — clock skew on the publishing host — is
 * treated as brand new rather than producing a value above 1.
 */
export function freshnessFor(publishedAt: Date | string, halfLifeHours = 48): number {
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const value = clamp01(2 ** (-(ageMs / 3_600_000) / halfLifeHours));
  return Math.round(value * 10000) / 10000;
}

/** Raw affinity (roughly -99..99) normalised to 0..1. */
export function normaliseAffinity(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score <= 0) return 0;
  return clamp01(score / 20);
}
