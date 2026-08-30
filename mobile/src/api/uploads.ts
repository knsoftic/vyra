/**
 * Chunked video upload.
 *
 * A phone on a mobile network drops connections mid-upload, so a 200 MB video
 * sent as one request is a video that usually fails. The server therefore takes
 * it in chunks and remembers which ones arrived; this client sends them one at
 * a time and reports progress after each.
 *
 * Progress is measured from **chunks the server confirmed**, never from bytes
 * handed to `fetch`. The difference matters on a bad connection: bytes written
 * to a socket are not bytes received, and a progress bar that fills while
 * nothing arrives is the most annoying lie an app can tell.
 *
 * Resumable by design: `GET /uploads/:id` reports which chunks are already
 * held, so an interrupted upload continues instead of starting over.
 */

import { File } from 'expo-file-system';
import { API_BASE, getAccessToken, ApiError } from './client';

const API = `${API_BASE}/api/v1`;

export interface UploadSession {
  id: string;
  storageKey: string;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: number[];
  status: string;
  expiresAt: string;
}

export interface CompletedUpload {
  storageKey: string;
  url: string;
  sizeBytes: number;
}

export interface UploadProgress {
  /** 0–1, from chunks the server has acknowledged. */
  fraction: number;
  chunksSent: number;
  totalChunks: number;
  bytesSent: number;
  totalBytes: number;
}

/** What the picker gives us, narrowed to what an upload actually needs. */
export interface LocalFile {
  uri: string;
  name: string;
  mimeType: string;
  /**
   * Bytes. Optional because almost nothing that hands us a file reliably knows
   * it — see `measure` below, which is what actually establishes it.
   */
  sizeBytes?: number;
  durationMs?: number;
}

/**
 * How big the file actually is.
 *
 * Every caller used to supply this and none of them could. The camera hands
 * back a uri and no size, so the record screen passed `0`; the voiceover
 * recorder the same; and `expo-image-picker` leaves `fileSize` undefined for
 * videos on Android, so the gallery passed `0` too. The server requires a
 * positive size, so all three uploads failed — the camera and the gallery
 * alike, which is exactly what testing found.
 *
 * Reading it from disk removes the guesswork from the callers entirely. The
 * `File` API reports the size without reading the file, so a 500 MB video costs
 * nothing to measure; the blob fallback is for uris `File` cannot stat, such as
 * a `content://` handed over by another app.
 */
export async function measure(uri: string): Promise<number> {
  try {
    const size = new File(uri).size;
    if (typeof size === 'number' && size > 0) return size;
  } catch {
    // Not a path `File` can stat. The fallback below still might.
  }

  try {
    const blob = await fetch(uri).then((r) => r.blob());
    if (blob.size > 0) return blob.size;
  } catch {
    // Fall through to the error, which says something a person can act on.
  }

  throw new ApiError(
    'validation_failed',
    'This file could not be read from your device, so it cannot be uploaded.',
  );
}

async function json<T>(path: string, init: RequestInit): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

  const body = (await response.json().catch(() => null)) as
    | { ok: boolean; data?: T; error?: { code: string; message: string } }
    | null;

  if (!response.ok || !body?.ok || body.data === undefined) {
    throw new ApiError(
      body?.error?.code ?? 'upload_failed',
      body?.error?.message ?? `Upload failed (${response.status}).`,
      response.status,
    );
  }
  return body.data;
}

export async function createSession(file: LocalFile): Promise<UploadSession> {
  // Measured here rather than at the call sites, so the one thing every caller
  // got wrong cannot be got wrong again.
  const sizeBytes = file.sizeBytes && file.sizeBytes > 0 ? file.sizeBytes : await measure(file.uri);

  return json<UploadSession>('/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      sizeBytes,
      contentType: file.mimeType,
      kind: 'video',
      ...(file.durationMs ? { durationMs: Math.round(file.durationMs) } : {}),
    }),
  });
}

export function getSession(id: string): Promise<UploadSession> {
  return json<UploadSession>(`/uploads/${id}`, { method: 'GET' });
}

export function cancelSession(id: string): Promise<unknown> {
  return json(`/uploads/${id}`, { method: 'DELETE' });
}

/**
 * Reads one chunk of a local file.
 *
 * `fetch` on a `file://` URI gives a Blob, and `Blob.slice` is the only way to
 * read part of a large file without pulling the whole thing into memory — which
 * on a 500 MB video would simply crash the app.
 */
async function readChunk(uri: string, start: number, end: number): Promise<Blob> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return blob.slice(start, end);
}

export interface UploadHandle {
  /** Ask the upload to stop after the chunk in flight. */
  cancel: () => void;
}

/**
 * Sends a file, resuming anything already held, and reports progress.
 *
 * Returns the completed upload's storage key, which is what a draft or a
 * published video then refers to.
 */
export async function uploadFile(
  file: LocalFile,
  onProgress: (progress: UploadProgress) => void,
  handle?: UploadHandle & { session?: (s: UploadSession) => void },
): Promise<CompletedUpload> {
  /*
   * One measurement drives both the session and the chunking. Measuring in two
   * places would let the server's idea of the file's length and the loop's
   * disagree, and the upload would then never complete.
   */
  const sizeBytes = file.sizeBytes && file.sizeBytes > 0 ? file.sizeBytes : await measure(file.uri);
  const sized: LocalFile = { ...file, sizeBytes };

  const session = await createSession(sized);
  handle?.session?.(session);

  const already = new Set(session.receivedChunks);
  let cancelled = false;
  if (handle) {
    const original = handle.cancel;
    handle.cancel = () => {
      cancelled = true;
      original?.();
    };
  }

  const report = (chunksSent: number) =>
    onProgress({
      fraction: session.totalChunks === 0 ? 1 : chunksSent / session.totalChunks,
      chunksSent,
      totalChunks: session.totalChunks,
      bytesSent: Math.min(chunksSent * session.chunkSize, sizeBytes),
      totalBytes: sizeBytes,
    });

  report(already.size);

  for (let index = 0; index < session.totalChunks; index += 1) {
    if (cancelled) throw new ApiError('cancelled', 'Upload cancelled.', 0);
    if (already.has(index)) continue;

    const start = index * session.chunkSize;
    const end = Math.min(start + session.chunkSize, sizeBytes);
    const blob = await readChunk(file.uri, start, end);

    const token = getAccessToken();
    const response = await fetch(`${API}/uploads/${session.id}/chunks/${index}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: blob,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      throw new ApiError(
        'chunk_failed',
        body?.error?.message ?? `Chunk ${index + 1} of ${session.totalChunks} failed.`,
        response.status,
      );
    }

    already.add(index);
    // Reported only after the server confirms, so the bar tracks arrival.
    report(already.size);
  }

  return json<CompletedUpload>(`/uploads/${session.id}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}
