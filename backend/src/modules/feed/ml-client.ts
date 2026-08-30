/**
 * The ML ranker client.
 *
 * PHASE_07 exit criterion 2: killing the ML service must degrade to the rules
 * ranker with **no user-visible failure**. That shapes every decision here.
 *
 * The service is treated as an optimisation, never a dependency. It gets a short
 * timeout, a circuit breaker, and a response that is validated rather than
 * trusted — a model returning NaN or a malformed body must not poison the feed
 * any more than a model that is simply down.
 *
 * `scoreWithFallback` cannot throw. Every path returns a usable ranking.
 */

import { config } from '../../core/config.ts';
import { logger } from '../../core/logger.ts';
import { withTimeout } from '../../core/timeout.ts';
import {
  predictFromRules,
  type CandidateFeatures,
  type Predictions,
} from './scoring.ts';

/** A feed request that waits longer than this has already failed the user. */
const REQUEST_TIMEOUT_MS = 250;
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;

let consecutiveFailures = 0;
let openedAt = 0;

function breakerIsOpen(): boolean {
  if (openedAt === 0) return false;
  if (Date.now() - openedAt < COOLDOWN_MS) return true;
  openedAt = 0;
  consecutiveFailures = 0;
  return false;
}

function recordSuccess(): void {
  if (consecutiveFailures > 0 || openedAt !== 0) {
    logger.info('ML ranker is responding again');
  }
  consecutiveFailures = 0;
  openedAt = 0;
}

function recordFailure(err: unknown): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD && openedAt === 0) {
    openedAt = Date.now();
    logger.warn(
      { err, cooldownMs: COOLDOWN_MS },
      'ML ranker unavailable — serving the rules ranker until the cooldown elapses',
    );
  }
}

const PREDICTION_KEYS: (keyof Predictions)[] = [
  'watch', 'completion', 'rewatch', 'like', 'comment', 'share', 'save',
  'follow', 'profileVisit', 'quickSkip', 'notInterested', 'hide', 'report',
];

/**
 * Validates one prediction set from the service.
 *
 * Returns null if anything is missing or out of range, so a partially broken
 * model is treated exactly like an absent one. Silently coercing a NaN to 0
 * would let a broken model quietly bury content.
 */
function parsePredictions(raw: unknown): Predictions | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const out = {} as Predictions;

  for (const key of PREDICTION_KEYS) {
    const value = source[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      return null;
    }
    out[key] = value;
  }
  return out;
}

interface MlResponse {
  modelVersion?: string;
  predictions?: Record<string, unknown>;
}

/**
 * Asks the ML service to score a candidate set.
 *
 * Throws on any problem; the caller is responsible for falling back. Keeping the
 * failure explicit here means the fallback is a deliberate decision at one call
 * site rather than an accident spread across several.
 */
async function requestScores(
  userId: number,
  candidates: CandidateFeatures[],
): Promise<{ modelVersion: string; predictions: Map<number, Predictions> }> {
  const response = await withTimeout(
    fetch(`${config.ML_SERVICE_URL.replace(/\/$/, '')}/rank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: String(userId),
        candidates: candidates.map((c) => ({
          videoId: String(c.videoId),
          creatorId: String(c.creatorId),
          categoryId: c.categoryId === null ? null : String(c.categoryId),
          interestMatch: c.interestMatch,
          creatorAffinity: c.creatorAffinity,
          freshness: c.freshness,
          trending: c.trending,
          quality: c.quality,
          seenCount: c.seenCount,
          isNewCreator: c.isNewCreator,
        })),
      }),
    }),
    REQUEST_TIMEOUT_MS,
    'ML ranker',
  );

  if (!response.ok) throw new Error(`ML ranker returned ${response.status}`);

  const body = (await response.json()) as MlResponse;
  const predictions = new Map<number, Predictions>();

  for (const [videoId, raw] of Object.entries(body.predictions ?? {})) {
    const parsed = parsePredictions(raw);
    if (parsed) predictions.set(Number(videoId), parsed);
  }

  if (predictions.size === 0) throw new Error('ML ranker returned no usable predictions');

  return { modelVersion: body.modelVersion ?? 'unknown', predictions };
}

export interface ScoringOutcome {
  candidates: CandidateFeatures[];
  ranker: 'ml' | 'rules';
  modelVersion: string;
  /** Populated when the ML path was attempted and did not work out. */
  fallbackReason?: string;
}

/**
 * Attaches predictions to every candidate, from the model where possible.
 *
 * Never throws. A candidate the model did not score keeps its rules-based
 * prediction, so a partial response degrades gracefully instead of leaving gaps.
 */
export async function scoreWithFallback(
  userId: number,
  candidates: CandidateFeatures[],
): Promise<ScoringOutcome> {
  const withRules = candidates.map((candidate) => ({
    ...candidate,
    predictions: predictFromRules(candidate),
  }));

  if (candidates.length === 0) {
    return { candidates: withRules, ranker: 'rules', modelVersion: 'rules-v1' };
  }

  if (breakerIsOpen()) {
    return {
      candidates: withRules,
      ranker: 'rules',
      modelVersion: 'rules-v1',
      fallbackReason: 'The ML ranker is in its failure cooldown.',
    };
  }

  try {
    const { modelVersion, predictions } = await requestScores(userId, candidates);
    recordSuccess();

    let scored = 0;
    const merged = withRules.map((candidate) => {
      const prediction = predictions.get(candidate.videoId);
      if (!prediction) return candidate;
      scored += 1;
      return { ...candidate, predictions: prediction };
    });

    // A model that scored almost nothing is not really working.
    if (scored < candidates.length * 0.5) {
      return {
        candidates: withRules,
        ranker: 'rules',
        modelVersion: 'rules-v1',
        fallbackReason: `The ML ranker scored only ${scored} of ${candidates.length} candidates.`,
      };
    }

    return { candidates: merged, ranker: 'ml', modelVersion };
  } catch (err) {
    recordFailure(err);
    return {
      candidates: withRules,
      ranker: 'rules',
      modelVersion: 'rules-v1',
      fallbackReason: err instanceof Error ? err.message : 'The ML ranker could not be reached.',
    };
  }
}

/** Breaker state, for health reporting and tests. */
export function mlStatus(): { available: boolean; consecutiveFailures: number } {
  return { available: !breakerIsOpen(), consecutiveFailures };
}

export function __resetBreaker(): void {
  consecutiveFailures = 0;
  openedAt = 0;
}
