/**
 * Turning the compose draft into a published video.
 *
 * The server renders from the edit decision list and nothing else, so this is
 * where the on-device draft becomes something the renderer can act on. Anything
 * the EDL cannot express cannot be rendered — that constraint is deliberate,
 * and it is why the translation lives in one place instead of being spread
 * across the editor screens.
 */

import { api } from './client';
import type { ComposeState } from '../store/AppState';
import type { EditDecisionList, EditClip } from '../../../shared/contracts/creative';

export interface PublishResult {
  videoId: string;
  renderJob: { id: string; status: string; progress: number; createdAt: string };
}

export interface PublishOptions {
  caption: string;
  privacy: 'public' | 'followers' | 'friends' | 'private';
  allowComments?: boolean;
  allowShare?: boolean;
  allowDownload?: boolean;
  allowRemix?: boolean;
  allowDuet?: boolean;
  categoryId?: string;
  locationName?: string;
}

/** `#tag` and `@name` are typed into the caption; the server wants them listed. */
function extract(caption: string, prefix: '#' | '@'): string[] {
  const pattern = prefix === '#' ? /#([\p{L}\p{N}_]{1,63})/gu : /@([a-z0-9._]{1,29})/giu;
  const found = new Set<string>();
  for (const match of caption.matchAll(pattern)) {
    if (match[1]) found.add(match[1].toLowerCase());
  }
  return [...found].slice(0, 30);
}

/**
 * Builds the edit list from the compose draft.
 *
 * `clip.id` is the storage key returned by the upload — the server resolves
 * ownership from it and refuses a key the caller did not upload.
 */
/**
 * The manual adjustment sliders, as a colour grade.
 *
 * The slider ids were chosen to match `ColorGrade` exactly, so this is a
 * filtered pass-through rather than a translation. Only values the person
 * actually moved are sent: an all-zero grade is a no-op that would still make
 * the renderer build a filter chain for nothing.
 *
 * Without this the Adjust screen moved eleven sliders that reached no renderer
 * — the screen looked like it worked and changed nothing about the output.
 */
const GRADE_KEYS = [
  'brightness', 'contrast', 'saturation', 'exposure', 'highlights',
  'shadows', 'temperature', 'tint', 'sharpness', 'fade', 'vignette',
] as const;

function buildGrade(adjustments: Record<string, number>): Record<string, number> | undefined {
  const grade: Record<string, number> = {};
  for (const key of GRADE_KEYS) {
    const value = adjustments[key];
    if (typeof value === 'number' && value !== 0) grade[key] = value;
  }
  return Object.keys(grade).length > 0 ? grade : undefined;
}

