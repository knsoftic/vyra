/**
 * HLS packaging.
 *
 * Two pieces: the FFmpeg arguments that cut a rendition into segments, and the
 * master playlist that tells a player which renditions exist.
 *
 * The master playlist is generated rather than produced by FFmpeg, because it
 * has to describe renditions that were encoded in separate passes. Getting the
 * `BANDWIDTH` and `RESOLUTION` attributes right is what lets a player choose
 * sensibly before it has downloaded anything — the difference between playback
 * starting in under a second and starting at the wrong quality and stalling.
 *
 * Both functions are pure, so the output is verified in tests without FFmpeg.
 */

import { LADDER, SEGMENT_SECONDS, rungBandwidth, scaledWidth, type Rung } from './ladder.ts';

/** FFmpeg arguments to segment one already-encoded rendition. */
export function segmentArgs(
  inputPath: string,
  outputDir: string,
  label: string,
): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    // The streams are already encoded to the right bitrate; copying avoids a
    // second generation of compression loss.
    '-c', 'copy',
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    // 0 keeps every segment in the playlist, which is what VOD requires.
    '-hls_list_size', '0',
    '-hls_playlist_type', 'vod',
    '-hls_segment_filename', `${outputDir}/${label}_%04d.ts`,
    `${outputDir}/${label}.m3u8`,
  ];
}

export interface VariantInfo {
  label: string;
  width: number;
  height: number;
  bandwidth: number;
  playlistPath: string;
}

/**
 * Builds the master playlist.
 *
 * Variants are ordered lowest-bandwidth first. A player that starts with the
 * first entry before it has measured the connection therefore starts with the
 * cheapest stream, which is the right default on mobile data.
 */
export function buildMasterPlaylist(variants: VariantInfo[]): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];

  const ordered = [...variants].sort((a, b) => a.bandwidth - b.bandwidth);
  for (const variant of ordered) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},` +
        `RESOLUTION=${variant.width}x${variant.height},CODECS="avc1.4d401f,mp4a.40.2"`,
    );
    lines.push(variant.playlistPath);
  }

  // A trailing newline: some players are unhappy without one.
  return `${lines.join('\n')}\n`;
}

/** Describes the variants for a source of a given size. */
export function variantsFor(
  rungs: readonly Rung[],
  sourceWidth: number,
  sourceHeight: number,
): VariantInfo[] {
  return rungs.map((rung) => ({
    label: rung.label,
    width: scaledWidth(sourceWidth, sourceHeight, rung.height),
    height: rung.height,
    bandwidth: rungBandwidth(rung),
    playlistPath: `${rung.label}.m3u8`,
  }));
}

/**
 * Thumbnail extraction.
 *
 * Produces evenly spaced frames across the video, used both as cover candidates
 * and as the scrubber strip in the editor. The first frame is skipped — videos
 * very often start on a black or blurred frame, which makes a poor cover.
 */
export function thumbnailArgs(
  inputPath: string,
  durationSec: number,
  count: number,
  outputPattern: string,
): string[] {
  const safeCount = Math.max(1, Math.min(count, 20));
  // Start a little in, and stop a little short, to avoid black frames at either end.
  const usable = Math.max(durationSec - 0.5, 0.1);
  const interval = usable / (safeCount + 1);

  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-vf', `fps=1/${interval.toFixed(4)},scale=-2:480`,
    '-frames:v', String(safeCount),
    '-q:v', '3',
    outputPattern,
  ];
}

/** A single poster frame at a chosen timestamp. */
export function posterArgs(inputPath: string, atSec: number, outputPath: string): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    // -ss before -i seeks by keyframe, which is far faster on a long file.
    '-ss', Math.max(0, atSec).toFixed(3),
    '-i', inputPath,
    '-frames:v', '1',
    '-vf', 'scale=-2:720',
    '-q:v', '2',
    outputPath,
  ];
}

/** Extracts the audio track, used for the waveform and for sound reuse. */
export function audioArgs(inputPath: string, outputPath: string): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-vn',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    outputPath,
  ];
}

/**
 * Peak amplitudes for a waveform display.
 *
 * `astats` reports per-window peak levels in dBFS; the caller converts those to
 * the 0..1 values the UI draws.
 */
export function waveformArgs(inputPath: string, buckets = 100, durationSec = 1): string[] {
  const window = Math.max(0.01, durationSec / Math.max(1, buckets));
  return [
    '-hide_banner', '-loglevel', 'info',
    '-i', inputPath,
    '-af', `astats=metadata=1:reset=${window.toFixed(4)}`,
    '-f', 'null', '-',
  ];
}

/** Converts a dBFS level to a 0..1 amplitude for drawing. */
export function dbToAmplitude(db: number): number {
  if (!Number.isFinite(db)) return 0;
  // -60 dB is treated as silence; anything quieter is not visible anyway.
  const clamped = Math.max(-60, Math.min(0, db));
  return Math.round((10 ** (clamped / 20)) * 1000) / 1000;
}

export { LADDER, SEGMENT_SECONDS };
