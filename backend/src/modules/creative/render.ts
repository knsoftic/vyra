/**
 * EDL → FFmpeg command.
 *
 * Builds the complete argument list for a render. Nothing here executes anything
 * — it is a pure function from an edit list to arguments, which means the whole
 * translation can be tested without FFmpeg installed, and the generated graph can
 * be stored alongside a job for debugging a bad render.
 *
 * Arguments are passed as an array and spawned without a shell, so there is no
 * shell to inject into. The escaping below is for FFmpeg's *own* filter-graph
 * parser, which is a separate concern: inside a filter argument, `:` separates
 * options, `,` separates filters and `'` quotes values, so user text containing
 * any of those would otherwise change the meaning of the graph.
 */

import type {
  ColorGrade,
  EditClip,
  EditDecisionList,
  TextOverlay,
} from '../../../../shared/contracts/creative.ts';
import {
  FILTER_PRESETS,
  mergeGrades,
  scaleGrade,
} from '../../../../shared/contracts/filter-presets.ts';
import { NEUTRAL_GRADE } from '../../../../shared/contracts/creative.ts';
import { gradeToFilters, normaliseGrade } from './grade.ts';
import { localFilePath } from '../../core/storage.ts';

const presetBySlug = new Map(FILTER_PRESETS.map((p) => [p.slug, p]));

/**
 * Escapes a value for use inside an FFmpeg filter argument.
 *
 * FFmpeg unescapes twice — once for the filter-graph parser and once for the
 * argument itself — so backslashes have to be doubled before the characters that
 * matter are escaped.
 */
export function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "\\\\'")
    .replace(/:/g, '\\\\:')
    .replace(/,/g, '\\\\,')
    .replace(/\[/g, '\\\\[')
    .replace(/\]/g, '\\\\]')
    .replace(/;/g, '\\\\;')
    .replace(/%/g, '\\\\%')
    // Newlines are a legitimate part of a caption but must be encoded, not raw.
    .replace(/\r?\n/g, '\\\\n');
}

/** Resolves the effective grade for a filter slug at a given intensity. */
export function resolveGrade(
  slug: string | undefined,
  intensity: number | undefined,
  overrides: Partial<ColorGrade> | undefined,
): ColorGrade {
  let base: ColorGrade = NEUTRAL_GRADE;
  if (slug) {
    const preset = presetBySlug.get(slug);
    if (preset) {
      base = scaleGrade(preset.grade, intensity ?? preset.defaultIntensity);
    }
  }
  return overrides ? mergeGrades(base, overrides) : base;
}

const ASPECT_SIZE: Record<string, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export interface RenderPlan {
  args: string[];
  filterGraph: string;
  outputPath: string;
  /** Expected duration, used to turn FFmpeg progress into a percentage. */
  durationMs: number;
}

/** Per-clip video chain: trim, speed, rotation, crop, scale, grade. */
function clipVideoChain(
  clip: EditClip,
  index: number,
  size: { width: number; height: number },
  timelineGrade: ColorGrade,
): string {
  const steps: string[] = [];

  steps.push(`[${index}:v]trim=start=${clip.trimStartMs / 1000}:end=${clip.trimEndMs / 1000}`);
  steps.push('setpts=PTS-STARTPTS');

  if (clip.speed !== 1) {
    // setpts multiplies presentation timestamps: 2x speed means half the PTS.
    steps.push(`setpts=${(1 / clip.speed).toFixed(6)}*PTS`);
  }

  if (clip.crop) {
    const { x, y, width, height } = clip.crop;
    steps.push(
      `crop=w=iw*${width.toFixed(4)}:h=ih*${height.toFixed(4)}:x=iw*${x.toFixed(4)}:y=ih*${y.toFixed(4)}`,
    );
  }

  if (clip.rotation === 90) steps.push('transpose=1');
  else if (clip.rotation === 180) steps.push('transpose=1,transpose=1');
  else if (clip.rotation === 270) steps.push('transpose=2');

  // Fit inside the output frame and pad, so mixed-orientation clips concatenate
  // without FFmpeg refusing on a size mismatch.
  steps.push(
    `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
    `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
  );

  // Per-clip grade sits on top of the timeline grade.
  const clipGrade = resolveGrade(clip.filterSlug, clip.filterIntensity, clip.grade);
  const combined = mergeGrades(timelineGrade, clipGrade);
  steps.push(...gradeToFilters(combined));

  return `${steps.join(',')}[v${index}]`;
}

function clipAudioChain(clip: EditClip, index: number): string {
  const steps: string[] = [];
  steps.push(`[${index}:a]atrim=start=${clip.trimStartMs / 1000}:end=${clip.trimEndMs / 1000}`);
  steps.push('asetpts=PTS-STARTPTS');

  if (clip.speed !== 1) {
    // atempo is limited to 0.5–2.0 per instance, so larger changes are chained.
    let remaining = clip.speed;
    const stages: number[] = [];
    while (remaining > 2) {
      stages.push(2);
      remaining /= 2;
    }
    while (remaining < 0.5) {
      stages.push(0.5);
      remaining /= 0.5;
    }
    stages.push(remaining);
    steps.push(...stages.map((s) => `atempo=${s.toFixed(6)}`));
  }

  const volume = clip.muted ? 0 : clip.volume / 100;
  steps.push(`volume=${volume.toFixed(4)}`);

  return `${steps.join(',')}[a${index}]`;
}

