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
  sizeBytes: number;
  durationMs?: number;
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

export function createSession(file: LocalFile): Promise<UploadSession> {
  return json<UploadSession>('/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      sizeBytes: file.sizeBytes,
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
  const session = await createSession(file);
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
      bytesSent: Math.min(chunksSent * session.chunkSize, file.sizeBytes),
      totalBytes: file.sizeBytes,
    });

  report(already.size);

  for (let index = 0; index < session.totalChunks; index += 1) {
    if (cancelled) throw new ApiError('cancelled', 'Upload cancelled.', 0);
    if (already.has(index)) continue;

    const start = index * session.chunkSize;
    const end = Math.min(start + session.chunkSize, file.sizeBytes);
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
