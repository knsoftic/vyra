/**
 * Interest profiles.
 *
 * Two horizons, because one cannot do both jobs:
 *
 *   **short** — the current session and recent days, decaying fast. This is what
 *   lets the feed react when someone starts watching cooking videos tonight.
 *
 *   **long** — a rolling window of months, decaying slowly. This is what stops a
 *   single unusual evening rewriting a person's taste permanently.
 *
 * They are blended at ranking time rather than merged in storage, so the balance
 * between "what you want now" and "what you generally like" stays tunable
 * without rebuilding history.
 *
 * Decay is exponential with a half-life, applied on read rather than by a sweep.
 * A weight that has not been reinforced simply falls off on its own, which is
 * what makes segment membership temporary — nobody is locked into a category
 * they engaged with once.
 *
 * All of this is pure arithmetic so it can be tested exactly.
 */

import type { InterestWeights } from '../../../../shared/contracts/behaviour.ts';

/** Half-lives, in days. Short reacts within a session; long survives months. */
export const HALF_LIFE_DAYS = { short: 3, long: 60 } as const;

/** How much each horizon contributes to the blended profile. */
export const HORIZON_BLEND = { short: 0.6, long: 0.4 } as const;

/** Weights below this are dropped, so a profile does not grow without limit. */
export const MIN_WEIGHT = 0.01;

/** Cap on distinct topics per horizon. */
export const MAX_TOPICS = 100;

/**
 * Signal strengths per event.
 *
 * Negatives are deliberately larger in magnitude than the positives they
 * mirror. Someone saying "not interested" is telling us something far more
 * definite than someone quietly watching, and treating those symmetrically is
 * how a feed ends up ignoring explicit feedback.
 */
export const SIGNAL_WEIGHTS: Record<string, number> = {
  // Positive
  completion: 0.6,
  watch_30s: 0.5,
  watch_20s: 0.4,
  watch_10s: 0.25,
  watch_5s: 0.12,
  watch_2s: 0.04,
  rewatch: 0.7,
  like: 0.8,
  save: 1.0,
  share: 1.0,
  comment: 0.9,
  follow: 1.2,
  profile_visit: 0.3,
  category_view: 0.2,
  hashtag_click: 0.2,
  search: 0.35,
  // Negative
  quick_skip: -0.4,
  not_interested: -2.5,
  hide_creator: -2.5,
  unfollow: -1.5,
  report: -3.0,
};

/** Exponential decay factor for an age in days. */
export function decayFactor(ageDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  if (halfLifeDays <= 0) return 0;
  return 2 ** (-ageDays / halfLifeDays);
}

/**
 * Ages a stored profile forward to now.
 *
 * Applied on read, so nothing has to sweep the table to keep weights honest.
 */
export function decayWeights(
  weights: InterestWeights,
  ageDays: number,
  horizon: 'short' | 'long',
): InterestWeights {
  const factor = decayFactor(ageDays, HALF_LIFE_DAYS[horizon]);
  const out: InterestWeights = {};
  for (const [topic, weight] of Object.entries(weights)) {
    const decayed = weight * factor;
    if (decayed >= MIN_WEIGHT) out[topic] = Math.round(decayed * 10000) / 10000;
  }
  return out;
}

/**
 * Applies one signal to a profile.
 *
 * `strength` scales the event's base weight — a watch that barely happened
 * contributes proportionally less than one that ran to completion.
 */
export function applySignal(
  weights: InterestWeights,
  topic: string,
  event: string,
  strength = 1,
): InterestWeights {
  const base = SIGNAL_WEIGHTS[event];
  if (base === undefined || !topic) return weights;

  const delta = base * (Number.isFinite(strength) ? Math.max(-1, Math.min(1, strength)) : 1);
  const out = { ...weights };
  const next = (out[topic] ?? 0) + delta;

  // Weights are allowed to go negative — an actively rejected topic should sit
  // below one that has simply never been seen — but bounded so a single angry
  // session cannot permanently bury a category.
  out[topic] = Math.round(Math.max(-3, Math.min(10, next)) * 10000) / 10000;
  if (Math.abs(out[topic]) < MIN_WEIGHT) delete out[topic];

  return out;
}

/** Keeps the strongest topics, so a profile stays bounded. */
export function prune(weights: InterestWeights, max = MAX_TOPICS): InterestWeights {
  const entries = Object.entries(weights);
  if (entries.length <= max) return weights;
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return Object.fromEntries(entries.slice(0, max));
}

/**
 * Normalises to 0..1 for display and comparison.
 *
 * Negative weights map to 0 rather than being dropped: "actively not wanted" and
 * "never seen" both mean do-not-show, and the raw profile keeps the distinction.
 */
export function normalise(weights: InterestWeights): InterestWeights {
  const values = Object.values(weights).filter((v) => v > 0);
  if (values.length === 0) return {};
  const max = Math.max(...values);
  if (max <= 0) return {};

  const out: InterestWeights = {};
  for (const [topic, weight] of Object.entries(weights)) {
    out[topic] = weight > 0 ? Math.round((weight / max) * 10000) / 10000 : 0;
  }
  return out;
}

/** Blends the two horizons into what ranking consumes. */
export function blendHorizons(
  short: InterestWeights,
  long: InterestWeights,
  blend = HORIZON_BLEND,
): InterestWeights {
  const topics = new Set([...Object.keys(short), ...Object.keys(long)]);
  const out: InterestWeights = {};
  for (const topic of topics) {
    const value = (short[topic] ?? 0) * blend.short + (long[topic] ?? 0) * blend.long;
    if (Math.abs(value) >= MIN_WEIGHT) out[topic] = Math.round(value * 10000) / 10000;
  }
  return out;
}

/** The strongest topics, for display and for candidate generation. */
export function topTopics(weights: InterestWeights, count = 10): { topic: string; weight: number }[] {
  return Object.entries(weights)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([topic, weight]) => ({ topic, weight }));
}

/**
 * Topics the user has actively rejected.
 *
 * Kept separate from "low interest" because the two justify different
 * treatment: a rejected topic should be suppressed, an unseen one merely is not
 * boosted.
 */
export function rejectedTopics(weights: InterestWeights, threshold = -0.5): string[] {
  return Object.entries(weights)
    .filter(([, weight]) => weight <= threshold)
    .map(([topic]) => topic);
}
