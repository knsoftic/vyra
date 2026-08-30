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
export function buildEditList(compose: ComposeState): EditDecisionList {
  const clips: EditClip[] = compose.clips.map((clip, index) => ({
    id: `clip-${index}`,
    sourceKey: clip.id,
    trimStartMs: 0,
    trimEndMs: Math.max(1, Math.round(clip.durationSec * 1000)),
    speed: clip.speed || 1,
    rotation: 0,
    volume: compose.volumes.original,
    muted: compose.volumes.original === 0,
  }));

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
      endMs: clips[0]?.trimEndMs ?? 0,
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
      endMs: clips[0]?.trimEndMs ?? 0,
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
      endMs: clips[0]?.trimEndMs ?? 0,
    })),
    audio: compose.sound
      ? [
          {
            id: 'music',
            kind: 'music' as const,
            musicTrackId: compose.sound.id,
            startMs: 0,
            trimStartMs: 0,
            trimEndMs: clips[0]?.trimEndMs ?? 0,
            volume: compose.volumes.music,
          },
        ]
      : [],
    aspect: '9:16',
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
