/**
 * Creative contract — filters, adjustments, effects, overlays and the edit list.
 *
 * The single most important idea in this file is `ColorGrade`.
 *
 * Editing is non-destructive: the device never renders the final video. It shows
 * a GPU preview, and the server renders the real thing with FFmpeg. Those are two
 * completely different renderers, and PHASE_04 requires them to produce visually
 * identical output.
 *
 * The only way that holds is if neither renderer owns the numbers. `ColorGrade`
 * is the shared source of truth: eleven values in plain user-facing units
 * (-100..100, or 0..100 for one-sided controls). The GPU shader converts those to
 * shader uniforms; the server converts the same values to an FFmpeg filter graph.
 * A filter preset is just a named `ColorGrade`, so adding one is a database row —
 * no app release, and no chance of the two renderers disagreeing about what
 * "Vintage" means.
 */

import type { Page } from './http.ts';

// ── The shared parameter set ──

/**
 * Every value is in user-facing units, not renderer units.
 * `0` always means "unchanged" so a zeroed grade is a no-op in both renderers.
 */
export interface ColorGrade {
  /** -100..100 */
  brightness: number;
  /** -100..100 */
  contrast: number;
  /** -100..100 */
  saturation: number;
  /** -100..100 — stops of exposure, scaled */
  exposure: number;
  /** -100..100 — recovers or crushes the top end */
  highlights: number;
  /** -100..100 — lifts or deepens the bottom end */
  shadows: number;
  /** -100..100 — negative is cooler (blue), positive is warmer (orange) */
  temperature: number;
  /** -100..100 — negative is greener, positive is more magenta */
  tint: number;
  /** 0..100 */
  sharpness: number;
  /** 0..100 — lifts blacks for a matte, filmic look */
  fade: number;
  /** 0..100 — darkens the corners */
  vignette: number;
}

export const NEUTRAL_GRADE: ColorGrade = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  sharpness: 0,
  fade: 0,
  vignette: 0,
};

export const GRADE_KEYS = Object.keys(NEUTRAL_GRADE) as (keyof ColorGrade)[];

/** Controls the manual adjustment panel renders, in display order. */
export interface AdjustmentControl {
  key: keyof ColorGrade;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
}

export const ADJUSTMENT_CONTROLS: readonly AdjustmentControl[] = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, defaultValue: 0 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, defaultValue: 0 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, defaultValue: 0 },
  { key: 'exposure', label: 'Exposure', min: -100, max: 100, defaultValue: 0 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, defaultValue: 0 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, defaultValue: 0 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, defaultValue: 0 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, defaultValue: 0 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 100, defaultValue: 0 },
  { key: 'fade', label: 'Fade', min: 0, max: 100, defaultValue: 0 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, defaultValue: 0 },
];

// ── Catalogue ──

export type CreativeAssetKind = 'filter' | 'effect' | 'sticker_pack' | 'font' | 'transition';

/** Flags an admin can set on any catalogue item without an app release. */
export interface CatalogueFlags {
  isEnabled: boolean;
  isTrending: boolean;
  isNew: boolean;
  isPremium: boolean;
  sortOrder: number;
}

export interface VideoFilter extends CatalogueFlags {
  id: string;
  slug: string;
  name: string;
  category: string;
  /** The grade at full strength. Scaled by the user's intensity slider. */
  grade: ColorGrade;
  /** Swatch shown in the carousel. Cosmetic only — the grade does the work. */
  previewColor: string;
  /** Default intensity, 0..100. */
  defaultIntensity: number;
}

export type EffectCategory = 'motion' | 'light' | 'color' | 'transition' | 'background' | 'time';

export interface VideoEffect extends CatalogueFlags {
  id: string;
  slug: string;
  name: string;
  category: EffectCategory;
  icon: string;
  /** Effect-specific parameters, interpreted by both renderers. */
  params: Record<string, number | string>;
}

export interface StickerPack extends CatalogueFlags {
  id: string;
  slug: string;
  name: string;
  stickers: { id: string; label: string; url?: string; emoji?: string }[];
}

export interface FontOption extends CatalogueFlags {
  id: string;
  slug: string;
  name: string;
  /** Storage key for the font file, or null for a system face. */
  fileKey?: string;
}

export interface CreativeCatalogue {
  filters: VideoFilter[];
  effects: VideoEffect[];
  stickerPacks: StickerPack[];
  fonts: FontOption[];
  adjustments: readonly AdjustmentControl[];
  /** Bumped whenever the catalogue changes, so the client can cache safely. */
  version: string;
}

// ── The edit decision list ──

export type ClipSpeed = 0.5 | 0.75 | 1 | 1.5 | 2;

/** One source clip and what to do with it. Times are in milliseconds. */
export interface EditClip {
  id: string;
  /** Storage key of the uploaded source. */
  sourceKey: string;
  /** Where the used portion starts and ends within the source. */
  trimStartMs: number;
  trimEndMs: number;
  speed: number;
  /** Degrees, multiples of 90. */
  rotation: 0 | 90 | 180 | 270;
  /** Normalised 0..1 crop rectangle, or absent for no crop. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Applied on top of the timeline-wide grade. */
  filterSlug?: string;
  filterIntensity?: number;
  grade?: Partial<ColorGrade>;
  /** Volume of this clip's original audio, 0..100. */
  volume: number;
  muted: boolean;
}

