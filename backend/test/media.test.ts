/**
 * Media pipeline unit tests — ladder, HLS, probe validation, quality scoring.
 *
 * All pure functions, so these run with no database, server or FFmpeg.
 *
 * The quality section is the most important part of this file: it asserts that
 * ADR-011 holds structurally — a video is never suppressed for having been
 * recorded on a cheap phone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LADDER,
  ladderFor,
  renditionArgs,
  buildLadderPlan,
  rungBandwidth,
  scaledWidth,
  SEGMENT_SECONDS,
} from '../src/modules/media/ladder.ts';
import {
  buildMasterPlaylist,
  variantsFor,
  segmentArgs,
  posterArgs,
  thumbnailArgs,
  dbToAmplitude,
} from '../src/modules/media/hls.ts';
import {
  assertHeaderMatches,
  detectContainer,
  parseFrameRate,
  parseProbeOutput,
  EMPTY_PROBE,
} from '../src/modules/media/probe.ts';
import {
  scoreTechnical,
  scoreCaption,
  scoreVideo,
  canSuppress,
  technicalRankingAdjustment,
  MAX_TECHNICAL_INFLUENCE,
  type QualityComponents,
} from '../src/modules/media/quality.ts';

// ── ABR ladder ──

test('the ladder covers 240p through 1080p', () => {
  assert.deepEqual(LADDER.map((r) => r.label), ['240p', '360p', '480p', '720p', '1080p']);
});

test('bitrate rises monotonically up the ladder', () => {
  for (let i = 1; i < LADDER.length; i += 1) {
    assert.ok(
      LADDER[i]!.videoKbps > LADDER[i - 1]!.videoKbps,
      `${LADDER[i]!.label} must carry more bitrate than ${LADDER[i - 1]!.label}`,
    );
  }
});

test('the ladder never upscales beyond the source', () => {
  assert.deepEqual(ladderFor(720).map((r) => r.label), ['240p', '360p', '480p', '720p']);
  assert.deepEqual(ladderFor(480).map((r) => r.label), ['240p', '360p', '480p']);
  assert.deepEqual(ladderFor(1080).map((r) => r.label), ['240p', '360p', '480p', '720p', '1080p']);
});

test('a source smaller than the lowest rung still gets one rendition', () => {
  const rungs = ladderFor(144);
  assert.equal(rungs.length, 1, 'something playable must always be produced');
  assert.equal(rungs[0]!.label, '240p');
});

test('an unknown source height falls back to the full ladder', () => {
  assert.equal(ladderFor(0).length, 5);
  assert.equal(ladderFor(Number.NaN).length, 5);
});

test('scaled widths are always even', () => {
  // H.264 4:2:0 cannot encode odd dimensions.
  for (const height of [240, 360, 480, 720, 1080]) {
    for (const [sw, sh] of [[1080, 1920], [1079, 1921], [720, 1280], [999, 1777]] as const) {
      const width = scaledWidth(sw, sh, height);
      assert.equal(width % 2, 0, `${sw}x${sh} → ${height}p gave an odd width ${width}`);
    }
  }
});

test('every rendition uses the same keyframe interval', () => {
  // Adaptive switching only works when renditions can be cut at the same points.
  const gops = LADDER.map((rung) => {
    const args = renditionArgs('/in.mp4', rung, '/out.mp4', 30);
    return args[args.indexOf('-g') + 1];
  });
  assert.equal(new Set(gops).size, 1, `keyframe intervals differ across renditions: ${gops.join(', ')}`);
  assert.equal(gops[0], String(SEGMENT_SECONDS * 30));
});

test('scene detection is disabled so keyframes stay aligned', () => {
  const args = renditionArgs('/in.mp4', LADDER[2]!, '/out.mp4');
  const idx = args.indexOf('-sc_threshold');
  assert.ok(idx >= 0, 'scene-change keyframes would misalign the renditions');
  assert.equal(args[idx + 1], '0');
});

test('renditions are encoded browser-playable', () => {
  const args = renditionArgs('/in.mp4', LADDER[0]!, '/out.mp4');
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('+faststart'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
});

test('the ladder plan produces one output path per rung', () => {
  const plans = buildLadderPlan('/in.mp4', 1080, 1920, (label) => `/out/${label}.mp4`);
  assert.equal(plans.length, 5);
  assert.equal(plans[0]!.outputPath, '/out/240p.mp4');
  assert.ok(plans[4]!.args.includes('/out/1080p.mp4'));
});

test('bandwidth accounts for audio as well as video', () => {
  const rung = LADDER[0]!;
  assert.equal(rungBandwidth(rung), (rung.videoKbps + rung.audioKbps) * 1000);
});

// ── HLS ──

test('the master playlist lists variants cheapest first', () => {
  const variants = variantsFor(ladderFor(1080), 1080, 1920);
  const playlist = buildMasterPlaylist(variants);

  assert.ok(playlist.startsWith('#EXTM3U'));
  assert.match(playlist, /#EXT-X-VERSION:3/);

  const bandwidths = [...playlist.matchAll(/BANDWIDTH=(\d+)/g)].map((m) => Number(m[1]));
  const sorted = [...bandwidths].sort((a, b) => a - b);
  assert.deepEqual(bandwidths, sorted, 'a player picking the first entry should get the cheapest');
});

test('the master playlist declares a resolution for every variant', () => {
  const playlist = buildMasterPlaylist(variantsFor(ladderFor(720), 1080, 1920));
  const streams = [...playlist.matchAll(/#EXT-X-STREAM-INF:/g)].length;
  const resolutions = [...playlist.matchAll(/RESOLUTION=\d+x\d+/g)].length;
  assert.equal(streams, 4);
  assert.equal(resolutions, 4, 'a variant without a resolution cannot be chosen sensibly');
});

test('the playlist ends with a newline', () => {
  const playlist = buildMasterPlaylist(variantsFor(ladderFor(480), 1080, 1920));
  assert.ok(playlist.endsWith('\n'), 'some players reject a playlist with no trailing newline');
});

test('segmenting copies streams rather than re-encoding', () => {
  const args = segmentArgs('/in.mp4', '/out', '720p');
  assert.ok(args.includes('-c'));
  assert.equal(args[args.indexOf('-c') + 1], 'copy', 're-encoding would add a generation of loss');
  assert.ok(args.includes('vod'));
  const listSize = args[args.indexOf('-hls_list_size') + 1];
  assert.equal(listSize, '0', 'VOD playlists must retain every segment');
});

test('the poster frame seeks before the input for speed', () => {
  const args = posterArgs('/in.mp4', 3, '/out.jpg');
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), 'seeking after -i decodes from the start');
});

test('thumbnail extraction is bounded and avoids the very start', () => {
  const args = thumbnailArgs('/in.mp4', 10, 6, '/out_%02d.jpg');
  const frames = args[args.indexOf('-frames:v') + 1];
  assert.equal(frames, '6');

  // A request for an absurd number of frames is clamped rather than honoured.
  const clamped = thumbnailArgs('/in.mp4', 10, 500, '/out_%02d.jpg');
  assert.equal(Number(clamped[clamped.indexOf('-frames:v') + 1]), 20);
});

test('a very short video still yields a thumbnail interval', () => {
  const args = thumbnailArgs('/in.mp4', 0.2, 3, '/out_%02d.jpg');
  const vf = args[args.indexOf('-vf') + 1] ?? '';
  const interval = Number(/fps=1\/([\d.]+)/.exec(vf)?.[1]);
  assert.ok(Number.isFinite(interval) && interval > 0, `bad interval in ${vf}`);
});

test('dBFS converts to a sane 0..1 amplitude', () => {
  assert.equal(dbToAmplitude(0), 1);
  assert.equal(dbToAmplitude(-60), 0.001);
  assert.equal(dbToAmplitude(-100), 0.001, 'anything below -60 dB is silence');
  assert.equal(dbToAmplitude(Number.NEGATIVE_INFINITY), 0);
  assert.ok(dbToAmplitude(-6) > dbToAmplitude(-12));
});

// ── Magic bytes ──

const header = (bytes: number[], size = 32): Buffer => {
  const buf = Buffer.alloc(size);
  bytes.forEach((b, i) => {
    buf[i] = b;
  });
  return buf;
};

const MP4 = header([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const PNG = header([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = header([0xff, 0xd8, 0xff, 0xe0]);
const MKV = header([0x1a, 0x45, 0xdf, 0xa3]);

test('containers are detected from their magic bytes', () => {
  assert.equal(detectContainer(MP4), 'isobmff');
  assert.equal(detectContainer(PNG), 'png');
  assert.equal(detectContainer(JPEG), 'jpeg');
  assert.equal(detectContainer(MKV), 'matroska');
  assert.equal(detectContainer(header([0x00, 0x01, 0x02, 0x03])), null);
});

test('a matching header and declared type is accepted', () => {
  assert.equal(assertHeaderMatches(MP4, 'video/mp4'), 'isobmff');
  assert.equal(assertHeaderMatches(PNG, 'image/png'), 'png');
});

test('a file whose bytes contradict its declared type is refused', () => {
  // A PNG renamed and uploaded as a video.
  assert.throws(() => assertHeaderMatches(PNG, 'video/mp4'), /does not match the declared type/);
});

test('executables are refused however they are labelled', () => {
  const cases: [string, number[]][] = [
    ['Windows executable', [0x4d, 0x5a, 0x90, 0x00]],
    ['ELF executable', [0x7f, 0x45, 0x4c, 0x46]],
    ['Mach-O executable', [0xcf, 0xfa, 0xed, 0xfe]],
    ['shell script', [0x23, 0x21, 0x2f, 0x62]],
    ['Java class', [0xca, 0xfe, 0xba, 0xbe]],
  ];
  for (const [label, bytes] of cases) {
    assert.throws(
      () => assertHeaderMatches(header(bytes), 'video/mp4'),
      /not media|not a recognised/,
      `${label} must be refused`,
    );
  }
});

test('an unrecognised file is refused rather than assumed valid', () => {
  assert.throws(
    () => assertHeaderMatches(header([0xde, 0xad, 0xbe, 0xef]), 'video/mp4'),
    /not a recognised media format/,
  );
});

test('a truncated header does not crash detection', () => {
  assert.equal(detectContainer(Buffer.alloc(0)), null);
  assert.equal(detectContainer(Buffer.from([0xff])), null);
});

// ── ffprobe parsing ──

test('rational frame rates are parsed', () => {
  assert.equal(parseFrameRate('30/1'), 30);
  assert.equal(parseFrameRate('30000/1001'), 29.97);
  assert.equal(parseFrameRate('0/0'), null);
  assert.equal(parseFrameRate(undefined), null);
});

test('probe output is mapped into the pipeline shape', () => {
  const json = JSON.stringify({
    format: { format_name: 'mov,mp4', duration: '12.5', bit_rate: '2400000', size: '3750000' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, r_frame_rate: '30/1' },
      { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '44100' },
    ],
  });
  const result = parseProbeOutput(json);
  assert.equal(result.videoCodec, 'h264');
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.fps, 30);
  assert.equal(result.durationSec, 12.5);
  assert.equal(result.bitrateKbps, 2400);
  assert.equal(result.hasAudio, true);
  assert.equal(result.probed, true);
});

test('a video with no audio stream is reported as silent', () => {
  const json = JSON.stringify({
    format: { duration: '5' },
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 1280 }],
  });
  const result = parseProbeOutput(json);
  assert.equal(result.hasAudio, false);
  assert.equal(result.audioCodec, null);
});

test('rotation is read from side data or a legacy tag', () => {
  const sideData = parseProbeOutput(JSON.stringify({
    streams: [{ codec_type: 'video', side_data_list: [{ rotation: -90 }] }],
  }));
  assert.equal(sideData.rotation, 270, 'negative rotations should normalise into 0..359');

  const tagged = parseProbeOutput(JSON.stringify({
    streams: [{ codec_type: 'video', tags: { rotate: '180' } }],
  }));
  assert.equal(tagged.rotation, 180);
});

// ── Quality scoring ──

const probeFor = (over: Partial<typeof EMPTY_PROBE> = {}) => ({
  ...EMPTY_PROBE,
  probed: true,
  width: 1080,
  height: 1920,
  fps: 30,
  bitrateKbps: 4000,
  hasAudio: true,
  audioSampleRate: 44100,
  ...over,
});

test('a high-quality source scores well technically', () => {
  const { score } = scoreTechnical(probeFor());
  assert.ok(score >= 90, `expected a high technical score, got ${score}`);
});

test('a low-end source scores lower but is not near zero', () => {
  const { score } = scoreTechnical(
    probeFor({ width: 480, height: 854, fps: 24, bitrateKbps: 400, audioSampleRate: 22050 }),
  );
  assert.ok(score >= 45, `a modest phone should not be scored into the ground, got ${score}`);
  assert.ok(score < 85);
});

test('an unprobed video scores neutral rather than being penalised', () => {
  const { score } = scoreTechnical({ ...EMPTY_PROBE, probed: false });
  assert.equal(score, 50, 'a missing tool must not count against the creator');
});

test('bitrate is judged relative to resolution', () => {
  // 1500 kbps is generous at 480p and thin at 1080p.
  const at480 = scoreTechnical(probeFor({ height: 480, width: 270, bitrateKbps: 1500 }));
  const at1080 = scoreTechnical(probeFor({ height: 1080, width: 608, bitrateKbps: 1500 }));
  const b480 = (at480.detail.bitrate as { score: number }).score;
  const b1080 = (at1080.detail.bitrate as { score: number }).score;
  assert.ok(b480 > b1080, 'the same bitrate should score better at a lower resolution');
});

test('a caption with real words beats an empty one', () => {
  const good = scoreCaption({ caption: 'my dog learning a new trick today', hashtagCount: 2, mentionCount: 0 });
  const empty = scoreCaption({ caption: '', hashtagCount: 0, mentionCount: 0 });
  assert.ok(good.score > empty.score);
  assert.equal(good.spamHint, 0);
});

test('hashtag stuffing raises the spam hint, not the quality score', () => {
  const stuffed = scoreCaption({ caption: '#a #b #c #d #e #f', hashtagCount: 25, mentionCount: 0 });
  assert.ok(stuffed.spamHint >= 50, `expected a strong spam hint, got ${stuffed.spamHint}`);
});

test('mention spam is detected', () => {
  const spammy = scoreCaption({ caption: 'check this', hashtagCount: 0, mentionCount: 25 });
  assert.ok(spammy.spamHint >= 20);
});

test('a score is stored decomposed, never as one number', () => {
  const score = scoreVideo({
    probe: probeFor(),
    caption: { caption: 'a genuine caption about the video', hashtagCount: 2, mentionCount: 1 },
  });
  for (const key of [
    'technical', 'contentRelevance', 'thumbnailQuality', 'captionRelevance',
    'spamProbability', 'duplicateProbability', 'safetyStatus',
  ]) {
    assert.ok(key in score, `${key} must be stored separately`);
  }
  assert.ok(score.detail.technical, 'the reasoning must be inspectable');
  assert.equal(score.modelVersion.length > 0, true);
});

// ── ADR-011: technical quality never suppresses ──

const components = (over: Partial<QualityComponents> = {}): QualityComponents => ({
  technical: 50,
  contentRelevance: 50,
  thumbnailQuality: 50,
  captionRelevance: 50,
  spamProbability: 0,
  duplicateProbability: 0,
  safetyStatus: 'safe',
  ...over,
});

test('a technically poor video is NEVER suppressed', () => {
  // The core promise of ADR-011: a cheap phone is not a reason to bury someone.
  const result = canSuppress(components({ technical: 0 }));
  assert.equal(result.suppress, false, 'technical quality must not suppress distribution');
  assert.equal(result.reason, null);
});

test('nothing but spam, duplicate and safety can suppress', () => {
  // Drive every non-suppressing component to its worst value at once.
  const worst = components({
    technical: 0,
    contentRelevance: 0,
    thumbnailQuality: 0,
    captionRelevance: 0,
  });
  assert.equal(canSuppress(worst).suppress, false);
});

test('spam, duplicates and unsafe content do suppress', () => {
  assert.deepEqual(canSuppress(components({ spamProbability: 95 })), {
    suppress: true, reason: 'spam',
  });
  assert.deepEqual(canSuppress(components({ duplicateProbability: 90 })), {
    suppress: true, reason: 'duplicate',
  });
  assert.deepEqual(canSuppress(components({ safetyStatus: 'restricted' })), {
    suppress: true, reason: 'safety',
  });
});

test('content under review is not suppressed outright', () => {
  assert.equal(canSuppress(components({ safetyStatus: 'review' })).suppress, false);
});

test('technical quality can only nudge ranking, never dominate it', () => {
  const best = technicalRankingAdjustment(100);
  const worst = technicalRankingAdjustment(0);
  const neutral = technicalRankingAdjustment(50);

  assert.equal(neutral, 0);
  assert.ok(Math.abs(best) <= MAX_TECHNICAL_INFLUENCE, `${best} exceeds the cap`);
  assert.ok(Math.abs(worst) <= MAX_TECHNICAL_INFLUENCE, `${worst} exceeds the cap`);
  // The full spread between the best and worst possible video is 10%.
  assert.ok(best - worst <= MAX_TECHNICAL_INFLUENCE * 2 + 1e-9);
});

test('the technical adjustment is bounded even for impossible inputs', () => {
  for (const value of [-500, 1000, Number.NaN]) {
    const adjustment = technicalRankingAdjustment(value);
    assert.ok(
      Number.isFinite(adjustment) && Math.abs(adjustment) <= MAX_TECHNICAL_INFLUENCE,
      `${value} produced ${adjustment}`,
    );
  }
});
