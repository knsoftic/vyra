/**
 * Resumable chunked upload.
 *
 * A phone on mobile data loses its connection mid-upload constantly. So an
 * upload is a session, not a request: the client asks for one, sends chunks in
 * any order, and after an interruption asks which chunks are missing and sends
 * only those. Re-sending a chunk that already arrived is a no-op, which means a
 * client can retry blindly without tracking what succeeded.
 *
 * Limits come from `system_settings`, so an admin can change the maximum size or
 * duration without a deploy (ADR-015).
 */

import { ulid } from 'ulid';
import { execute, query, queryOne, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { logger } from '../../core/logger.ts';
import { config } from '../../core/config.ts';
import { getSetting } from '../../core/settings.ts';
import { buildKey, sha256, storage } from '../../core/storage.ts';
import type {
  UploadLimits,
  UploadSession,
  UploadStatus,
} from '../../../../shared/contracts/creative.ts';

/** Configurable; see UPLOAD_CHUNK_SIZE in config.ts for the reasoning. */
export const CHUNK_SIZE = config.UPLOAD_CHUNK_SIZE;
/** An unfinished session is swept after this long. */
const SESSION_TTL_HOURS = 24;

const ALLOWED = {
  video: ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/3gpp'],
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/webm'],
} as const;

const EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
};

interface SessionRow {
  id: number;
  public_id: string;
  user_id: number;
  kind: 'video' | 'image' | 'audio';
  filename: string;
  content_type: string;
  size_bytes: number;
  duration_ms: number | null;
  chunk_size: number;
  total_chunks: number;
  storage_key: string;
  checksum: string | null;
  status: UploadStatus;
  expires_at: Date;
}

export async function getLimits(): Promise<UploadLimits> {
  const [maxMb, maxDuration] = await Promise.all([
    getSetting('upload.max_size_mb'),
    getSetting('upload.max_duration_sec'),
  ]);
  return {
    maxSizeBytes: Number(maxMb) * 1024 * 1024,
    maxDurationSec: Number(maxDuration),
    chunkSize: CHUNK_SIZE,
    allowedVideoTypes: [...ALLOWED.video],
    allowedImageTypes: [...ALLOWED.image],
    allowedAudioTypes: [...ALLOWED.audio],
  };
}

/** The key holding one chunk before the parts are assembled. */
const chunkKey = (publicId: string, index: number): string =>
  `upload/parts/${publicId}/${String(index).padStart(6, '0')}.part`;

export interface CreateSessionInput {
  userId: number;
  filename: string;
  sizeBytes: number;
  contentType: string;
  durationMs?: number;
  kind?: 'video' | 'image' | 'audio';
}

export async function createSession(input: CreateSessionInput): Promise<UploadSession> {
  const kind = input.kind ?? 'video';
  const limits = await getLimits();

  const allowed: readonly string[] =
    kind === 'video' ? ALLOWED.video : kind === 'image' ? ALLOWED.image : ALLOWED.audio;
  if (!allowed.includes(input.contentType)) {
    throw new AppError(
      'validation_failed',
      `${input.contentType} is not an accepted ${kind} format.`,
      { details: { contentType: [`Accepted: ${allowed.join(', ')}.`] } },
    );
  }

  if (input.sizeBytes <= 0 || input.sizeBytes > limits.maxSizeBytes) {
    throw new AppError(
      'validation_failed',
      `Files must be between 1 byte and ${limits.maxSizeBytes / (1024 * 1024)} MB.`,
      { details: { sizeBytes: ['File is too large.'] } },
    );
  }

  if (
    kind === 'video' &&
    input.durationMs !== undefined &&
    input.durationMs > limits.maxDurationSec * 1000
  ) {
    throw new AppError(
      'validation_failed',
      `Videos may be at most ${limits.maxDurationSec} seconds.`,
      { details: { durationMs: ['Video is too long.'] } },
    );
  }

  const publicId = ulid();
  const totalChunks = Math.max(1, Math.ceil(input.sizeBytes / CHUNK_SIZE));
  const storageKey = buildKey(kind, EXTENSION[input.contentType] ?? 'bin');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000);

  await execute(
    `INSERT INTO upload_sessions
       (public_id, user_id, kind, filename, content_type, size_bytes, duration_ms,
        chunk_size, total_chunks, storage_key, expires_at)
     VALUES (:publicId, :userId, :kind, :filename, :contentType, :sizeBytes, :durationMs,
             :chunkSize, :totalChunks, :storageKey, :expiresAt)`,
    {
      publicId,
      userId: input.userId,
      kind,
      // The client's filename is stored for display only; it never becomes a key.
      filename: input.filename.slice(0, 255),
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs ?? null,
      chunkSize: CHUNK_SIZE,
      totalChunks,
      storageKey,
      expiresAt,
    },
  );

  return {
    id: publicId,
    storageKey,
    chunkSize: CHUNK_SIZE,
    totalChunks,
    receivedChunks: [],
    status: 'pending',
    expiresAt: expiresAt.toISOString(),
  };
}

