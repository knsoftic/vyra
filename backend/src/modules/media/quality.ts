/**
 * Video quality scoring.
 *
 * Stored decomposed, never as one opaque number, because the components mean
 * different things and are allowed to do different things:
 *
 * | Component            | What it may do            |
 * |----------------------|---------------------------|
 * | technical            | mild ranking adjustment   |
 * | contentRelevance     | ranking input             |
 * | thumbnailQuality     | ranking + cover choice    |
 * | captionRelevance     | ranking input             |
 * | spamProbability      | may suppress              |
 * | duplicateProbability | may suppress              |
 * | safetyStatus         | may suppress or block     |
 *
 * **ADR-011 is enforced here, not merely documented.** A video is never
 * suppressed for being recorded on a cheap phone. `canSuppress` reads only the
 * spam, duplicate and safety components — the technical score is structurally
 * incapable of suppressing anything, and `technicalRankingAdjustment` is clamped
 * to a deliberately narrow band so it can nudge ordering and nothing more.
 *
 * The scoring itself is a pure function of measurements, so it is fully testable
 * and an admin can see exactly why a video scored what it did.
 */

import type { ProbeResult } from './probe.ts';

export type SafetyStatus = 'safe' | 'review' | 'restricted';

export interface QualityComponents {
  /** 0–100. Resolution, bitrate, frame rate, audio presence. */
  technical: number;
  contentRelevance: number;
  thumbnailQuality: number;
  captionRelevance: number;
  /** 0–100, higher is more likely to be spam. */
  spamProbability: number;
  duplicateProbability: number;
  safetyStatus: SafetyStatus;
}

export interface QualityScore extends QualityComponents {
  /** A convenience summary for display. Never used for suppression. */
  overall: number;
  /** Per-component explanation, so a decision can always be justified. */
  detail: Record<string, unknown>;
  modelVersion: string;
}

export const MODEL_VERSION = 'tech-v1';

/**
 * Clamps to 0–100, treating a non-finite input as neutral.
 *
 * `Math.min`/`Math.max` propagate NaN, so without this guard one bad measurement
 * would produce a NaN score, and a NaN ranking adjustment poisons every
 * comparison it touches without ever throwing.
 */
const clamp100 = (n: number): number => {
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
};

/**
 * Technical score from what a probe can measure.
 *
 * Weighted toward things that genuinely affect whether a video is watchable —
 * resolution and frame rate — rather than production value. A well-lit, steady
 * 480p clip should not be marked down heavily against a shaky 1080p one.
 */
export function scoreTechnical(probe: ProbeResult): { score: number; detail: Record<string, unknown> } {
  // Without a probe there is nothing to judge, so assume neutral rather than
  // penalise a video for the render host lacking a tool.
  if (!probe.probed) {
    return { score: 50, detail: { note: 'Not probed; neutral score assumed.' } };
  }

  const detail: Record<string, unknown> = {};

  const height = probe.height ?? 0;
  const resolutionScore =
    height >= 1080 ? 100 : height >= 720 ? 88 : height >= 480 ? 74 : height >= 360 ? 60 : 45;
  detail.resolution = { height, score: resolutionScore };

  const fps = probe.fps ?? 0;
  const fpsScore = fps >= 50 ? 100 : fps >= 28 ? 90 : fps >= 24 ? 78 : fps >= 15 ? 55 : 35;
  detail.frameRate = { fps, score: fpsScore };

  // Bitrate is judged relative to resolution: 2 Mbps is generous at 480p and
  // thin at 1080p, so a flat threshold would be meaningless.
  const bitrate = probe.bitrateKbps ?? 0;
  const expected = height >= 1080 ? 4000 : height >= 720 ? 2200 : height >= 480 ? 1000 : 600;
  const ratio = expected > 0 ? bitrate / expected : 0;
  const bitrateScore = ratio >= 0.9 ? 100 : ratio >= 0.6 ? 82 : ratio >= 0.35 ? 62 : ratio > 0 ? 42 : 50;
  detail.bitrate = { kbps: bitrate, expected, ratio: Math.round(ratio * 100) / 100, score: bitrateScore };

  const audioScore = probe.hasAudio ? (probe.audioSampleRate ?? 0) >= 44100 ? 100 : 75 : 40;
  detail.audio = { hasAudio: probe.hasAudio, sampleRate: probe.audioSampleRate, score: audioScore };

  // Vertical video is the native format here; other aspects are still fine, just
  // not ideal for a full-screen feed.
  const width = probe.width ?? 0;
  const isVertical = height > 0 && width > 0 && height / width >= 1.5;
  const aspectScore = isVertical ? 100 : width === height ? 80 : 65;
  detail.aspect = { width, height, vertical: isVertical, score: aspectScore };

  const score = clamp100(
    resolutionScore * 0.3 +
      fpsScore * 0.2 +
      bitrateScore * 0.2 +
      audioScore * 0.15 +
      aspectScore * 0.15,
  );

  return { score, detail };
}

