/**
 * Re-ranking.
 *
 * Scoring produces the *best* ordering for one video at a time. That is not the
 * best feed. A purely score-ordered page is four videos from the same creator,
 * then eight from one category — each individually well-matched, collectively
 * unwatchable.
 *
 * So this stage trades a little relevance for a lot of variety, and enforces the
 * constraints that are not negotiable at any score:
 *
 *   - no creator twice inside a sliding window
 *   - no category beyond its share cap
 *   - nothing already seen, unless deliberately rewatchable
 *   - nothing blocked, hidden, reported or safety-suppressed
 *   - a reserved share of slots for new creators (ADR-010)
 *
 * The exploration reservation runs *after* the constraints, so it can never be
 * used to smuggle in something the constraints just removed.
 *
 * Pure functions throughout, so the behaviour is exactly testable.
 */

import type { ScoredCandidate } from './scoring.ts';
import type { Weights } from './weights.ts';

export interface RerankContext {
  /** Videos already shown to this viewer in earlier pages of this session. */
  recentCreators?: number[];
  /** Creators blocked, hidden or reported by the viewer. */
  excludedCreators?: Set<number>;
  /** Videos removed for safety, spam or duplication. */
  excludedVideos?: Set<number>;
  /** Topics the viewer has explicitly rejected. */
  suppressedCategories?: Set<number>;
}

export interface RerankResult {
  items: ScoredCandidate[];
  /** Why the result looks the way it does — surfaced in admin, not to users. */
  diagnostics: {
    considered: number;
    removedByConstraint: Record<string, number>;
    newCreatorSlots: number;
    newCreatorShare: number;
    categoryShares: Record<string, number>;
    creatorRepeatsPrevented: number;
  };
}

/**
 * Removes everything that must never be shown, whatever it scored.
 *
 * Deliberately separate from the diversity pass: these are correctness and
 * safety rules, not preferences, and mixing the two makes it possible for a high
 * score to argue its way past a block.
 */
export function applyHardConstraints(
  candidates: ScoredCandidate[],
  context: RerankContext,
  /**
   * Whether "already seen" is enforced. False only on the exhausted-pool retry
   * below — every other rule here stays on in both passes.
   */
  excludeSeen = true,
): { kept: ScoredCandidate[]; removed: Record<string, number> } {
  // A concrete shape rather than an index signature, so the counters are known
  // to exist and the increments below need no defensive checks.
  const removed = {
    blockedCreator: 0,
    excludedVideo: 0,
    suppressedCategory: 0,
    alreadySeen: 0,
  };

  const kept = candidates.filter((candidate) => {
    if (context.excludedCreators?.has(candidate.creatorId)) {
      removed.blockedCreator += 1;
      return false;
    }
    if (context.excludedVideos?.has(candidate.videoId)) {
      removed.excludedVideo += 1;
      return false;
    }
    if (
      candidate.categoryId !== null &&
      context.suppressedCategories?.has(candidate.categoryId)
    ) {
      removed.suppressedCategory += 1;
      return false;
    }
    // Seen more than twice is not worth a third showing — unless there is
    // nothing else left, which the caller signals by turning this off.
    if (excludeSeen && candidate.seenCount >= 2) {
      removed.alreadySeen += 1;
      return false;
    }
    return true;
  });

  return { kept, removed };
}

/**
 * Fills a page, honouring creator spacing and category share.
 *
 * Greedy by score, skipping anything that would break a rule and coming back to
 * it once the window has moved on. A candidate is only dropped entirely if the
 * page fills without it ever becoming legal.
 */
export function applyDiversity(
  candidates: ScoredCandidate[],
  limit: number,
  weights: Weights,
  recentCreators: number[] = [],
): { items: ScoredCandidate[]; repeatsPrevented: number } {
  const creatorWindow = Math.max(1, Math.round(weights.d_creator_window ?? 4));
  const configuredCap = Math.min(1, Math.max(0.1, weights.d_category_max_share ?? 0.4));

  // The cap has to account for what the pool actually contains. Demanding that
  // no category exceeds 40% of a page is impossible when only two categories are
  // available, and insisting on it would return a half-empty feed. So the
  // effective cap is the looser of the configured share and an even split across
  // the categories on offer — diversity is bounded by the pool, not by wishes.
  const distinctCategories = new Set(candidates.map((c) => c.categoryId ?? -1)).size || 1;
  const evenSplit = Math.ceil(limit / distinctCategories);
  const maxPerCategory = Math.max(1, Math.floor(limit * configuredCap), evenSplit);

  const items: ScoredCandidate[] = [];
  const categoryCounts = new Map<number, number>();
  const creatorPositions = new Map<number, number>();
  // Seeded from the previous page so spacing survives pagination.
  recentCreators.forEach((creatorId, index) => {
    creatorPositions.set(creatorId, index - recentCreators.length);
  });

  const chosen = new Set<number>();
  let repeatsPrevented = 0;

  /**
   * One filling pass at a given strictness.
   *
   * Called repeatedly with looser settings. A page that is short is worse than a
   * page that is slightly repetitive, so the constraints relax rather than the
   * page shrinking — but they relax in a defined order, so the first pass always
   * gets the diversity it can.
   */
  const fill = (window: number, categoryCap: number, countPrevented: boolean): void => {
    for (const candidate of candidates) {
      if (items.length >= limit) return;
      if (chosen.has(candidate.videoId)) continue;

      const lastPosition = creatorPositions.get(candidate.creatorId);
      if (lastPosition !== undefined && items.length - lastPosition < window) {
        if (countPrevented) repeatsPrevented += 1;
        continue;
      }

      const categoryKey = candidate.categoryId ?? -1;
      if ((categoryCounts.get(categoryKey) ?? 0) >= categoryCap) {
        if (countPrevented) repeatsPrevented += 1;
        continue;
      }

      items.push(candidate);
      chosen.add(candidate.videoId);
      creatorPositions.set(candidate.creatorId, items.length - 1);
      categoryCounts.set(categoryKey, (categoryCounts.get(categoryKey) ?? 0) + 1);
    }
  };

  // Strict, then progressively looser. Only the first pass counts as "prevented"
  // — a later pass admitting something is the system working, not a violation.
  fill(creatorWindow, maxPerCategory, true);
  if (items.length < limit) fill(2, maxPerCategory, false);
  if (items.length < limit) fill(1, Number.POSITIVE_INFINITY, false);

  return { items, repeatsPrevented };
}

