/**
 * Edit decision list validation.
 *
 * The EDL arrives from the client and drives a server-side FFmpeg render, which
 * makes it the highest-risk input in the application. Three things are enforced
 * here, and none of them can be skipped by a caller:
 *
 *  1. **Shape.** Every field is schema-checked, unknown keys are stripped, and
 *     numbers are bounded. An unbounded value reaches FFmpeg as a command
 *     argument.
 *  2. **Ownership.** Every `sourceKey` must belong to a completed upload made by
 *     this user. Without it, a crafted EDL could render someone else's footage.
 *  3. **Sanity.** Durations, trim ranges and overlay windows must be coherent —
 *     a clip whose trim ends before it starts produces either a broken render or
 *     an FFmpeg process that never terminates.
 *
 * Text overlays get particular attention: their content ends up in a `drawtext`
 * filter, where an unescaped quote or backslash breaks out of the argument.
 */

import { z } from 'zod';
import { AppError } from '../../core/errors.ts';
import { assertSafeKey } from '../../core/storage.ts';
import type { EditDecisionList } from '../../../../shared/contracts/creative.ts';

/** No single video may exceed this, regardless of admin limits. */
const MAX_TIMELINE_MS = 60 * 60 * 1000;
const MAX_CLIPS = 100;
const MAX_OVERLAYS = 50;

const storageKeySchema = z
  .string()
  .min(1)
  .max(400)
  .refine((k) => {
    try {
      assertSafeKey(k);
      return true;
    } catch {
      return false;
    }
  }, 'Invalid storage key.');

const gradeSchema = z
  .object({
    brightness: z.number().min(-100).max(100),
    contrast: z.number().min(-100).max(100),
    saturation: z.number().min(-100).max(100),
    exposure: z.number().min(-100).max(100),
    highlights: z.number().min(-100).max(100),
    shadows: z.number().min(-100).max(100),
    temperature: z.number().min(-100).max(100),
    tint: z.number().min(-100).max(100),
    sharpness: z.number().min(0).max(100),
    fade: z.number().min(0).max(100),
    vignette: z.number().min(0).max(100),
  })
  .partial();

const slugSchema = z.string().regex(/^[a-z0-9_]{1,40}$/, 'Invalid catalogue slug.');

const clipSchema = z.object({
  id: z.string().min(1).max(64),
  sourceKey: storageKeySchema,
  trimStartMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  trimEndMs: z.number().int().min(1).max(MAX_TIMELINE_MS),
  // Bounded because speed divides duration; 0 would be an infinite timeline.
  speed: z.number().min(0.25).max(4),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0.01).max(1),
      height: z.number().min(0.01).max(1),
    })
    .optional(),
  filterSlug: slugSchema.optional(),
  filterIntensity: z.number().min(0).max(100).optional(),
  grade: gradeSchema.optional(),
  volume: z.number().min(0).max(100),
  muted: z.boolean(),
});

const textSchema = z.object({
  id: z.string().min(1).max(64),
  // Length-capped: this becomes a drawtext argument.
  text: z.string().min(1).max(500),
  fontSlug: slugSchema,
  sizePx: z.number().int().min(8).max(400),
  color: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Use a hex colour.'),
  backgroundColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Use a hex colour.')
    .optional(),
  align: z.enum(['left', 'center', 'right']),
  x: z.number().min(-1).max(2),
  y: z.number().min(-1).max(2),
  rotation: z.number().min(-360).max(360),
  startMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  endMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  animation: z.enum(['none', 'fade', 'slide', 'pop', 'typewriter']).optional(),
});

const stickerSchema = z.object({
  id: z.string().min(1).max(64),
  stickerId: z.string().min(1).max(64),
  packSlug: slugSchema,
  x: z.number().min(-1).max(2),
  y: z.number().min(-1).max(2),
  scale: z.number().min(0.05).max(10),
  rotation: z.number().min(-360).max(360),
  startMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  endMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
});

const effectSchema = z.object({
  id: z.string().min(1).max(64),
  effectSlug: slugSchema,
  startMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  endMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  params: z.record(z.string().max(40), z.union([z.number(), z.string().max(80)])).optional(),
});

const audioSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['original', 'music', 'voiceover']),
  sourceKey: storageKeySchema.optional(),
  musicTrackId: z.string().max(64).optional(),
  startMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  trimStartMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  trimEndMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  volume: z.number().min(0).max(100),
  fadeInMs: z.number().int().min(0).max(30_000).optional(),
  fadeOutMs: z.number().int().min(0).max(30_000).optional(),
});

export const edlSchema = z.object({
  version: z.literal(1),
  clips: z.array(clipSchema).min(1).max(MAX_CLIPS),
  filterSlug: slugSchema.optional(),
  filterIntensity: z.number().min(0).max(100).optional(),
  grade: gradeSchema.optional(),
  effects: z.array(effectSchema).max(MAX_OVERLAYS).default([]),
  texts: z.array(textSchema).max(MAX_OVERLAYS).default([]),
  stickers: z.array(stickerSchema).max(MAX_OVERLAYS).default([]),
  audio: z.array(audioSchema).max(10).default([]),
  aspect: z.enum(['9:16', '1:1', '16:9', '4:5']),
  beauty: z
    .object({
      skinSmoothing: z.number().min(0).max(100),
      brightness: z.number().min(0).max(100),
      faceLight: z.number().min(0).max(100),
      backgroundBlur: z.number().min(0).max(100),
    })
    .optional(),
});

/** Total output length in milliseconds, accounting for per-clip speed. */
export function timelineDurationMs(edl: EditDecisionList): number {
  return edl.clips.reduce((total, clip) => {
    const span = clip.trimEndMs - clip.trimStartMs;
    return total + Math.round(span / (clip.speed || 1));
  }, 0);
}

/** Structural checks the schema cannot express on its own. */
export function assertCoherent(edl: EditDecisionList): void {
  const problems: Record<string, string[]> = {};
  const add = (field: string, message: string) => {
    (problems[field] ??= []).push(message);
  };

  edl.clips.forEach((clip, i) => {
    if (clip.trimEndMs <= clip.trimStartMs) {
      add(`clips.${i}`, 'Clip end must come after its start.');
    }
  });

  const duration = timelineDurationMs(edl);
  if (duration <= 0) add('clips', 'The timeline is empty.');
  if (duration > MAX_TIMELINE_MS) add('clips', 'The timeline is too long.');

  const checkWindow = (label: string, i: number, startMs: number, endMs: number) => {
    if (endMs <= startMs) add(`${label}.${i}`, 'End must come after start.');
    if (startMs > duration) add(`${label}.${i}`, 'Starts after the video ends.');
  };
  edl.texts.forEach((t, i) => checkWindow('texts', i, t.startMs, t.endMs));
  edl.stickers.forEach((s, i) => checkWindow('stickers', i, s.startMs, s.endMs));
  edl.effects.forEach((e, i) => checkWindow('effects', i, e.startMs, e.endMs));

  edl.audio.forEach((a, i) => {
    if (a.trimEndMs <= a.trimStartMs) add(`audio.${i}`, 'Audio end must come after its start.');
    if (a.kind !== 'original' && !a.sourceKey && !a.musicTrackId) {
      add(`audio.${i}`, 'Music and voiceover tracks need a source.');
    }
  });

  const ids = edl.clips.map((c) => c.id);
  if (new Set(ids).size !== ids.length) add('clips', 'Clip ids must be unique.');

  if (Object.keys(problems).length > 0) {
    throw new AppError('validation_failed', 'This edit could not be rendered.', {
      details: problems,
    });
  }
}

/** Every storage key the EDL refers to. */
export function collectSourceKeys(edl: EditDecisionList): string[] {
  const keys = edl.clips.map((c) => c.sourceKey);
  for (const track of edl.audio) {
    if (track.sourceKey) keys.push(track.sourceKey);
  }
  return keys;
}

/**
 * The only entry point routes should use. Parses, checks coherence, and confirms
 * every referenced asset belongs to the caller.
 *
 * The ownership check is injected rather than imported. That keeps this module
 * free of database and Redis imports, so the validation rules — the security
 * boundary — can be tested as pure functions with no infrastructure running.
 */
export async function validateEdl(
  raw: unknown,
  checkOwnership: (keys: string[]) => Promise<void>,
): Promise<EditDecisionList> {
  const parsed = edlSchema.parse(raw) as EditDecisionList;
  assertCoherent(parsed);
  await checkOwnership(collectSourceKeys(parsed));
  return parsed;
}