export interface CaptionSignals {
  caption: string;
  hashtagCount: number;
  mentionCount: number;
}

/** Caption relevance: does the text describe the video, or is it tag soup? */
export function scoreCaption(signals: CaptionSignals): {
  score: number;
  spamHint: number;
  detail: Record<string, unknown>;
} {
  const text = signals.caption.trim();
  const words = text.split(/\s+/).filter((w) => w.length > 0 && !w.startsWith('#') && !w.startsWith('@'));

  let score = 50;
  const detail: Record<string, unknown> = { length: text.length, realWords: words.length };

  if (words.length >= 3) score += 20;
  if (words.length >= 8) score += 10;
  if (text.length === 0) score = 25;

  // A wall of hashtags with no actual caption is the classic reach-farming
  // pattern, and it is a spam hint rather than a quality judgement.
  let spamHint = 0;
  if (signals.hashtagCount > 10) spamHint += 25;
  if (signals.hashtagCount > 20) spamHint += 25;
  if (signals.mentionCount > 10) spamHint += 20;
  if (signals.hashtagCount > 5 && words.length === 0) spamHint += 30;

  const shouty = text.length > 20 && text === text.toUpperCase();
  if (shouty) spamHint += 10;
  detail.allCaps = shouty;
  detail.hashtags = signals.hashtagCount;
  detail.mentions = signals.mentionCount;

  return { score: clamp100(score), spamHint: clamp100(spamHint), detail };
}

export interface ScoreInput {
  probe: ProbeResult;
  caption: CaptionSignals;
  /** 0–100 from perceptual hashing, when duplicate detection has run. */
  duplicateProbability?: number;
  /** Set by moderation; scoring never decides this on its own. */
  safetyStatus?: SafetyStatus;
  /** 0–100 measure of the chosen cover frame. */
  thumbnailQuality?: number;
}

export function scoreVideo(input: ScoreInput): QualityScore {
  const technical = scoreTechnical(input.probe);
  const caption = scoreCaption(input.caption);

  const spamProbability = clamp100(caption.spamHint);
  const duplicateProbability = clamp100(input.duplicateProbability ?? 0);
  const safetyStatus = input.safetyStatus ?? 'safe';

  // Content relevance needs signals that do not exist until Phase 6/7 (embeddings,
  // classification). Neutral is the honest placeholder — a made-up number here
  // would quietly influence ranking with no basis.
  const contentRelevance = 50;
  const thumbnailQuality = clamp100(input.thumbnailQuality ?? 50);

  const overall = clamp100(
    technical.score * 0.35 +
      contentRelevance * 0.2 +
      thumbnailQuality * 0.2 +
      caption.score * 0.25,
  );

  return {
    overall,
    technical: technical.score,
    contentRelevance,
    thumbnailQuality,
    captionRelevance: caption.score,
    spamProbability,
    duplicateProbability,
    safetyStatus,
    detail: {
      technical: technical.detail,
      caption: caption.detail,
      note: 'Content relevance is a neutral placeholder until Phase 6/7 supplies real signals.',
    },
    modelVersion: MODEL_VERSION,
  };
}

/** Thresholds an admin can tune. Kept here so the rule is visible in one place. */
export const SUPPRESSION_THRESHOLDS = {
  spamProbability: 70,
  duplicateProbability: 85,
} as const;

/**
 * Whether a score justifies suppressing distribution.
 *
 * This function is the enforcement point for ADR-011. It reads spam, duplicate
 * and safety — and nothing else. `technical` is deliberately not in scope, so no
 * future edit can accidentally make a low-end camera a reason to bury someone's
 * video.
 */
export function canSuppress(score: QualityComponents): {
  suppress: boolean;
  reason: 'spam' | 'duplicate' | 'safety' | null;
} {
  if (score.safetyStatus === 'restricted') return { suppress: true, reason: 'safety' };
  if (score.spamProbability >= SUPPRESSION_THRESHOLDS.spamProbability) {
    return { suppress: true, reason: 'spam' };
  }
  if (score.duplicateProbability >= SUPPRESSION_THRESHOLDS.duplicateProbability) {
    return { suppress: true, reason: 'duplicate' };
  }
  return { suppress: false, reason: null };
}

/**
 * How much the technical score may move ranking.
 *
 * Clamped to ±5% on purpose. Technical quality is allowed to break ties between
 * otherwise comparable videos; it is not allowed to decide who gets an audience.
 * Audience response outweighs it, as PHASE_05 requires.
 */
export const MAX_TECHNICAL_INFLUENCE = 0.05;

export function technicalRankingAdjustment(technical: number): number {
  const normalised = (clamp100(technical) - 50) / 50; // -1..1
  return Math.round(normalised * MAX_TECHNICAL_INFLUENCE * 1000) / 1000;
}
