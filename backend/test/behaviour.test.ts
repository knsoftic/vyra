/**
 * Behaviour intelligence unit tests — watch rules, interest maths, privacy.
 *
 * Pure functions, so these run with no database or server.
 *
 * The privacy section is the important one: PHASE_06 exit criterion 5 asks for
 * an audit showing no sensitive fields in event payloads. An audit is a
 * point-in-time check; these tests assert the mechanism that makes it hold.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  interpretWatch,
  watchEventsFor,
  countsAsView,
  SHORT_VIDEO_MS,
  LONG_VIDEO_MS,
} from '../src/modules/behaviour/watch.ts';
import {
  applySignal,
  blendHorizons,
  decayFactor,
  decayWeights,
  HALF_LIFE_DAYS,
  normalise,
  prune,
  rejectedTopics,
  topTopics,
  SIGNAL_WEIGHTS,
  MIN_WEIGHT,
} from '../src/modules/behaviour/interest.ts';
import {
  inspectPayload,
  sanitisePayload,
  sanitiseQuery,
  auditStoredDetail,
} from '../src/modules/behaviour/privacy.ts';
import {
  EVENT_FIELDS,
  FORBIDDEN_EVENT_FIELDS,
  ALL_EVENTS,
} from '../../shared/contracts/behaviour.ts';

// ── Watch rules (ADR-009) ──

test('on a short video, completion is what matters', () => {
  const full = interpretWatch({ watchMs: 9500, videoMs: 10_000 });
  assert.equal(full.rule, 'short_completion');
  assert.ok(full.strength >= 0.9, `expected a strong signal, got ${full.strength}`);

  const half = interpretWatch({ watchMs: 5000, videoMs: 10_000 });
  assert.ok(half.strength < full.strength);
});

test('the same 10 seconds means different things at different lengths', () => {
  // The whole point of ADR-009: duration alone is not a signal.
  const onShort = interpretWatch({ watchMs: 10_000, videoMs: 12_000 });
  const onLong = interpretWatch({ watchMs: 10_000, videoMs: 180_000 });
  assert.ok(
    onShort.strength > onLong.strength,
    `10s of a 12s video (${onShort.strength}) should beat 10s of a 3m video (${onLong.strength})`,
  );
});

test('a 20-second watch is a strong positive on a medium video', () => {
  const signal = interpretWatch({ watchMs: 20_000, videoMs: 25_000 });
  assert.equal(signal.rule, 'medium_20s');
  assert.ok(signal.strength >= 0.85, `expected a strong signal, got ${signal.strength}`);
});

test('a 30-second watch is a strong positive on a long video', () => {
  const signal = interpretWatch({ watchMs: 30_000, videoMs: 300_000 });
  assert.equal(signal.rule, 'long_30s');
  assert.ok(signal.strength >= 0.85, `expected a strong signal, got ${signal.strength}`);

  const shorter = interpretWatch({ watchMs: 25_000, videoMs: 300_000 });
  assert.ok(shorter.strength < signal.strength);
});

test('the rule boundaries land where ADR-009 says', () => {
  assert.equal(interpretWatch({ watchMs: 100, videoMs: SHORT_VIDEO_MS - 1 }).rule, 'short_completion');
  assert.equal(interpretWatch({ watchMs: 100, videoMs: SHORT_VIDEO_MS }).rule, 'medium_20s');
  assert.equal(interpretWatch({ watchMs: 100, videoMs: LONG_VIDEO_MS }).rule, 'medium_20s');
  assert.equal(interpretWatch({ watchMs: 100, videoMs: LONG_VIDEO_MS + 1 }).rule, 'long_30s');
});

test('a quick skip is negative evidence, not a weak positive', () => {
  const signal = interpretWatch({ watchMs: 800, videoMs: 30_000 });
  assert.equal(signal.quickSkip, true);
  assert.ok(signal.strength < 0, 'a skip should count against the topic, not merely fail to help');
});

test('a short video watched briefly is not a quick skip', () => {
  // There is nothing to skip out of on a 1.5-second video.
  const signal = interpretWatch({ watchMs: 900, videoMs: 1500 });
  assert.equal(signal.quickSkip, false);
});

test('rewatching strengthens the signal', () => {
  const once = interpretWatch({ watchMs: 10_000, videoMs: 10_000 });
  const twice = interpretWatch({ watchMs: 20_000, videoMs: 10_000, loops: 1 });
  assert.equal(twice.rewatched, true);
  assert.ok(twice.strength >= once.strength);
});

test('completion rate never exceeds 1, even when looping', () => {
  const signal = interpretWatch({ watchMs: 50_000, videoMs: 10_000, loops: 4 });
  assert.ok(signal.completionRate <= 1, `got ${signal.completionRate}`);
});

test('nonsense input produces a finite, bounded signal', () => {
  for (const input of [
    { watchMs: -5000, videoMs: 10_000 },
    { watchMs: 10_000, videoMs: 0 },
    { watchMs: Number.NaN, videoMs: 10_000 },
    { watchMs: 10_000, videoMs: Number.NaN },
    { watchMs: Number.POSITIVE_INFINITY, videoMs: 10_000 },
  ]) {
    const signal = interpretWatch(input);
    assert.ok(Number.isFinite(signal.strength), `strength was ${signal.strength} for ${JSON.stringify(input)}`);
    assert.ok(signal.strength >= -1 && signal.strength <= 1);
    assert.ok(Number.isFinite(signal.completionRate));
  }
});

test('threshold events are derived from the watch', () => {
  const events = watchEventsFor(interpretWatch({ watchMs: 31_000, videoMs: 60_000 }));
  assert.ok(events.includes('watch_2s'));
  assert.ok(events.includes('watch_30s'));
  assert.ok(!events.includes('completion'), 'half a video is not a completion');
});

test('a view requires more than an impression', () => {
  assert.equal(countsAsView(interpretWatch({ watchMs: 500, videoMs: 30_000 })), false);
  assert.equal(countsAsView(interpretWatch({ watchMs: 6000, videoMs: 30_000 })), true);
  assert.equal(countsAsView(interpretWatch({ watchMs: 6000, videoMs: 10_000 })), true);
  assert.equal(countsAsView(interpretWatch({ watchMs: 2000, videoMs: 10_000 })), false);
});

// ── Interest maths ──

test('decay halves a weight after one half-life', () => {
  assert.ok(Math.abs(decayFactor(3, 3) - 0.5) < 1e-9);
  assert.ok(Math.abs(decayFactor(6, 3) - 0.25) < 1e-9);
  assert.equal(decayFactor(0, 3), 1);
  assert.equal(decayFactor(-1, 3), 1);
});

test('short-term interest decays far faster than long-term', () => {
  const afterAWeek = { short: decayFactor(7, HALF_LIFE_DAYS.short), long: decayFactor(7, HALF_LIFE_DAYS.long) };
  assert.ok(afterAWeek.short < 0.25, 'a week-old signal should barely register short-term');
  assert.ok(afterAWeek.long > 0.85, 'a week-old signal should still count long-term');
});

test('weights below the floor are dropped when decayed', () => {
  const decayed = decayWeights({ gaming: 1, trivia: 0.02 }, 30, 'short');
  assert.ok(!('trivia' in decayed), 'a negligible weight should disappear rather than accumulate');
});

test('positive signals raise a topic and negatives lower it', () => {
  let weights = applySignal({}, 'gaming', 'like');
  assert.ok((weights.gaming ?? 0) > 0);

  weights = applySignal(weights, 'gaming', 'not_interested');
  assert.ok((weights.gaming ?? 0) < 0, 'an explicit rejection should push the topic below zero');
});

test('explicit rejection outweighs passive watching', () => {
  // Someone saying "not interested" is far more definite than a completed watch.
  assert.ok(
    Math.abs(SIGNAL_WEIGHTS.not_interested!) > SIGNAL_WEIGHTS.completion!,
    'a rejection must count for more than a watch, or explicit feedback gets ignored',
  );
  assert.ok(Math.abs(SIGNAL_WEIGHTS.hide_creator!) > SIGNAL_WEIGHTS.like!);
  assert.ok(Math.abs(SIGNAL_WEIGHTS.report!) > SIGNAL_WEIGHTS.follow!);
});

test('one bad session cannot permanently bury a topic', () => {
  let weights: Record<string, number> = { cooking: 5 };
  for (let i = 0; i < 50; i += 1) weights = applySignal(weights, 'cooking', 'not_interested');
  assert.ok((weights.cooking ?? 0) >= -3, `weight ran away to ${weights.cooking}`);
});

test('a topic cannot grow without bound either', () => {
  let weights: Record<string, number> = {};
  for (let i = 0; i < 200; i += 1) weights = applySignal(weights, 'gaming', 'save');
  assert.ok((weights.gaming ?? 0) <= 10, `weight ran away to ${weights.gaming}`);
});

test('signal strength scales the contribution', () => {
  const full = applySignal({}, 'gaming', 'completion', 1);
  const partial = applySignal({}, 'gaming', 'completion', 0.25);
  assert.ok(partial.gaming! < full.gaming!);
});

test('an unknown event changes nothing', () => {
  const before = { gaming: 1 };
  assert.deepEqual(applySignal(before, 'gaming', 'not_a_real_event'), before);
});

test('profiles stay bounded in size', () => {
  const weights: Record<string, number> = {};
  for (let i = 0; i < 500; i += 1) weights[`topic_${i}`] = Math.random() * 5;
  assert.equal(Object.keys(prune(weights, 100)).length, 100);
});

test('pruning keeps the strongest topics', () => {
  const pruned = prune({ a: 0.1, b: 9, c: 5, d: 0.2 }, 2);
  assert.deepEqual(Object.keys(pruned).sort(), ['b', 'c']);
});

test('normalising maps the strongest topic to 1 and negatives to 0', () => {
  const normalised = normalise({ gaming: 8, cooking: 4, opera: -2 });
  assert.equal(normalised.gaming, 1);
  assert.equal(normalised.cooking, 0.5);
  assert.equal(normalised.opera, 0, 'a rejected topic should normalise to zero, not a negative');
});

test('blending weights the short horizon more heavily', () => {
  const blended = blendHorizons({ gaming: 1 }, { cooking: 1 });
  assert.ok(blended.gaming! > blended.cooking!, 'recent interest should lead');
});

test('blending keeps a topic present in only one horizon', () => {
  const blended = blendHorizons({ gaming: 1 }, {});
  assert.ok(blended.gaming! > 0);
});

test('rejected topics are reported separately from merely unseen ones', () => {
  const rejected = rejectedTopics({ gaming: 2, opera: -1.5, ballet: 0 });
  assert.deepEqual(rejected, ['opera']);
});

test('top topics come back in order, excluding negatives', () => {
  const top = topTopics({ a: 1, b: 5, c: 3, d: -2 }, 2);
  assert.deepEqual(top.map((t) => t.topic), ['b', 'c']);
});

test('a negligible blended weight is dropped', () => {
  const blended = blendHorizons({ x: MIN_WEIGHT / 10 }, {});
  assert.ok(!('x' in blended));
});

// ── Privacy (ADR-008, exit criterion 5) ──

test('the event taxonomy covers every group PHASE_06 lists', () => {
  for (const event of [
    'impression', 'video_start',
    'watch_2s', 'watch_5s', 'watch_10s', 'watch_20s', 'watch_30s', 'completion', 'rewatch',
    'quick_skip', 'not_interested', 'hide_creator', 'report',
    'like', 'comment', 'share', 'save',
    'follow', 'unfollow', 'profile_visit',
    'search', 'category_view', 'hashtag_click',
  ]) {
    assert.ok(
      (ALL_EVENTS as readonly string[]).includes(event),
      `the taxonomy is missing "${event}"`,
    );
  }
});

test('a clean payload passes', () => {
  const verdict = inspectPayload({
    event: 'like', dedupeKey: 'k1', occurredAt: '2026-08-29T00:00:00Z', videoId: 'V1',
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.forbidden, []);
  assert.deepEqual(verdict.dropped, []);
});

test('every forbidden field is caught', () => {
  for (const field of FORBIDDEN_EVENT_FIELDS) {
    const verdict = inspectPayload({ event: 'like', [field]: 'value' });
    assert.equal(verdict.ok, false, `"${field}" was not caught`);
    assert.ok(verdict.forbidden.includes(field));
  }
});

test('forbidden fields are caught whatever their casing or separators', () => {
  for (const key of ['userEmail', 'user_email', 'USER-EMAIL', 'Latitude', 'gps_location']) {
    const verdict = inspectPayload({ event: 'like', [key]: 'x' });
    assert.equal(verdict.ok, false, `"${key}" slipped through`);
  }
});

test('an unknown but harmless field is dropped rather than rejected', () => {
  const verdict = inspectPayload({ event: 'like', someNewThing: 'x' });
  assert.equal(verdict.ok, true, 'an unrecognised field is not a privacy violation');
  assert.deepEqual(verdict.dropped, ['someNewThing']);
});

test('sanitising keeps only allowlisted fields', () => {
  const clean = sanitisePayload({
    event: 'like',
    dedupeKey: 'k1',
    videoId: 'V1',
    email: 'someone@example.com',
    latitude: 51.5,
    contacts: ['a', 'b'],
    somethingUnexpected: true,
  });

  assert.equal(clean.event, 'like');
  assert.equal(clean.videoId, 'V1');
  for (const key of ['email', 'latitude', 'contacts', 'somethingUnexpected']) {
    assert.ok(!(key in clean), `"${key}" survived sanitising`);
  }
});

test('the allowlist contains nothing sensitive', () => {
  // Guards against someone adding a field to EVENT_FIELDS that should not be there.
  const forbidden = new Set(FORBIDDEN_EVENT_FIELDS.map((f) => f.toLowerCase()));
  for (const field of EVENT_FIELDS) {
    const normalised = field.toLowerCase().replace(/[_\-\s]/g, '');
    assert.ok(
      ![...forbidden].some((bad) => normalised === bad || normalised.endsWith(bad)),
      `"${field}" is on the allowlist but matches a forbidden field`,
    );
  }
});

test('contact details pasted into a search box are stripped', () => {
  assert.match(sanitiseQuery('email me at someone@example.com'), /\[removed\]/);
  assert.match(sanitiseQuery('call +1 555 123 4567 now'), /\[removed\]/);
  assert.ok(!sanitiseQuery('someone@example.com').includes('@'));
});

test('an ordinary search query is left alone', () => {
  assert.equal(sanitiseQuery('best gaming setup 2026'), 'best gaming setup 2026');
});

test('a long query is truncated', () => {
  assert.ok(sanitiseQuery('x'.repeat(500)).length <= 120);
});

test('stored detail can be audited after the fact', () => {
  assert.equal(auditStoredDetail(null).ok, true);
  assert.equal(auditStoredDetail('{"rank":3}').ok, true);
  assert.equal(auditStoredDetail('{"email":"a@b.c"}').ok, false);
  // Malformed JSON is not a privacy failure.
  assert.equal(auditStoredDetail('not json').ok, true);
});