export interface TextOverlay {
  id: string;
  text: string;
  fontSlug: string;
  sizePx: number;
  color: string;
  backgroundColor?: string;
  align: 'left' | 'center' | 'right';
  /** Normalised 0..1 position of the overlay's centre. */
  x: number;
  y: number;
  rotation: number;
  /** When the overlay appears and disappears on the timeline. */
  startMs: number;
  endMs: number;
  animation?: 'none' | 'fade' | 'slide' | 'pop' | 'typewriter';
}

export interface StickerOverlay {
  id: string;
  stickerId: string;
  packSlug: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  startMs: number;
  endMs: number;
}

export interface EffectInstance {
  id: string;
  effectSlug: string;
  startMs: number;
  endMs: number;
  params?: Record<string, number | string>;
}

export type AudioTrackKind = 'original' | 'music' | 'voiceover';

export interface AudioTrack {
  id: string;
  kind: AudioTrackKind;
  /** Storage key for music or voiceover; absent for original clip audio. */
  sourceKey?: string;
  musicTrackId?: string;
  /** Where this audio starts on the timeline. */
  startMs: number;
  /** Portion of the source used. */
  trimStartMs: number;
  trimEndMs: number;
  /** 0..100, independent per track so original/music/voice can be balanced. */
  volume: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}

/**
 * The complete non-destructive description of an edit.
 *
 * The device stores this and previews it; the server renders from exactly this
 * and nothing else. Anything not expressible here cannot be rendered, which is
 * deliberate — it keeps the two renderers in step.
 */
export interface EditDecisionList {
  version: 1;
  clips: EditClip[];
  /** Applied across the whole timeline, before per-clip grades. */
  filterSlug?: string;
  filterIntensity?: number;
  grade?: Partial<ColorGrade>;
  effects: EffectInstance[];
  texts: TextOverlay[];
  stickers: StickerOverlay[];
  audio: AudioTrack[];
  /** Output aspect, e.g. "9:16". */
  aspect: string;
  /** Beauty settings are render-only and never feed recommendation (PHASE_04). */
  beauty?: {
    skinSmoothing: number;
    brightness: number;
    faceLight: number;
    backgroundBlur: number;
  };
}

export const EMPTY_EDL: EditDecisionList = {
  version: 1,
  clips: [],
  effects: [],
  texts: [],
  stickers: [],
  audio: [],
  aspect: '9:16',
};

// ── Upload ──

export type UploadStatus = 'pending' | 'uploading' | 'complete' | 'aborted' | 'expired';

export interface UploadSession {
  id: string;
  storageKey: string;
  chunkSize: number;
  totalChunks: number;
  /** Indexes already stored. A resuming client uploads only what is missing. */
  receivedChunks: number[];
  status: UploadStatus;
  expiresAt: string;
}

export interface CreateUploadBody {
  filename: string;
  sizeBytes: number;
  contentType: string;
  durationMs?: number;
  kind?: 'video' | 'image' | 'audio';
}

export interface CompleteUploadBody {
  /** Client-computed SHA-256 of the whole file, verified server-side. */
  checksum?: string;
}

export interface UploadLimits {
  maxSizeBytes: number;
  maxDurationSec: number;
  chunkSize: number;
  allowedVideoTypes: string[];
  allowedImageTypes: string[];
  allowedAudioTypes: string[];
}

// ── Drafts ──

export interface VideoDraft {
  id: string;
  caption: string;
  coverUrl?: string;
  durationSec: number;
  clipCount: number;
  editList: EditDecisionList;
  updatedAt: string;
  createdAt: string;
}

export interface SaveDraftBody {
  id?: string;
  caption?: string;
  coverKey?: string;
  editList: EditDecisionList;
}

// ── Render ──

export type RenderStatus = 'queued' | 'rendering' | 'complete' | 'failed' | 'cancelled';

export interface RenderJob {
  id: string;
  status: RenderStatus;
  progress: number;
  error?: string;
  outputKey?: string;
  createdAt: string;
  finishedAt?: string;
}

// ── Publish ──

export interface PublishBody {
  editList: EditDecisionList;
  caption: string;
  privacy: 'public' | 'followers' | 'friends' | 'private';
  categoryId?: string;
  coverKey?: string;
  coverTimeMs?: number;
  hashtags?: string[];
  mentions?: string[];
  locationName?: string;
  allowComments?: boolean;
  allowShare?: boolean;
  allowDownload?: boolean;
  allowRemix?: boolean;
  allowDuet?: boolean;
  /** Draft to consume; it is deleted only after the video row exists. */
  draftId?: string;
}

export interface PublishResult {
  videoId: string;
  renderJob: RenderJob;
}

// ── Music ──

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  category: string;
  coverUrl?: string;
  audioUrl: string;
  durationSec: number;
  isTrending: boolean;
  isFavourite?: boolean;
  usageCount: number;
}

export type MusicPage = Page<MusicTrack>;
export type DraftPage = Page<VideoDraft>;