/** drawtext for one overlay, enabled only within its time window. */
function textFilter(text: TextOverlay, size: { width: number; height: number }): string {
  const opts: string[] = [];
  opts.push(`text='${escapeFilterValue(text.text)}'`);
  opts.push(`fontsize=${Math.round(text.sizePx)}`);
  opts.push(`fontcolor=${text.color.replace('#', '0x')}`);

  if (text.backgroundColor) {
    opts.push('box=1', `boxcolor=${text.backgroundColor.replace('#', '0x')}`, 'boxborderw=12');
  }

  // Positions are normalised, so they survive a change of output resolution.
  const x = Math.round(text.x * size.width);
  const y = Math.round(text.y * size.height);
  const anchorX = text.align === 'center' ? `${x}-text_w/2` : text.align === 'right' ? `${x}-text_w` : `${x}`;
  opts.push(`x=${anchorX}`, `y=${y}-text_h/2`);

  opts.push(`enable='between(t,${text.startMs / 1000},${text.endMs / 1000})'`);

  return `drawtext=${opts.join(':')}`;
}

/**
 * Builds the full FFmpeg invocation.
 *
 * `resolveInput` exists so tests can supply predictable paths instead of real
 * files on disk.
 */
export function buildRenderPlan(
  edl: EditDecisionList,
  outputPath: string,
  resolveInput: (key: string) => string = localFilePath,
): RenderPlan {
  const size = ASPECT_SIZE[edl.aspect] ?? ASPECT_SIZE['9:16']!;
  const timelineGrade = resolveGrade(edl.filterSlug, edl.filterIntensity, edl.grade);

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1'];
  for (const clip of edl.clips) {
    args.push('-i', resolveInput(clip.sourceKey));
  }

  const chains: string[] = [];
  edl.clips.forEach((clip, i) => {
    chains.push(clipVideoChain(clip, i, size, timelineGrade));
    chains.push(clipAudioChain(clip, i));
  });

  // Concatenate the clips into one stream.
  const concatInputs = edl.clips.map((_, i) => `[v${i}][a${i}]`).join('');
  chains.push(`${concatInputs}concat=n=${edl.clips.length}:v=1:a=1[vcat][acat]`);

  // Overlays apply to the whole timeline, after concatenation.
  const overlaySteps: string[] = [];
  if (edl.beauty && edl.beauty.skinSmoothing > 0) {
    // A mild smoothing pass. Render-only — never a recommendation signal.
    const amount = (edl.beauty.skinSmoothing / 100) * 3;
    overlaySteps.push(`gblur=sigma=${amount.toFixed(3)}:steps=1`);
  }
  for (const text of edl.texts) {
    overlaySteps.push(textFilter(text, size));
  }

  const videoLabel = overlaySteps.length > 0 ? '[vout]' : '[vcat]';
  if (overlaySteps.length > 0) {
    chains.push(`[vcat]${overlaySteps.join(',')}[vout]`);
  }

  // Extra audio tracks (music, voiceover) mix over the clip audio.
  const extraAudio = edl.audio.filter((t) => t.kind !== 'original' && t.sourceKey);
  let audioLabel = '[acat]';
  if (extraAudio.length > 0) {
    const base = edl.clips.length;
    extraAudio.forEach((track, i) => {
      args.push('-i', resolveInput(track.sourceKey!));
      const idx = base + i;
      const steps = [
        `[${idx}:a]atrim=start=${track.trimStartMs / 1000}:end=${track.trimEndMs / 1000}`,
        'asetpts=PTS-STARTPTS',
        `adelay=${track.startMs}|${track.startMs}`,
        `volume=${(track.volume / 100).toFixed(4)}`,
      ];
      if (track.fadeInMs) {
        steps.push(`afade=t=in:st=${track.startMs / 1000}:d=${track.fadeInMs / 1000}`);
      }
      if (track.fadeOutMs) {
        const outAt = (track.startMs + (track.trimEndMs - track.trimStartMs) - track.fadeOutMs) / 1000;
        steps.push(`afade=t=out:st=${Math.max(0, outAt)}:d=${track.fadeOutMs / 1000}`);
      }
      chains.push(`${steps.join(',')}[extra${i}]`);
    });

    const mixInputs = ['[acat]', ...extraAudio.map((_, i) => `[extra${i}]`)].join('');
    // dropout_transition=0 stops the mix from ducking when one input ends.
    chains.push(
      `${mixInputs}amix=inputs=${extraAudio.length + 1}:duration=first:dropout_transition=0[amix]`,
    );
    audioLabel = '[amix]';
  }

  const filterGraph = chains.join(';');

  args.push(
    '-filter_complex', filterGraph,
    '-map', videoLabel,
    '-map', audioLabel,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    // yuv420p and +faststart are what make the file play in browsers and start
    // before it has fully downloaded.
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    outputPath,
  );

  const durationMs = edl.clips.reduce(
    (total, c) => total + Math.round((c.trimEndMs - c.trimStartMs) / (c.speed || 1)),
    0,
  );

  return { args, filterGraph, outputPath, durationMs };
}

/** Arguments for extracting a cover frame at a given timestamp. */
export function buildCoverArgs(inputPath: string, atMs: number, outputPath: string): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', (atMs / 1000).toFixed(3),
    '-i', inputPath,
    '-frames:v', '1',
    '-q:v', '3',
    outputPath,
  ];
}
