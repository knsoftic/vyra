/**
 * Source validation and inspection.
 *
 * Two layers, and the order matters.
 *
 * **Magic bytes first.** The `Content-Type` a client sends is a claim, not a
 * fact, and so is a file extension. Both are trivially forged. The first bytes
 * of a file are what actually determine how a decoder will treat it, so an
 * upload claiming `video/mp4` while starting with `MZ` is rejected before
 * anything opens it.
 *
 * **ffprobe second**, for the things only a decoder knows: real duration, codec,
 * frame rate, whether there is audio at all. That requires FFmpeg, so it
 * degrades gracefully when unavailable — the pipeline records that probing was
 * skipped rather than inventing values.
 */

import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';

const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

export interface MagicSignature {
  container: string;
  mimeTypes: string[];
  /** Byte offset the signature starts at. */
  offset: number;
  bytes: number[];
}

/**
 * Signatures for the formats we accept.
 *
 * MP4, MOV and 3GP share the ISO base media format: bytes 4–7 are `ftyp`, and
 * the brand that follows says which flavour it is. Matching on `ftyp` alone is
 * the reliable test; the brand is informational.
 */
export const SIGNATURES: readonly MagicSignature[] = [
  {
    container: 'isobmff',
    mimeTypes: ['video/mp4', 'video/quicktime', 'video/3gpp'],
    offset: 4,
    bytes: [0x66, 0x74, 0x79, 0x70], // "ftyp"
  },
  {
    container: 'matroska',
    mimeTypes: ['video/x-matroska', 'video/webm'],
    offset: 0,
    bytes: [0x1a, 0x45, 0xdf, 0xa3], // EBML header
  },
  {
    container: 'jpeg',
    mimeTypes: ['image/jpeg'],
    offset: 0,
    bytes: [0xff, 0xd8, 0xff],
  },
  {
    container: 'png',
    mimeTypes: ['image/png'],
    offset: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    container: 'webp',
    mimeTypes: ['image/webp'],
    offset: 8,
    bytes: [0x57, 0x45, 0x42, 0x50], // "WEBP", after the RIFF header
  },
  {
    container: 'mp3',
    mimeTypes: ['audio/mpeg'],
    offset: 0,
    bytes: [0x49, 0x44, 0x33], // "ID3"
  },
  {
    container: 'wav',
    mimeTypes: ['audio/wav'],
    offset: 8,
    bytes: [0x57, 0x41, 0x56, 0x45], // "WAVE"
  },
];

/** Executables and scripts that must never be accepted whatever they claim. */
const DANGEROUS: readonly { label: string; bytes: number[] }[] = [
  { label: 'Windows executable', bytes: [0x4d, 0x5a] }, // MZ
  { label: 'ELF executable', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { label: 'Mach-O executable', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { label: 'shell script', bytes: [0x23, 0x21] }, // #!
  { label: 'Java class', bytes: [0xca, 0xfe, 0xba, 0xbe] },
];

function matchesAt(buffer: Buffer, offset: number, bytes: number[]): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

/** The container a header describes, or null if none is recognised. */
export function detectContainer(header: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (matchesAt(header, signature.offset, signature.bytes)) return signature.container;
  }
  return null;
}

/**
 * Checks a file header against the type the client declared.
 *
 * Throws when the bytes contradict the claim, or when they are something that
 * should never be stored regardless of the claim.
 */
export function assertHeaderMatches(header: Buffer, declaredMime: string): string {
  for (const danger of DANGEROUS) {
    if (matchesAt(header, 0, danger.bytes)) {
      throw new AppError(
        'validation_failed',
        `This file is a ${danger.label}, not media. It has not been stored.`,
      );
    }
  }

  const container = detectContainer(header);
  if (!container) {
    throw new AppError(
      'validation_failed',
      'This file is not a recognised media format.',
      { details: { file: ['The file contents do not match any supported format.'] } },
    );
  }

  const signature = SIGNATURES.find((s) => s.container === container);
  if (signature && !signature.mimeTypes.includes(declaredMime)) {
    throw new AppError(
      'validation_failed',
      `This file is ${container}, which does not match the declared type ${declaredMime}.`,
    );
  }

  return container;
}

/** Reads enough of a file to identify it. */
export async function readHeader(filePath: string, bytes = 32): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// ── ffprobe ──

export interface ProbeResult {
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  durationSec: number | null;
  bitrateKbps: number | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
  hasAudio: boolean;
  rotation: number;
  sizeBytes: number | null;
  /** False when ffprobe was unavailable; every field above is then a guess. */
  probed: boolean;
}

export const EMPTY_PROBE: ProbeResult = {
  container: null, videoCodec: null, audioCodec: null,
  width: null, height: null, fps: null, durationSec: null,
  bitrateKbps: null, audioChannels: null, audioSampleRate: null,
  hasAudio: false, rotation: 0, sizeBytes: null, probed: false,
};

/** "30000/1001" → 29.97. Frame rates are reported as rationals. */
export function parseFrameRate(raw: string | undefined): number | null {
  if (!raw) return null;
  const [num, den] = raw.split('/').map(Number);
  if (!num || !den) return null;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

interface FfprobeOutput {
  format?: { format_name?: string; duration?: string; bit_rate?: string; size?: string };
  streams?: FfprobeStream[];
}

/** Turns ffprobe's JSON into the shape the pipeline uses. */
export function parseProbeOutput(json: string): ProbeResult {
  const data = JSON.parse(json) as FfprobeOutput;
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  // Rotation lives in side data on modern files and in a tag on older ones.
  const sideRotation = video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation;
  const tagRotation = video?.tags?.rotate ? Number(video.tags.rotate) : undefined;
  const rotation = ((sideRotation ?? tagRotation ?? 0) % 360 + 360) % 360;

  const bitrate = data.format?.bit_rate ? Math.round(Number(data.format.bit_rate) / 1000) : null;

  return {
    container: data.format?.format_name ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseFrameRate(video?.r_frame_rate),
    durationSec: data.format?.duration ? Number(data.format.duration) : null,
    bitrateKbps: Number.isFinite(bitrate) ? bitrate : null,
    audioChannels: audio?.channels ?? null,
    audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    hasAudio: audio !== undefined,
    rotation,
    sizeBytes: data.format?.size ? Number(data.format.size) : null,
    probed: true,
  };
}

let ffprobeAvailable: boolean | null = null;

export async function checkFfprobe(): Promise<boolean> {
  if (ffprobeAvailable !== null) return ffprobeAvailable;
  ffprobeAvailable = await new Promise<boolean>((resolve) => {
    const proc = spawn(FFPROBE, ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
  return ffprobeAvailable;
}

/**
 * Inspects a file.
 *
 * Returns `probed: false` rather than throwing when ffprobe is missing, so the
 * pipeline can record honestly that it does not know the source's properties
 * instead of proceeding on invented ones.
 */
export async function probe(filePath: string): Promise<ProbeResult> {
  if (!(await checkFfprobe())) {
    logger.warn({ ffprobe: FFPROBE }, 'ffprobe unavailable — source will not be inspected');
    return { ...EMPTY_PROBE };
  }

  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  const json = await new Promise<string>((resolve, reject) => {
    const proc = spawn(FFPROBE, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (b: Buffer) => {
      out += b.toString();
    });
    proc.stderr.on('data', (b: Buffer) => {
      err = (err + b.toString()).slice(-2000);
    });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `ffprobe exited ${code}`)),
    );
  });

  try {
    return parseProbeOutput(json);
  } catch (err) {
    logger.error({ err }, 'could not parse ffprobe output');
    return { ...EMPTY_PROBE };
  }
}
