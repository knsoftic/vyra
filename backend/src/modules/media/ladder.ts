/**
 * The adaptive bitrate ladder.
 *
 * Five renditions — 240p through 1080p — so a player can drop to something
 * watchable on a weak connection instead of stalling.
 *
 * Two rules shape everything here:
 *
 * **Never upscale.** A 480p source transcoded to 1080p is a bigger file that
 * looks no better. The ladder is truncated at the source height, so a phone
 * that recorded at 720p produces four renditions, not five.
 *
 * **Keep the keyframe interval identical across renditions.** Adaptive switching
 * only works if every rendition can be cut at the same timestamps; mismatched
 * keyframes make a player either stall at the switch or refuse to switch at all.
 * That is why `-g`, `-keyint_min` and `-sc_threshold 0` are forced rather than
 * left to FFmpeg's judgement.
 */

/** Seconds per HLS segment. Two is the usual trade-off between start-up latency
 *  and request overhead; shorter segments start faster but multiply requests. */
export const SEGMENT_SECONDS = 2;

export interface Rung {
  label: string;
  height: number;
  /** Video bitrate in kbps. */
  videoKbps: number;
  audioKbps: number;
  /** Ceiling and buffer for rate control, derived from the video bitrate. */
  maxrateKbps: number;
  bufsizeKbps: number;
}

/**
 * Bitrates are tuned for vertical short video at 30fps. They are deliberately
 * conservative: this content is watched on mobile data, and a smaller file that
 * starts instantly beats a sharper one that buffers.
 */
export const LADDER: readonly Rung[] = [
  { label: '240p', height: 240, videoKbps: 300, audioKbps: 64, maxrateKbps: 360, bufsizeKbps: 600 },
  { label: '360p', height: 360, videoKbps: 600, audioKbps: 96, maxrateKbps: 720, bufsizeKbps: 1200 },
  { label: '480p', height: 480, videoKbps: 1000, audioKbps: 128, maxrateKbps: 1200, bufsizeKbps: 2000 },
  { label: '720p', height: 720, videoKbps: 2200, audioKbps: 128, maxrateKbps: 2640, bufsizeKbps: 4400 },
  { label: '1080p', height: 1080, videoKbps: 4200, audioKbps: 192, maxrateKbps: 5040, bufsizeKbps: 8400 },
];

/**
 * The rungs worth producing for a given source.
 *
 * Always returns at least one rung: a source smaller than 240p still needs
 * something playable, so the lowest rung is kept and the scale filter leaves it
 * at its own size.
 */
export function ladderFor(sourceHeight: number): Rung[] {
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) return [...LADDER];
  const usable = LADDER.filter((rung) => rung.height <= sourceHeight);
  return usable.length > 0 ? usable : [LADDER[0]!];
}

/** Even dimensions, because H.264 4:2:0 cannot encode odd ones. */
export function scaledWidth(sourceWidth: number, sourceHeight: number, targetHeight: number): number {
  if (sourceHeight <= 0) return 0;
  const width = Math.round((sourceWidth * targetHeight) / sourceHeight);
  return width % 2 === 0 ? width : width + 1;
}

export interface RenditionPlan {
  rung: Rung;
  outputPath: string;
  args: string[];
}

/**
 * FFmpeg arguments for one rendition.
 *
 * `-g` is set to segment length × fps so every segment starts on a keyframe, and
 * `-sc_threshold 0` stops scene detection inserting extra keyframes that would
 * misalign the renditions.
 */
export function renditionArgs(
  inputPath: string,
  rung: Rung,
  outputPath: string,
  fps = 30,
): string[] {
  const gop = Math.max(1, Math.round(SEGMENT_SECONDS * fps));
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    // -2 keeps the aspect ratio and rounds to an even width.
    '-vf', `scale=-2:${rung.height}`,
    '-c:v', 'libx264',
    '-profile:v', rung.height >= 720 ? 'high' : 'main',
    '-preset', 'veryfast',
    '-b:v', `${rung.videoKbps}k`,
    '-maxrate', `${rung.maxrateKbps}k`,
    '-bufsize', `${rung.bufsizeKbps}k`,
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', `${rung.audioKbps}k`,
    '-ar', '44100',
    '-ac', '2',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ];
}

/** One plan per rung the source can support. */
export function buildLadderPlan(
  inputPath: string,
  sourceWidth: number,
  sourceHeight: number,
  outputPathFor: (label: string) => string,
  fps = 30,
): RenditionPlan[] {
  return ladderFor(sourceHeight).map((rung) => {
    const outputPath = outputPathFor(rung.label);
    return { rung, outputPath, args: renditionArgs(inputPath, rung, outputPath, fps) };
  });
}

/** Total bandwidth a player should budget for a rung, video plus audio. */
export const rungBandwidth = (rung: Rung): number =>
  (rung.videoKbps + rung.audioKbps) * 1000;
