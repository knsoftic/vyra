/**
 * Grade → FFmpeg and EDL validation.
 *
 * These are pure functions, so they run without FFmpeg, a database or a server.
 * They cover the property PHASE_04 actually depends on: the device preview and
 * the server render read the same numbers, and a hostile edit list cannot reach
 * the renderer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gradeToFilters,
  gradeToFilterChain,
  isNeutralGrade,
  normaliseGrade,
} from '../src/modules/creative/grade.ts';
import {
  buildRenderPlan,
  escapeFilterValue,
  resolveGrade,
} from '../src/modules/creative/render.ts';
import {
  assertCoherent,
  edlSchema,
  timelineDurationMs,
  collectSourceKeys,
} from '../src/modules/creative/edl.ts';
import { NEUTRAL_GRADE, type EditDecisionList } from '../../shared/contracts/creative.ts';
import {
  FILTER_PRESETS,
  mergeGrades,
  scaleGrade,
} from '../../shared/contracts/filter-presets.ts';

// ── The shared parameter set ──

test('a neutral grade produces no filters at all', () => {
  assert.deepEqual(gradeToFilters(NEUTRAL_GRADE), []);
  assert.equal(gradeToFilterChain(NEUTRAL_GRADE), null);
  assert.equal(isNeutralGrade(NEUTRAL_GRADE), true);
});

test('intensity 0 is always the untouched frame', () => {
  for (const preset of FILTER_PRESETS) {
    const scaled = scaleGrade(preset.grade, 0);
    assert.deepEqual(
      gradeToFilters(scaled),
      [],
      `${preset.slug} at intensity 0 must not change the frame`,
    );
  }
});

test('intensity 100 reproduces the preset exactly', () => {
  for (const preset of FILTER_PRESETS) {
    assert.deepEqual(scaleGrade(preset.grade, 100), preset.grade, preset.slug);
  }
});

test('intensity scales linearly toward neutral', () => {
  const preset = FILTER_PRESETS.find((p) => p.slug === 'vibrant');
  assert.ok(preset);
  const half = scaleGrade(preset.grade, 50);
  assert.equal(half.saturation, preset.grade.saturation / 2);
  assert.equal(half.contrast, preset.grade.contrast / 2);
});

test('all 20 required filters exist and are uniquely named', () => {
  assert.equal(FILTER_PRESETS.length, 20);
  const slugs = FILTER_PRESETS.map((p) => p.slug);
  assert.equal(new Set(slugs).size, 20, 'slugs must be unique');

  const required = [
    'original', 'natural', 'warm', 'cool', 'bright', 'dark', 'vintage', 'film',
    'cinematic', 'retro', 'black_white', 'sepia', 'vibrant', 'soft',
    'high_contrast', 'low_contrast', 'golden', 'night', 'portrait', 'landscape',
  ];
  for (const slug of required) {
    assert.ok(slugs.includes(slug), `PHASE_04 requires a "${slug}" filter`);
  }
});

test('"Original" is genuinely a no-op', () => {
  const original = FILTER_PRESETS.find((p) => p.slug === 'original');
  assert.ok(original);
  assert.deepEqual(gradeToFilters(original.grade), []);
});

test('every preset except Original changes the frame', () => {
  for (const preset of FILTER_PRESETS) {
    if (preset.slug === 'original') continue;
    assert.ok(
      gradeToFilters(preset.grade).length > 0,
      `${preset.slug} produces no filters — it would look identical to Original`,
    );
  }
});

test('every preset generates a syntactically plausible graph', () => {
  for (const preset of FILTER_PRESETS) {
    const chain = gradeToFilterChain(preset.grade);
    if (chain === null) continue;
    // No empty links, no trailing separators, no unfinished options.
    assert.ok(!chain.includes(',,'), `${preset.slug}: empty filter link`);
    assert.ok(!chain.endsWith(','), `${preset.slug}: trailing comma`);
    assert.ok(!chain.includes('=:'), `${preset.slug}: empty option value`);
    assert.ok(!/NaN|Infinity|undefined/.test(chain), `${preset.slug}: bad number in ${chain}`);
  }
});

test('grade values stay inside each FFmpeg filter\'s legal range', () => {
  // The extremes are what would push a value out of range if a scale were wrong.
  const extremes = [-100, -50, 0, 50, 100];
  for (const value of extremes) {
    const grade = { ...NEUTRAL_GRADE, brightness: value, contrast: value, saturation: value };
    const chain = gradeToFilters(grade).join(',');

    const brightness = /brightness=(-?[\d.]+)/.exec(chain);
    if (brightness) {
      const n = Number(brightness[1]);
      assert.ok(n >= -1 && n <= 1, `eq brightness ${n} is outside -1..1`);
    }
    const contrast = /contrast=(-?[\d.]+)/.exec(chain);
    if (contrast) {
      const n = Number(contrast[1]);
      assert.ok(n >= 0 && n <= 3, `eq contrast ${n} is outside 0..3`);
    }
    const saturation = /saturation=(-?[\d.]+)/.exec(chain);
    if (saturation) {
      const n = Number(saturation[1]);
      assert.ok(n >= 0 && n <= 3, `eq saturation ${n} is outside 0..3`);
    }
  }
});

test('black & white fully desaturates', () => {
  const bw = FILTER_PRESETS.find((p) => p.slug === 'black_white');
  assert.ok(bw);
  const chain = gradeToFilters(bw.grade).join(',');
  assert.match(chain, /saturation=0\b/, 'saturation must reach exactly 0');
});

test('vignette is applied after sharpening', () => {
  const grade = { ...NEUTRAL_GRADE, sharpness: 60, vignette: 60 };
  const filters = gradeToFilters(grade);
  const sharpenAt = filters.findIndex((f) => f.startsWith('unsharp'));
  const vignetteAt = filters.findIndex((f) => f.startsWith('vignette'));
  assert.ok(sharpenAt >= 0 && vignetteAt >= 0);
  assert.ok(sharpenAt < vignetteAt, 'sharpening darkened corners would be wrong');
});

test('grades merge additively and stay clamped', () => {
  const merged = mergeGrades(
    { ...NEUTRAL_GRADE, contrast: 80 },
    { contrast: 60, vignette: -40 },
  );
  assert.equal(merged.contrast, 100, 'must clamp at the top of the range');
  assert.equal(merged.vignette, 0, 'one-sided controls must not go negative');
});

test('normaliseGrade fills gaps with neutral values', () => {
  const grade = normaliseGrade({ contrast: 20 });
  assert.equal(grade.contrast, 20);
  assert.equal(grade.saturation, 0);
  assert.equal(grade.vignette, 0);
});

test('an unknown filter slug falls back to neutral rather than throwing', () => {
  assert.deepEqual(resolveGrade('does_not_exist', 100, undefined), NEUTRAL_GRADE);
});

// ── Filter-graph escaping ──

test('text that would break out of a filter argument is escaped', () => {
  for (const [input, mustNotContainRaw] of [
    ["it's", "'"],
    ['a:b', ':'],
    ['a,b', ','],
    ['a[b]', '['],
    ['50%', '%'],
    ['back\\slash', '\\s'],
  ] as const) {
    const escaped = escapeFilterValue(input);
    assert.ok(
      !escaped.includes(mustNotContainRaw) || escaped.includes(`\\\\${mustNotContainRaw}`),
      `${input} → ${escaped} leaves ${mustNotContainRaw} unescaped`,
    );
  }
});

test('newlines in caption text are encoded, not emitted raw', () => {
  const escaped = escapeFilterValue('line one\nline two');
  assert.ok(!escaped.includes('\n'), 'a raw newline would truncate the filter graph');
});

// ── Render plan ──

const clip = (over: Partial<EditDecisionList['clips'][number]> = {}) => ({
  id: 'c1',
  sourceKey: 'videos/2026/08/29/abc.mp4',
  trimStartMs: 0,
  trimEndMs: 5000,
  speed: 1,
  rotation: 0 as const,
  volume: 100,
  muted: false,
  ...over,
});

const edl = (over: Partial<EditDecisionList> = {}): EditDecisionList => ({
  version: 1,
  clips: [clip()],
  effects: [],
  texts: [],
  stickers: [],
  audio: [],
  aspect: '9:16',
  ...over,
});

test('a render plan names every input and maps both streams', () => {
  const plan = buildRenderPlan(edl(), '/out/final.mp4', (k) => `/media/${k}`);
  assert.ok(plan.args.includes('-i'));
  assert.ok(plan.args.includes('/media/videos/2026/08/29/abc.mp4'));
  assert.ok(plan.args.includes('-filter_complex'));
  assert.ok(plan.args.includes('/out/final.mp4'));
  assert.match(plan.filterGraph, /concat=n=1:v=1:a=1/);
  assert.equal(plan.durationMs, 5000);
});

test('output is browser-playable', () => {
  const plan = buildRenderPlan(edl(), '/out/final.mp4', (k) => k);
  // Without yuv420p and faststart the file will not play in Safari or start
  // before it is fully downloaded.
  assert.ok(plan.args.includes('yuv420p'));
  assert.ok(plan.args.includes('+faststart'));
});

test('speed changes adjust video and audio together', () => {
  const plan = buildRenderPlan(edl({ clips: [clip({ speed: 2 })] }), '/o.mp4', (k) => k);
  assert.match(plan.filterGraph, /setpts=0\.500000\*PTS/);
  assert.match(plan.filterGraph, /atempo=2\.000000/, 'audio must follow video speed');
  assert.equal(plan.durationMs, 2500);
});

test('speeds beyond atempo\'s range are chained into legal stages', () => {
  const plan = buildRenderPlan(edl({ clips: [clip({ speed: 4 })] }), '/o.mp4', (k) => k);
  const stages = [...plan.filterGraph.matchAll(/atempo=([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(stages.length >= 2, 'a 4x speed needs more than one atempo stage');
  for (const s of stages) {
    assert.ok(s >= 0.5 && s <= 2, `atempo=${s} is outside FFmpeg's legal 0.5–2.0 range`);
  }
  // The stages must actually multiply back to the requested speed.
  const product = stages.reduce((a, b) => a * b, 1);
  assert.ok(Math.abs(product - 4) < 0.001, `stages multiply to ${product}, expected 4`);
});

test('a muted clip is silenced rather than dropped', () => {
  const plan = buildRenderPlan(edl({ clips: [clip({ muted: true })] }), '/o.mp4', (k) => k);
  assert.match(plan.filterGraph, /volume=0\.0000/);
});

test('rotation and crop appear in the chain', () => {
  const plan = buildRenderPlan(
    edl({ clips: [clip({ rotation: 90, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } })] }),
    '/o.mp4',
    (k) => k,
  );
  assert.match(plan.filterGraph, /transpose=1/);
  assert.match(plan.filterGraph, /crop=/);
});

test('clips are padded to a common size so concat cannot fail', () => {
  const plan = buildRenderPlan(
    edl({ clips: [clip({ id: 'a' }), clip({ id: 'b', sourceKey: 'videos/x/y/z.mp4' })] }),
    '/o.mp4',
    (k) => k,
  );
  const pads = [...plan.filterGraph.matchAll(/pad=1080:1920/g)];
  assert.equal(pads.length, 2, 'every clip must be padded to the output frame');
  assert.match(plan.filterGraph, /concat=n=2/);
});

test('each aspect ratio renders at its own size', () => {
  for (const [aspect, expected] of [
    ['9:16', '1080:1920'],
    ['1:1', '1080:1080'],
    ['16:9', '1920:1080'],
    ['4:5', '1080:1350'],
  ] as const) {
    const plan = buildRenderPlan(edl({ aspect }), '/o.mp4', (k) => k);
    assert.ok(plan.filterGraph.includes(`pad=${expected}`), `${aspect} should pad to ${expected}`);
  }
});

test('a text overlay becomes a time-windowed drawtext', () => {
  const plan = buildRenderPlan(
    edl({
      texts: [{
        id: 't1', text: 'Hello', fontSlug: 'inter', sizePx: 48, color: '#ffffff',
        align: 'center', x: 0.5, y: 0.5, rotation: 0, startMs: 1000, endMs: 3000,
      }],
    }),
    '/o.mp4',
    (k) => k,
  );
  assert.match(plan.filterGraph, /drawtext=/);
  assert.match(plan.filterGraph, /enable='between\(t,1,3\)'/);
});

test('a caption containing quotes cannot break the filter graph', () => {
  const plan = buildRenderPlan(
    edl({
      texts: [{
        id: 't1', text: "it's 50%: [wow]", fontSlug: 'inter', sizePx: 48, color: '#ffffff',
        align: 'left', x: 0.1, y: 0.1, rotation: 0, startMs: 0, endMs: 1000,
      }],
    }),
    '/o.mp4',
    (k) => k,
  );
  // The text option must remain a single quoted value.
  const match = /text='((?:[^']|\\')*)'/.exec(plan.filterGraph);
  assert.ok(match, 'the text argument should still be quoted');
});

test('music mixes over the clip audio instead of replacing it', () => {
  const plan = buildRenderPlan(
    edl({
      audio: [{
        id: 'm1', kind: 'music', sourceKey: 'audios/2026/08/29/song.mp3',
        startMs: 0, trimStartMs: 0, trimEndMs: 5000, volume: 60,
      }],
    }),
    '/o.mp4',
    (k) => k,
  );
  assert.match(plan.filterGraph, /amix=inputs=2/);
  assert.match(plan.filterGraph, /volume=0\.6000/);
  assert.ok(plan.args.includes('audios/2026/08/29/song.mp3'));
});

test('the timeline grade reaches the render', () => {
  const plan = buildRenderPlan(
    edl({ filterSlug: 'vibrant', filterIntensity: 100 }),
    '/o.mp4',
    (k) => k,
  );
  assert.match(plan.filterGraph, /saturation=/, 'the vibrant filter should raise saturation');
});

// ── EDL validation ──

test('a well-formed edit list parses', () => {
  const parsed = edlSchema.parse(edl());
  assert.equal(parsed.clips.length, 1);
  assert.equal(timelineDurationMs(parsed as EditDecisionList), 5000);
});

test('an edit list with no clips is refused', () => {
  assert.throws(() => edlSchema.parse(edl({ clips: [] })));
});

test('a clip whose trim ends before it starts is refused', () => {
  assert.throws(
    () => assertCoherent(edl({ clips: [clip({ trimStartMs: 5000, trimEndMs: 1000 })] })),
    /could not be rendered/,
  );
});

test('a zero or negative speed is refused', () => {
  // Speed divides duration, so 0 would mean an infinite timeline.
  assert.throws(() => edlSchema.parse(edl({ clips: [clip({ speed: 0 })] })));
  assert.throws(() => edlSchema.parse(edl({ clips: [clip({ speed: -1 })] })));
});

test('a path-traversing source key is refused', () => {
  for (const key of ['../../etc/passwd', '/etc/passwd', 'videos/../../secret.mp4']) {
    let rejected = false;
    try {
      edlSchema.parse(edl({ clips: [clip({ sourceKey: key })] }));
    } catch {
      rejected = true;
    }
    assert.ok(rejected, `${key} must be rejected`);
  }
});

test('duplicate clip ids are refused', () => {
  assert.throws(
    () => assertCoherent(edl({ clips: [clip({ id: 'same' }), clip({ id: 'same' })] })),
    /could not be rendered/,
  );
});

test('an overlay ending before it starts is refused', () => {
  assert.throws(
    () =>
      assertCoherent(
        edl({
          texts: [{
            id: 't', text: 'x', fontSlug: 'inter', sizePx: 20, color: '#ffffff',
            align: 'left', x: 0, y: 0, rotation: 0, startMs: 3000, endMs: 1000,
          }],
        }),
      ),
    /could not be rendered/,
  );
});

test('out-of-range values are refused rather than clamped', () => {
  assert.throws(() => edlSchema.parse(edl({ grade: { contrast: 5000 } })));
  assert.throws(() => edlSchema.parse(edl({ clips: [clip({ volume: 900 })] })));
  assert.throws(() => edlSchema.parse(edl({ filterIntensity: 400 })));
});

test('an oversized text overlay is refused', () => {
  assert.throws(() =>
    edlSchema.parse(
      edl({
        texts: [{
          id: 't', text: 'x'.repeat(5000), fontSlug: 'inter', sizePx: 20, color: '#ffffff',
          align: 'left', x: 0, y: 0, rotation: 0, startMs: 0, endMs: 1000,
        }],
      }),
    ),
  );
});

test('a non-hex text colour is refused', () => {
  assert.throws(() =>
    edlSchema.parse(
      edl({
        texts: [{
          id: 't', text: 'x', fontSlug: 'inter', sizePx: 20,
          color: 'red; rm -rf /', align: 'left', x: 0, y: 0, rotation: 0,
          startMs: 0, endMs: 1000,
        }],
      }),
    ),
  );
});

test('unknown keys are stripped rather than carried through', () => {
  const parsed = edlSchema.parse({ ...edl(), evil: 'payload' } as Record<string, unknown>);
  assert.ok(!('evil' in parsed));
});

test('collectSourceKeys finds clip and audio sources for the ownership check', () => {
  const keys = collectSourceKeys(
    edl({
      clips: [clip({ sourceKey: 'videos/a.mp4' })],
      audio: [{
        id: 'm', kind: 'music', sourceKey: 'audios/b.mp3',
        startMs: 0, trimStartMs: 0, trimEndMs: 1000, volume: 50,
      }],
    }),
  );
  assert.deepEqual(keys.sort(), ['audios/b.mp3', 'videos/a.mp4']);
});

test('timeline duration accounts for per-clip speed', () => {
  const list = edl({
    clips: [
      clip({ id: 'a', trimStartMs: 0, trimEndMs: 4000, speed: 2 }),
      clip({ id: 'b', trimStartMs: 0, trimEndMs: 3000, speed: 0.5 }),
    ],
  });
  assert.equal(timelineDurationMs(list), 2000 + 6000);
});