/**
 * Guarantees new creators their reserved share of the page (ADR-010).
 *
 * Without this the reservation is aspirational: new-creator candidates are
 * retrieved, score lower than established ones because they have no engagement
 * history, and never survive the sort. So the slots are counted and filled
 * explicitly.
 *
 * This is a floor, not a ceiling. New creators that earn their place on score
 * keep it, and the reservation only tops up the shortfall.
 */
export function reserveNewCreatorSlots(
  page: ScoredCandidate[],
  pool: ScoredCandidate[],
  limit: number,
  rate: number,
): { items: ScoredCandidate[]; slots: number } {
  const target = Math.floor(limit * Math.max(0, Math.min(1, rate)));
  if (target === 0) return { items: page, slots: 0 };

  const already = page.filter((c) => c.isNewCreator).length;
  if (already >= target) return { items: page, slots: already };

  const chosen = new Set(page.map((c) => c.videoId));
  const newcomers = pool
    .filter((c) => c.isNewCreator && !chosen.has(c.videoId))
    .sort((a, b) => b.score - a.score);

  const items = [...page];
  let added = 0;

  for (const newcomer of newcomers) {
    if (already + added >= target) break;
    // Replace from the bottom, so the strongest recommendations are untouched.
    let replaceAt = -1;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (!items[i]!.isNewCreator) {
        replaceAt = i;
        break;
      }
    }
    if (replaceAt === -1) break;
    items[replaceAt] = newcomer;
    added += 1;
  }

  // Re-sort so an inserted newcomer does not sit oddly against its neighbours.
  items.sort((a, b) => b.score - a.score);
  return { items, slots: already + added };
}

/** The full re-ranking stage. */
export function rerank(
  scored: ScoredCandidate[],
  limit: number,
  weights: Weights,
  context: RerankContext = {},
): RerankResult {
  const considered = scored.length;

  const first = applyHardConstraints(scored, context);

  /**
   * An empty feed is never the right answer.
   *
   * A viewer who has caught up with everything available hits the "seen twice"
   * rule on every candidate and would be shown a blank screen — which reads as
   * a broken app, not as a compliment about how much they have watched. Small
   * or new platforms sit in that state constantly.
   *
   * So when, and only when, that rule alone emptied the pool, it is retried
   * without it and the least-seen items come back first. The safety rules —
   * blocks, hidden creators, suppressed categories, removed videos — are not
   * part of this retry and can never be relaxed by it.
   */
  const exhausted = first.kept.length === 0 && (first.removed.alreadySeen ?? 0) > 0;
  const relaxed = exhausted ? applyHardConstraints(scored, context, false) : first;

  const kept = exhausted
    // Least-seen first, then by score, so a re-run still leads with whatever the
    // viewer has seen least rather than repeating the same few videos.
    ? relaxed.kept.slice().sort((a, b) => a.seenCount - b.seenCount || b.score - a.score)
    : first.kept;

  const removed = { ...first.removed, ...(exhausted ? { seenRuleRelaxed: 1 } : {}) };

  const { items: diversified, repeatsPrevented } = applyDiversity(
    kept,
    limit,
    weights,
    context.recentCreators ?? [],
  );

  const { items, slots } = reserveNewCreatorSlots(
    diversified,
    kept,
    limit,
    weights.x_new_creator_rate ?? 0.1,
  );

  const categoryShares: Record<string, number> = {};
  for (const item of items) {
    const key = String(item.categoryId ?? 'none');
    categoryShares[key] = (categoryShares[key] ?? 0) + 1;
  }
  for (const key of Object.keys(categoryShares)) {
    categoryShares[key] = Math.round(((categoryShares[key] ?? 0) / Math.max(1, items.length)) * 100) / 100;
  }

  return {
    items,
    diagnostics: {
      considered,
      removedByConstraint: removed,
      newCreatorSlots: slots,
      newCreatorShare: items.length > 0 ? Math.round((slots / items.length) * 100) / 100 : 0,
      categoryShares,
      creatorRepeatsPrevented: repeatsPrevented,
    },
  };
}