async function loadSession(publicId: string, userId: number): Promise<SessionRow> {
  const row = await queryOne<SessionRow>(
    'SELECT * FROM upload_sessions WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Upload session not found.');
  // Ownership is checked here so no route can forget to.
  if (row.user_id !== userId) throw new AppError('not_found', 'Upload session not found.');
  return row;
}

async function receivedIndexes(sessionId: number): Promise<number[]> {
  const rows = await query<{ chunk_index: number }>(
    'SELECT chunk_index FROM upload_chunks WHERE session_id = :id ORDER BY chunk_index',
    { id: sessionId },
  );
  return rows.map((r) => Number(r.chunk_index));
}

export async function getSession(publicId: string, userId: number): Promise<UploadSession> {
  const row = await loadSession(publicId, userId);
  return {
    id: row.public_id,
    storageKey: row.storage_key,
    chunkSize: Number(row.chunk_size),
    totalChunks: Number(row.total_chunks),
    receivedChunks: await receivedIndexes(row.id),
    status: row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

/**
 * Stores one chunk.
 *
 * Idempotent: a chunk that already arrived is accepted and discarded, so a
 * client retrying after a timeout it never saw resolved cannot corrupt the file.
 */
export async function putChunk(
  publicId: string,
  userId: number,
  index: number,
  data: Buffer,
): Promise<{ received: number; total: number; duplicate: boolean }> {
  const row = await loadSession(publicId, userId);

  if (row.status === 'complete') {
    throw new AppError('conflict', 'This upload is already complete.');
  }
  if (row.status === 'aborted' || row.status === 'expired') {
    throw new AppError('conflict', 'This upload session is no longer active.');
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await execute("UPDATE upload_sessions SET status = 'expired' WHERE id = :id", { id: row.id });
    throw new AppError('conflict', 'This upload session has expired. Start a new one.');
  }
  if (!Number.isInteger(index) || index < 0 || index >= row.total_chunks) {
    throw new AppError('bad_request', `Chunk index must be between 0 and ${row.total_chunks - 1}.`);
  }
  if (data.length === 0) {
    throw new AppError('bad_request', 'Chunk is empty.');
  }

  // Every chunk but the last must be exactly chunk_size, otherwise the assembled
  // file would have gaps or overlaps that only surface as a corrupt video.
  const isLast = index === row.total_chunks - 1;
  const expected = isLast ? row.size_bytes - index * row.chunk_size : row.chunk_size;
  if (data.length !== expected) {
    throw new AppError(
      'bad_request',
      `Chunk ${index} should be ${expected} bytes but was ${data.length}.`,
    );
  }

  const existing = await queryOne<{ chunk_index: number }>(
    'SELECT chunk_index FROM upload_chunks WHERE session_id = :id AND chunk_index = :index',
    { id: row.id, index },
  );
  if (existing) {
    const received = await receivedIndexes(row.id);
    return { received: received.length, total: row.total_chunks, duplicate: true };
  }

  await storage.put(chunkKey(row.public_id, index), data);
  await execute(
    `INSERT INTO upload_chunks (session_id, chunk_index, size_bytes, checksum)
     VALUES (:sessionId, :index, :size, :checksum)
     ON DUPLICATE KEY UPDATE size_bytes = VALUES(size_bytes)`,
    { sessionId: row.id, index, size: data.length, checksum: sha256(data) },
  );
  await execute(
    "UPDATE upload_sessions SET status = 'uploading' WHERE id = :id AND status = 'pending'",
    { id: row.id },
  );

  const received = await receivedIndexes(row.id);
  return { received: received.length, total: row.total_chunks, duplicate: false };
}

/**
 * Assembles the chunks into the final object.
 *
 * Refuses unless every chunk is present — a partial assembly would produce a
 * file that looks valid and plays wrong.
 */
export async function completeUpload(
  publicId: string,
  userId: number,
  expectedChecksum?: string,
): Promise<{ storageKey: string; sizeBytes: number }> {
  const row = await loadSession(publicId, userId);

  if (row.status === 'complete') {
    return { storageKey: row.storage_key, sizeBytes: Number(row.size_bytes) };
  }

  const received = await receivedIndexes(row.id);
  if (received.length !== row.total_chunks) {
    const missing = [];
    for (let i = 0; i < row.total_chunks; i += 1) {
      if (!received.includes(i)) missing.push(i);
    }
    throw new AppError(
      'conflict',
      `Upload is incomplete: ${missing.length} chunk(s) still missing.`,
      { details: { missingChunks: [missing.slice(0, 50).join(', ')] } },
    );
  }

  const parts = received.map((i) => chunkKey(row.public_id, i));
  const total = await storage.concat(parts, row.storage_key);

  if (total !== Number(row.size_bytes)) {
    throw new AppError(
      'conflict',
      `Assembled file is ${total} bytes but ${row.size_bytes} were declared.`,
    );
  }

  if (expectedChecksum) {
    const actual = sha256(await storage.get(row.storage_key));
    if (actual !== expectedChecksum.toLowerCase()) {
      await storage.remove(row.storage_key);
      throw new AppError('conflict', 'Uploaded file failed its checksum. Please upload again.');
    }
  }

  await execute(
    `UPDATE upload_sessions
        SET status = 'complete', completed_at = NOW(3), checksum = :checksum
      WHERE id = :id`,
    { id: row.id, checksum: expectedChecksum?.toLowerCase() ?? null },
  );

  // The parts are no longer needed. A failure here wastes disk but must not fail
  // an upload the user has already completed successfully.
  void Promise.all(parts.map((k) => storage.remove(k))).catch((err: unknown) =>
    logger.warn({ err, publicId }, 'failed to clean up upload parts'),
  );

  return { storageKey: row.storage_key, sizeBytes: total };
}

export async function abortUpload(publicId: string, userId: number): Promise<void> {
  const row = await loadSession(publicId, userId);
  if (row.status === 'complete') {
    throw new AppError('conflict', 'This upload is already complete.');
  }

  const received = await receivedIndexes(row.id);
  await transaction(async (tx) => {
    await execute('DELETE FROM upload_chunks WHERE session_id = :id', { id: row.id }, tx);
    await execute("UPDATE upload_sessions SET status = 'aborted' WHERE id = :id", { id: row.id }, tx);
  });

  void Promise.all(received.map((i) => storage.remove(chunkKey(row.public_id, i)))).catch(
    (err: unknown) => logger.warn({ err, publicId }, 'failed to clean up aborted upload'),
  );
}

/**
 * Confirms a storage key came from a completed upload owned by this user.
 *
 * The edit list names source keys, and it arrives from the client. Without this
 * check a crafted edit list could reference another user's upload and render
 * their footage into a published video.
 */
export async function assertOwnedKeys(userId: number, keys: string[]): Promise<void> {
  const unique = [...new Set(keys)].filter((k) => k.length > 0);
  if (unique.length === 0) return;

  const rows = await query<{ storage_key: string }>(
    `SELECT storage_key FROM upload_sessions
      WHERE user_id = :userId AND status = 'complete' AND deleted_at IS NULL
        AND storage_key IN (${unique.map((_, i) => `:k${i}`).join(', ')})`,
    { userId, ...Object.fromEntries(unique.map((k, i) => [`k${i}`, k])) },
  );

  const owned = new Set(rows.map((r) => r.storage_key));
  const foreign = unique.filter((k) => !owned.has(k));
  if (foreign.length > 0) {
    // Deliberately vague: naming the key would confirm it exists.
    throw new AppError('forbidden', 'This edit references media you did not upload.');
  }
}

/** Marks abandoned sessions expired. Run on a schedule. */
export async function expireStaleSessions(): Promise<number> {
  const result = await execute(
    `UPDATE upload_sessions SET status = 'expired'
      WHERE status IN ('pending','uploading') AND expires_at < NOW(3)`,
  );
  return result.affectedRows;
}