export function buildEditList(compose: ComposeState): EditDecisionList {
  const clips: EditClip[] = compose.clips.map((clip, index) => {
    /*
     * Trim points travel with the clip. They used to be hardcoded to the whole
     * length here, so trimming in the editor changed the timeline the person
     * saw and nothing the renderer received.
     */
    const fullMs = Math.max(1, Math.round(clip.durationSec * 1000));
    const startMs = Math.max(0, Math.min(clip.trimStartMs ?? 0, fullMs - 1));
    const endMs = Math.max(startMs + 1, Math.min(clip.trimEndMs ?? fullMs, fullMs));

    return {
      id: `clip-${index}`,
      sourceKey: clip.id,
      trimStartMs: startMs,
      trimEndMs: endMs,
      speed: clip.speed || 1,
      rotation: clip.rotation ?? 0,
      volume: compose.volumes.original,
      muted: compose.volumes.original === 0,
    };
  });

  /** Where the finished timeline ends, for overlays that run to the end. */
  const timelineEndMs = clips.reduce(
    (total, clip) => total + Math.round((clip.trimEndMs - clip.trimStartMs) / (clip.speed || 1)),
    0,
  );

  const beauty = compose.beauty;
  const hasBeauty =
    beauty.smoothing > 0 || beauty.face_brightness > 0 || beauty.face_light > 0 || beauty.bg_blur > 0;

  return {
    version: 1,
    clips,
    // Only sent when a real filter is chosen — 'Original' means no grade.
    ...(compose.filterId && compose.filterColor !== 'transparent'
      ? { filterSlug: compose.filterId, filterIntensity: compose.filterIntensity }
      : {}),
    effects: compose.effectIds.map((slug, index) => ({
      id: `effect-${index}`,
      effectSlug: slug,
      startMs: 0,
      endMs: timelineEndMs,
    })),
    texts: compose.textOverlays.map((overlay, index) => ({
      id: overlay.id,
      text: overlay.text,
      fontSlug: overlay.font,
      sizePx: 24,
      color: overlay.color,
      align: 'center' as const,
      x: 0.5,
      y: 0.2 + index * 0.08,
      rotation: 0,
      startMs: 0,
      endMs: timelineEndMs,
    })),
    stickers: compose.stickers.map((sticker, index) => ({
      id: sticker.id,
      stickerId: sticker.id,
      packSlug: 'emoji',
      x: 0.5,
      y: 0.4 + index * 0.1,
      scale: 1,
      rotation: 0,
      startMs: 0,
      endMs: timelineEndMs,
    })),
    audio: [
      ...(compose.sound
        ? [
            {
              id: 'music',
              kind: 'music' as const,
              musicTrackId: compose.sound.id,
              startMs: 0,
              trimStartMs: 0,
              trimEndMs: timelineEndMs,
              volume: compose.volumes.music,
            },
          ]
        : []),
      // Recorded takes, each already uploaded. Laid where they were recorded.
      ...(compose.voiceTracks ?? []).map((take) => ({
        id: take.id,
        kind: 'voiceover' as const,
        sourceKey: take.sourceKey,
        startMs: take.startMs,
        trimStartMs: 0,
        trimEndMs: take.durationMs,
        volume: compose.volumes.voice,
      })),
    ],
    aspect: '9:16',
    ...(buildGrade(compose.adjustments) ? { grade: buildGrade(compose.adjustments) } : {}),
    // Render-only, and never a ranking or targeting signal (ADR-008).
    ...(hasBeauty
      ? {
          beauty: {
            skinSmoothing: beauty.smoothing,
            brightness: beauty.face_brightness,
            faceLight: beauty.face_light,
            backgroundBlur: beauty.bg_blur,
          },
        }
      : {}),
  } as EditDecisionList;
}

export function publishVideo(
  compose: ComposeState,
  options: PublishOptions,
): Promise<PublishResult> {
  const hashtags = extract(options.caption, '#');
  const mentions = extract(options.caption, '@');

  return api
    .post<PublishResult>('/videos', {
      editList: buildEditList(compose),
      caption: options.caption,
      privacy: options.privacy,
      // The chosen poster frame, in milliseconds into the finished video. Left
      // out entirely when nobody chose one, so the pipeline picks as before.
      ...(compose.coverFrameMs !== undefined ? { coverTimeMs: compose.coverFrameMs } : {}),
      ...(hashtags.length ? { hashtags } : {}),
      ...(mentions.length ? { mentions } : {}),
      ...(options.categoryId ? { categoryId: options.categoryId } : {}),
      ...(options.locationName ? { locationName: options.locationName } : {}),
      ...(options.allowComments !== undefined ? { allowComments: options.allowComments } : {}),
      ...(options.allowShare !== undefined ? { allowShare: options.allowShare } : {}),
      ...(options.allowDownload !== undefined ? { allowDownload: options.allowDownload } : {}),
      ...(options.allowRemix !== undefined ? { allowRemix: options.allowRemix } : {}),
      ...(options.allowDuet !== undefined ? { allowDuet: options.allowDuet } : {}),
    })
    .then((r) => r.data);
}

/** Saves the draft server-side so it survives reinstalling the app. */
export function saveDraft(compose: ComposeState, caption: string): Promise<{ id: string }> {
  return api
    .post<{ id: string }>('/drafts', { editList: buildEditList(compose), caption })
    .then((r) => r.data);
}
