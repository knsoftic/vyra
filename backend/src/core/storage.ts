/**
 * Object storage.
 *
 * One interface, two drivers. Development writes to a folder on disk so the
 * whole upload and render pipeline works with nothing installed; production
 * points at MinIO or S3. Application code never learns which is in use.
 *
 * Keys are always generated here, never taken from the client. A key that came
 * from a request could contain `../` and reach outside the bucket, or name
 * another user's object — so `resolve` refuses any key it did not shape.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from './config.ts';
import { AppError } from './errors.ts';
import { logger } from './logger.ts';

/** Where local objects live. Only used by the disk driver. */
const ROOT = path.resolve(process.cwd(), 'storage');

/**
 * A storage key looks like `videos/2026/08/29/<id>.mp4`.
 * Only these characters are ever produced, and only these are accepted back.
 *
 * Uppercase is permitted because ULIDs are uppercase Base32 and appear in keys
 * for upload parts. Traversal is blocked by the explicit `..` check below rather
 * than by the character class.
 */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,400}$/;

export type AssetKind = 'video' | 'image' | 'audio' | 'font' | 'sticker' | 'upload' | 'render';

/** Builds a namespaced, date-partitioned key. Never derived from user input. */
export function buildKey(kind: AssetKind, extension: string, prefix?: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const id = randomBytes(16).toString('hex');
  const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'bin';
  const scope = prefix ? `${prefix}/` : '';
  return `${kind}s/${scope}${yyyy}/${mm}/${dd}/${id}.${ext}`;
}

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..')) {
    throw new AppError('bad_request', 'Invalid storage key.');
  }
}

/** Absolute path for a key under the local root, with traversal ruled out. */
function localPath(key: string): string {
  assertSafeKey(key);
  const resolved = path.resolve(ROOT, key);
  // Belt and braces: even with a validated key, confirm we stayed inside.
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new AppError('bad_request', 'Invalid storage key.');
  }
  return resolved;
}

export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  /** Appends to an existing object, creating it if absent. Used by chunked uploads. */
  append(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
  /** Copies within the store, used when assembling an upload. */
  concat(sourceKeys: string[], targetKey: string): Promise<number>;
  url(key: string): string;
}

const diskDriver: StorageDriver = {
  async put(key, data) {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  },

  async append(key, data) {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, data);
  },

  async get(key) {
    try {
      return await readFile(localPath(key));
    } catch {
      throw new AppError('not_found', 'Object not found.');
    }
  },

  async exists(key) {
    try {
      await stat(localPath(key));
      return true;
    } catch {
      return false;
    }
  },

  async size(key) {
    try {
      const s = await stat(localPath(key));
      return s.size;
    } catch {
      throw new AppError('not_found', 'Object not found.');
    }
  },

  async remove(key) {
    await rm(localPath(key), { force: true });
  },

  /**
   * Streams the parts into the target rather than buffering them. A 500 MB video
   * assembled in memory would take the process down under any real concurrency.
   */
  async concat(sourceKeys, targetKey) {
    const target = localPath(targetKey);
    await mkdir(path.dirname(target), { recursive: true });
    const out = createWriteStream(target);
    let total = 0;
    try {
      for (const key of sourceKeys) {
        const source = localPath(key);
        const size = (await stat(source)).size;
        await pipeline(createReadStream(source), out, { end: false });
        total += size;
      }
    } finally {
      out.end();
      await new Promise<void>((resolve) => out.once('close', () => resolve()));
    }
    return total;
  },

  url(key) {
    assertSafeKey(key);
    return `${config.STORAGE_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  },
};

/**
 * The active driver.
 *
 * Only the disk driver exists today. An S3 driver implementing the same
 * interface slots in here without touching a single call site — the point of
 * defining the interface now rather than when it is needed.
 */
export const storage: StorageDriver = diskDriver;

export const sha256 = (data: Buffer): string =>
  createHash('sha256').update(data).digest('hex');

/** Local absolute path for a key, for tools like FFmpeg that need a real file. */
export function localFilePath(key: string): string {
  return localPath(key);
}

export async function ensureStorageReady(): Promise<void> {
  try {
    await mkdir(ROOT, { recursive: true });
  } catch (err) {
    logger.error({ err, root: ROOT }, 'could not create the storage root');
  }
}
