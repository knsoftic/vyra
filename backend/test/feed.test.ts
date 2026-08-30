/**
 * Recommendation unit tests — scoring, diversity, exploration, distribution.
 *
 * Pure functions, so these run with no database, server or ML service.
 *
 * Two properties get the most attention, because they are the ones that quietly
 * stop being true: the new-creator reservation (ADR-010) and the cap on how much
 * technical quality can influence ranking (ADR-011).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreCandidate,
  rankCandidates,
  predictFromRules,
  interestMatchFor,
  freshnessFor,
  normaliseAffinity,
  NEUTRAL_PREDICTIONS,
  type CandidateFeatures,
} from '../src/modules/feed/scoring.ts';
import {
  applyDiversity,
  applyHardConstraints,
  reserveNewCreatorSlots,
  rerank,
} from '../src/modules/feed/rerank.ts';
import { WEIGHT_DEFAULTS } from '../src/modules/feed/weight-defaults.ts';
import {
  computeRates,
  evaluate,
  LEVEL_THRESHOLDS,
  MAX_LEVEL,
  MIN_LEVEL,
} from '../src/modules/feed/distribution-rules.ts';

const WEIGHTS: Record<string, number> = Object.fromEntries(
  WEIGHT_DEFAULTS.map((w) => [w.key, w.value]),
);

const candidate = (over: Partial<CandidateFeatures> = {}): CandidateFeatures => ({
  videoId: 1,
  creatorId: 1,
  categoryId: 1,
  pool: 'interests',
  interestMatch: 0.5,
  creatorAffinity: 0.5,
  freshness: 0.5,
  trending: 0,
  quality: 0.5,
  seenCount: 0,
  isNewCreator: false,
  predictions: { ...NEUTRAL_PREDICTIONS },
  ...over,
});

// ── Scoring ──

test('a score always lands in 0..100', () => {
  for (const features of [
    candidate(),
    candidate({ interestMatch: 1, creatorAffinity: 1, predictions: { ...NEUTRAL_PREDICTIONS, watch: 1, completion: 1, share: 1, follow: 1 } }),
    candidate({ interestMatch: 0, creatorAffinity: 0, predictions: { ...NEUTRAL_PREDICTIONS, quickSkip: 1, report: 1, hide: 1 } }),
  ]) {
    const { score } = scoreCandidate(features, WEIGHTS);
    assert.ok(score >= 0 && score <= 100, `score ${score} out of range`);
    assert.ok(Number.isFinite(score));
  }
});

test('a better match outranks a worse one', () => {
  const strong = scoreCandidate(candidate({ interestMatch: 0.95, creatorAffinity: 0.9 }), WEIGHTS);
  const weak = scoreCandidate(candidate({ interestMatch: 0.1, creatorAffinity: 0 }), WEIGHTS);
  assert.ok(strong.score > weak.score);
});

test('predicted negatives pull a score down', () => {
  const clean = scoreCandidate(candidate(), WEIGHTS);
  const skippy = scoreCandidate(
    candidate({ predictions: { ...NEUTRAL_PREDICTIONS, quickSkip: 0.9 } }), WEIGHTS);
  assert.ok(skippy.score < clean.score);
});

test('a predicted report outweighs every positive', () => {
  const reported = scoreCandidate(
    candidate({
      interestMatch: 1, creatorAffinity: 1,
      predictions: { ...NEUTRAL_PREDICTIONS, watch: 1, completion: 1, like: 1, share: 1, report: 1 },
    }),
    WEIGHTS,
  );
  const ordinary = scoreCandidate(candidate(), WEIGHTS);
  assert.ok(reported.score < ordinary.score, 'a likely report must sink a video however well it matches');
});

test('repetition penalty grows with each showing', () => {
  const scores = [0, 1, 2, 3].map(
    (seenCount) => scoreCandidate(candidate({ seenCount }), WEIGHTS).score,
  );
  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(scores[i]! < scores[i - 1]!, `seenCount ${i} did not score below ${i - 1}`);
  }
});

test('every score carries a breakdown that explains it', () => {
  const { breakdown } = scoreCandidate(candidate(), WEIGHTS);
  for (const key of ['watch', 'completion', 'interestMatch', 'creatorAffinity', 'quality']) {
    assert.ok(key in breakdown, `${key} missing from the breakdown`);
  }
  assert.ok('penalty_quickSkip' in breakdown);
});

// ── ADR-011: quality must not decide who gets an audience ──

test('technical quality is capped at a small influence', () => {
  const spec = WEIGHT_DEFAULTS.find((w) => w.key === 'w_quality');
  assert.ok(spec);
  assert.ok(spec.max <= 1, `quality weight can reach ${spec.max}, which is too much influence`);

  // Even at its maximum, quality must not overturn a real relevance difference.
  const maxQuality = { ...WEIGHTS, w_quality: spec.max };
  const pristine = scoreCandidate(
    candidate({ quality: 1, interestMatch: 0.3, creatorAffinity: 0 }), maxQuality);
  const relevant = scoreCandidate(
    candidate({ quality: 0, interestMatch: 0.9, creatorAffinity: 0.8 }), maxQuality);

  assert.ok(
    relevant.score > pristine.score,
    'a well-matched video from a cheap camera must outrank a pristine irrelevant one',
  );
});

test('quality contributes less than any engagement signal', () => {
  const qualityWeight = WEIGHTS.w_quality!;
  for (const key of ['w_like', 'w_share', 'w_save', 'w_completion', 'w_interest_match']) {
    assert.ok(
      WEIGHTS[key]! > qualityWeight,
      `${key} (${WEIGHTS[key]}) should outweigh quality (${qualityWeight})`,
    );
  }
});

// ── The rules fallback ──

test('the rules ranker produces valid probabilities', () => {
  for (const features of [
    candidate({ interestMatch: 0, creatorAffinity: 0 }),
    candidate({ interestMatch: 1, creatorAffinity: 1 }),
    candidate({ interestMatch: 0.5, creatorAffinity: 0.5 }),
  ]) {
    const predictions = predictFromRules(features);
    for (const [key, value] of Object.entries(predictions)) {
      assert.ok(value >= 0 && value <= 1, `${key} = ${value} is not a probability`);
    }
  }
});

test('the rules ranker predicts more engagement for a better match', () => {
  const strong = predictFromRules(candidate({ interestMatch: 0.9, creatorAffinity: 0.9 }));
  const weak = predictFromRules(candidate({ interestMatch: 0.1, creatorAffinity: 0 }));

  assert.ok(strong.watch > weak.watch);
  assert.ok(strong.completion > weak.completion);
  // And fewer negatives.
  assert.ok(strong.quickSkip < weak.quickSkip);
});

test('the rules ranker orders a realistic set sensibly', () => {
  const pool = [
    candidate({ videoId: 1, interestMatch: 0.9, creatorAffinity: 0.8 }),
    candidate({ videoId: 2, interestMatch: 0.2, creatorAffinity: 0 }),
    candidate({ videoId: 3, interestMatch: 0.6, creatorAffinity: 0.4 }),
  ].map((c) => ({ ...c, predictions: predictFromRules(c) }));

  const ranked = rankCandidates(pool, WEIGHTS, 'rules');
  assert.deepEqual(ranked.map((r) => r.videoId), [1, 3, 2]);
  assert.equal(ranked[0]!.ranker, 'rules');
});

// ── Hard constraints ──

test('blocked creators and excluded videos are removed whatever they scored', () => {
  const scored = rankCandidates([
    candidate({ videoId: 1, creatorId: 10, interestMatch: 1 }),
    candidate({ videoId: 2, creatorId: 20 }),
    candidate({ videoId: 3, creatorId: 30 }),
  ], WEIGHTS);

  const { kept, removed } = applyHardConstraints(scored, {
    excludedCreators: new Set([10]),
    excludedVideos: new Set([2]),
  });

  assert.deepEqual(kept.map((c) => c.videoId), [3]);
  assert.equal(removed.blockedCreator, 1);
  assert.equal(removed.excludedVideo, 1);
});

test('a rejected category is removed', () => {
  const scored = rankCandidates([
    candidate({ videoId: 1, categoryId: 5 }),
    candidate({ videoId: 2, categoryId: 6 }),
  ], WEIGHTS);

  const { kept } = applyHardConstraints(scored, { suppressedCategories: new Set([5]) });
  assert.deepEqual(kept.map((c) => c.videoId), [2]);
});

test('a video seen twice is not shown a third time', () => {
  const scored = rankCandidates([
    candidate({ videoId: 1, seenCount: 2 }),
    candidate({ videoId: 2, seenCount: 1 }),
  ], WEIGHTS);

  const { kept, removed } = applyHardConstraints(scored, {});
  assert.deepEqual(kept.map((c) => c.videoId), [2]);
  assert.equal(removed.alreadySeen, 1);
});

test('an exhausted pool re-serves the least-seen videos rather than nothing', () => {
  // Everything has been seen twice: the state a viewer reaches on a small
  // platform after catching up. An empty page reads as a broken app.
  const scored = rankCandidates([
    candidate({ videoId: 1, creatorId: 10, seenCount: 4 }),
    candidate({ videoId: 2, creatorId: 20, seenCount: 2 }),
    candidate({ videoId: 3, creatorId: 30, seenCount: 3 }),
  ], WEIGHTS);

  const result = rerank(scored, 10, WEIGHTS);

  assert.equal(result.items.length, 3, 'the feed must not be empty');
  assert.equal(
    result.items[0]?.videoId,
    2,
    'the least-seen video leads the re-run',
  );
  assert.equal(result.diagnostics.removedByConstraint.seenRuleRelaxed, 1);
});

test('the exhausted-pool retry never relaxes a block', () => {
  const scored = rankCandidates([
    candidate({ videoId: 1, creatorId: 10, seenCount: 3 }),
    candidate({ videoId: 2, creatorId: 20, seenCount: 3 }),
  ], WEIGHTS);

  // Blocked creator plus everything seen — the relaxation must bring back the
  // seen video and still leave the blocked creator out.
  const result = rerank(scored, 10, { ...WEIGHTS } as typeof WEIGHTS, {
    excludedCreators: new Set([10]),
  });

  assert.deepEqual(result.items.map((c) => c.videoId), [2]);
});

test('a suppressed category stays suppressed when the pool is exhausted', () => {
  const scored = rankCandidates([
    candidate({ videoId: 1, categoryId: 5, seenCount: 3 }),
    candidate({ videoId: 2, categoryId: 6, seenCount: 3 }),
  ], WEIGHTS);

  const result = rerank(scored, 10, WEIGHTS, { suppressedCategories: new Set([5]) });
  assert.deepEqual(result.items.map((c) => c.videoId), [2]);
});

test('the seen rule still applies while unseen videos remain', () => {
  const scored = rankCandidates([
    candidate({ videoId: 1, creatorId: 10, seenCount: 3 }),
    candidate({ videoId: 2, creatorId: 20, seenCount: 0 }),
  ], WEIGHTS);

  const result = rerank(scored, 10, WEIGHTS);
  assert.deepEqual(
    result.items.map((c) => c.videoId),
    [2],
    'relaxation is a last resort, not a default',
  );
  assert.equal(result.diagnostics.removedByConstraint.seenRuleRelaxed, undefined);
});

// ── Diversity ──

test('creator spacing holds while other creators are available', () => {
  // Six from one creator, six from others, all scoring similarly.
  const scored = rankCandidates([
    ...Array.from({ length: 6 }, (_, i) => candidate({ videoId: i + 1, creatorId: 99, interestMatch: 0.9 })),
    ...Array.from({ length: 6 }, (_, i) => candidate({ videoId: 50 + i, creatorId: i + 1, interestMatch: 0.85 })),
  ], WEIGHTS);

  const { items } = applyDiversity(scored, 6, WEIGHTS);
  const dominant = items.filter((i) => i.creatorId === 99).length;
  assert.ok(
    dominant <= 2,
    `one creator took ${dominant} of 6 slots while others were available`,
  );
});

test('a single-creator pool still fills the page rather than collapsing', () => {
  // Nothing else is available, so spacing must yield — an empty feed is worse.
  const scored = rankCandidates(
    Array.from({ length: 10 }, (_, i) => candidate({ videoId: i + 1, creatorId: 99 })),
    WEIGHTS,
  );
  const { items } = applyDiversity(scored, 10, WEIGHTS);
  assert.equal(items.length, 10, 'the page should fill when no alternative exists');
  assert.equal(new Set(items.map((i) => i.videoId)).size, 10, 'and never repeat a video');
});

test('creators are interleaved when the pool allows it', () => {
  const scored = rankCandidates([
    candidate({ videoId: 1, creatorId: 1, interestMatch: 0.99 }),
    candidate({ videoId: 2, creatorId: 1, interestMatch: 0.98 }),
    candidate({ videoId: 3, creatorId: 2, interestMatch: 0.5 }),
    candidate({ videoId: 4, creatorId: 3, interestMatch: 0.4 }),
  ], WEIGHTS);

  const { items } = applyDiversity(scored, 3, WEIGHTS);
  const creators = items.map((i) => i.creatorId);
  assert.notDeepEqual(creators, [1, 1, 2], 'two videos from one creator should not sit adjacent');
});

test('no category exceeds its share cap', () => {
  const scored = rankCandidates(
    Array.from({ length: 20 }, (_, i) =>
      candidate({ videoId: i + 1, creatorId: i + 1, categoryId: i < 15 ? 1 : 2 })),
    WEIGHTS,
  );

  const { items } = applyDiversity(scored, 10, WEIGHTS);
  const counts = new Map<number, number>();
  for (const item of items) {
    counts.set(item.categoryId!, (counts.get(item.categoryId!) ?? 0) + 1);
  }

  // Only two categories exist, so an even split is the most diversity the pool
  // can offer — the cap is bounded by availability, not by the configured share.
  const evenSplit = Math.ceil(10 / 2);
  for (const [category, count] of counts) {
    assert.ok(
      count <= evenSplit,
      `category ${category} took ${count} of 10 slots, an even split is ${evenSplit}`,
    );
  }
});

test('the configured cap binds when enough categories exist', () => {
  // Five categories available: the 40% share cap is achievable and must hold.
  const scored = rankCandidates(
    Array.from({ length: 40 }, (_, i) =>
      candidate({ videoId: i + 1, creatorId: i + 1, categoryId: i < 30 ? 1 : (i % 4) + 2 })),
    WEIGHTS,
  );

  const { items } = applyDiversity(scored, 10, WEIGHTS);
  const counts = new Map<number, number>();
  for (const item of items) {
    counts.set(item.categoryId!, (counts.get(item.categoryId!) ?? 0) + 1);
  }
  const cap = Math.max(Math.floor(10 * WEIGHTS.d_category_max_share!), Math.ceil(10 / 5));
  for (const [category, count] of counts) {
    assert.ok(count <= cap, `category ${category} took ${count} of 10 slots, cap is ${cap}`);
  }
});

test('a full page is preferred to an empty one when the pool is thin', () => {
  const scored = rankCandidates(
    Array.from({ length: 5 }, (_, i) => candidate({ videoId: i + 1, creatorId: 1 })),
    WEIGHTS,
  );
  const { items } = applyDiversity(scored, 5, WEIGHTS);
  assert.equal(items.length, 5, 'diversity must bend rather than return a near-empty feed');
});

test('creator spacing carries across pages', () => {
  const scored = rankCandidates([
    candidate({ videoId: 1, creatorId: 7 }),
    candidate({ videoId: 2, creatorId: 8 }),
  ], WEIGHTS);

  // Creator 7 appeared at the end of the previous page.
  const { items } = applyDiversity(scored, 2, WEIGHTS, [7]);
  assert.equal(items[0]!.creatorId, 8, 'a creator from the previous page should not lead this one');
});

// ── ADR-010: new-creator exploration ──

test('new creators get their reserved share even when they score lower', () => {
  // The realistic case: established creators score higher because they have
  // engagement history, so without a reservation newcomers never appear.
  const page = rankCandidates(
    Array.from({ length: 10 }, (_, i) =>
      candidate({ videoId: i + 1, creatorId: i + 1, interestMatch: 0.9 })),
    WEIGHTS,
  );
  const pool = [
    ...page,
    ...rankCandidates(
      Array.from({ length: 5 }, (_, i) =>
        candidate({ videoId: 100 + i, creatorId: 100 + i, interestMatch: 0.2, isNewCreator: true })),
      WEIGHTS,
    ),
  ];

  const { items, slots } = reserveNewCreatorSlots(page, pool, 10, 0.1);
  assert.ok(slots >= 1, 'a 10% reservation over 10 slots should yield at least one');
  assert.equal(items.filter((i) => i.isNewCreator).length, slots);
  assert.equal(items.length, 10, 'the page size must not change');
});

test('the reservation is a floor, not a ceiling', () => {
  // New creators that earn more than their share keep it.
  const page = rankCandidates(
    Array.from({ length: 10 }, (_, i) =>
      candidate({ videoId: i + 1, creatorId: i + 1, isNewCreator: true })),
    WEIGHTS,
  );
  const { items, slots } = reserveNewCreatorSlots(page, page, 10, 0.1);
  assert.equal(slots, 10);
  assert.equal(items.length, 10);
});

test('a zero exploration rate reserves nothing', () => {
  const page = rankCandidates([candidate({ videoId: 1 })], WEIGHTS);
  const { slots } = reserveNewCreatorSlots(page, page, 10, 0);
  assert.equal(slots, 0);
});

test('the configured exploration rate is 10% by default (ADR-010)', () => {
  const spec = WEIGHT_DEFAULTS.find((w) => w.key === 'x_new_creator_rate');
  assert.ok(spec);
  assert.equal(spec.value, 0.1);
  assert.ok(spec.max <= 0.5, 'the exploration rate must be bounded — it is a budget, not a lever');
});

test('the full rerank reaches the configured new-creator share', () => {
  const established = Array.from({ length: 30 }, (_, i) =>
    candidate({ videoId: i + 1, creatorId: i + 1, categoryId: (i % 5) + 1, interestMatch: 0.8 }));
  const newcomers = Array.from({ length: 10 }, (_, i) =>
    candidate({
      videoId: 200 + i, creatorId: 200 + i, categoryId: (i % 5) + 1,
      interestMatch: 0.15, isNewCreator: true,
    }));

  const scored = rankCandidates([...established, ...newcomers], WEIGHTS);
  const result = rerank(scored, 20, WEIGHTS);

  assert.equal(result.items.length, 20);
  assert.ok(
    result.diagnostics.newCreatorShare >= 0.1,
    `new creators got ${result.diagnostics.newCreatorShare}, expected at least 0.1`,
  );
});

test('rerank reports why the page looks as it does', () => {
  const scored = rankCandidates(
    Array.from({ length: 10 }, (_, i) => candidate({ videoId: i + 1, creatorId: i + 1 })),
    WEIGHTS,
  );
  const result = rerank(scored, 5, WEIGHTS, { excludedCreators: new Set([1]) });

  assert.equal(result.diagnostics.considered, 10);
  assert.equal(result.diagnostics.removedByConstraint.blockedCreator, 1);
  assert.ok(typeof result.diagnostics.categoryShares === 'object');
});

// ── Helpers ──

test('interest match distinguishes rejected from unseen', () => {
  const interests = { gaming: 5, cooking: 2, opera: -2 };
  assert.equal(interestMatchFor(interests, 'gaming'), 1);
  assert.ok(interestMatchFor(interests, 'cooking') > 0);
  assert.equal(interestMatchFor(interests, 'opera'), 0, 'a rejected topic must score zero');
  assert.ok(interestMatchFor(interests, 'chess') > 0, 'an unseen topic is not a rejection');
  assert.ok(interestMatchFor(interests, 'chess') < interestMatchFor(interests, 'gaming'));
});

test('freshness decays and stays bounded', () => {
  assert.equal(freshnessFor(new Date()), 1);
  const twoDays = freshnessFor(new Date(Date.now() - 48 * 3600_000), 48);
  assert.ok(Math.abs(twoDays - 0.5) < 0.01);
  assert.ok(freshnessFor(new Date(Date.now() - 3650 * 86400_000)) >= 0);
  // A clock-skewed future timestamp must not produce a value above 1.
  assert.equal(freshnessFor(new Date(Date.now() + 86400_000)), 1);
});

test('affinity normalises into 0..1', () => {
  assert.equal(normaliseAffinity(-50), 0);
  assert.equal(normaliseAffinity(0), 0);
  assert.equal(normaliseAffinity(20), 1);
  assert.equal(normaliseAffinity(1000), 1);
  assert.equal(normaliseAffinity(Number.NaN), 0);
});

// ── Progressive distribution ──

test('rates are computed against the right denominators', () => {
  const rates = computeRates({
    impressions: 1000, views: 500, completions: 250, quickSkips: 100, engagements: 50,
  });
  // Completion is judged against views: a video scrolled past never had a chance.
  assert.equal(rates.completionRate, 0.5);
  assert.equal(rates.engagementRate, 0.05);
  assert.equal(rates.quickSkipRate, 0.1);
});

test('rates survive zero denominators', () => {
  const rates = computeRates({
    impressions: 0, views: 0, completions: 0, quickSkips: 0, engagements: 0,
  });
  for (const value of Object.values(rates)) {
    assert.ok(Number.isFinite(value) && value === 0);
  }
});

test('a video is held until it has a real sample', () => {
  const verdict = evaluate(1, {
    impressions: 10, views: 8, completions: 8, quickSkips: 0, engagements: 5,
  });
  assert.equal(verdict.decision, 'held');
  assert.match(verdict.reason, /impressions needed/);
});

test('good performance promotes a level', () => {
  const verdict = evaluate(1, {
    impressions: 100, views: 80, completions: 40, quickSkips: 10, engagements: 10,
  });
  assert.equal(verdict.decision, 'promoted');
  assert.equal(verdict.toLevel, 2);
});

test('an excessive skip rate demotes, whatever else is true', () => {
  const verdict = evaluate(3, {
    impressions: 2000, views: 1900, completions: 1800, quickSkips: 1500, engagements: 500,
  });
  assert.equal(verdict.decision, 'demoted');
  assert.equal(verdict.toLevel, 2);
});

test('a level-1 video with an awful skip rate is suppressed rather than demoted', () => {
  const verdict = evaluate(1, {
    impressions: 100, views: 90, completions: 5, quickSkips: 90, engagements: 0,
  });
  assert.equal(verdict.decision, 'suppressed');
  assert.equal(verdict.toLevel, MIN_LEVEL);
});

test('badly underperforming at a level steps back down', () => {
  const verdict = evaluate(3, {
    impressions: 2000, views: 1000, completions: 50, quickSkips: 100, engagements: 5,
  });
  assert.equal(verdict.decision, 'demoted');
});

test('the top level holds rather than promoting past itself', () => {
  const verdict = evaluate(MAX_LEVEL, {
    impressions: 500_000, views: 400_000, completions: 300_000, quickSkips: 1000, engagements: 50_000,
  });
  assert.equal(verdict.decision, 'held');
  assert.equal(verdict.toLevel, MAX_LEVEL);
});

test('performance alone decides — nothing about the creator enters the calculation', () => {
  // Identical metrics must produce an identical verdict; there is no other input.
  const metrics = { impressions: 100, views: 80, completions: 40, quickSkips: 10, engagements: 10 };
  const first = evaluate(1, metrics);
  const second = evaluate(1, { ...metrics });
  assert.deepEqual(first, second);
  assert.equal(first.decision, 'promoted');
});

test('thresholds get stricter as distribution widens', () => {
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i += 1) {
    const previous = LEVEL_THRESHOLDS[i - 1]!;
    const current = LEVEL_THRESHOLDS[i]!;
    assert.ok(
      current.minImpressions > previous.minImpressions,
      `level ${current.level} should need a larger sample than level ${previous.level}`,
    );
    assert.ok(current.maxQuickSkipRate <= previous.maxQuickSkipRate);
  }
});

test('an out-of-range level is clamped rather than trusted', () => {
  assert.equal(evaluate(99, { impressions: 0, views: 0, completions: 0, quickSkips: 0, engagements: 0 }).fromLevel, MAX_LEVEL);
  assert.equal(evaluate(0, { impressions: 0, views: 0, completions: 0, quickSkips: 0, engagements: 0 }).fromLevel, MIN_LEVEL);
});

// ── Weight bounds ──

test('every weight has sane bounds around its default', () => {
  for (const spec of WEIGHT_DEFAULTS) {
    assert.ok(spec.min < spec.max, `${spec.key} has an empty range`);
    assert.ok(
      spec.value >= spec.min && spec.value <= spec.max,
      `${spec.key} default ${spec.value} is outside [${spec.min}, ${spec.max}]`,
    );
    assert.ok(spec.description.length > 0, `${spec.key} has no description`);
  }
});

test('the admin surface PHASE_07 lists is all present', () => {
  const keys = new Set(WEIGHT_DEFAULTS.map((w) => w.key));
  for (const key of [
    'x_new_creator_rate', 'x_fresh_video_rate',
    'w_watch', 'w_completion', 'w_like', 'w_comment', 'w_share', 'w_save',
    'w_follow', 'w_rewatch', 'w_quality', 'w_freshness', 'w_creator_affinity',
    'w_trending', 'd_strength', 'r_candidate_pool',
  ]) {
    assert.ok(keys.has(key), `the admin surface is missing "${key}"`);
  }
});
