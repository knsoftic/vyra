/**
 * Creation routes — uploads, catalogue, drafts, publishing and music.
 *
 * Chunk upload is the one endpoint that does not take JSON. It reads a raw
 * binary body, so `express.json()` must not touch it — hence the dedicated
 * `express.raw` on that route only.
 */

import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { query, queryOne, execute } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, optionalAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { pageQuerySchema } from '../auth/auth.schemas.ts';
import { edlSchema, validateEdl } from './edl.ts';
import { getCatalogue } from './catalogue.service.ts';
import * as uploads from '../upload/upload.service.ts';
import * as drafts from '../videos/drafts.service.ts';
import * as publishing from '../videos/publish.service.ts';
import { storage } from '../../core/storage.ts';
import type { MusicTrack } from '../../../../shared/contracts/creative.ts';

export const creativeRouter: Router = Router();

// ── Catalogue ──

creativeRouter.get(
  '/creative/catalogue',
  optionalAuth,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await getCatalogue()));
  }),
);

creativeRouter.get(
  '/creative/limits',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(ok(await uploads.getLimits()));
  }),
);

// ── Upload ──

const createUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  contentType: z.string().trim().min(3).max(100),
  durationMs: z.number().int().positive().optional(),
  kind: z.enum(['video', 'image', 'audio']).optional(),
});

creativeRouter.post(
  '/uploads',
  requireAuth,
  limits.upload,
  validate({ body: createUploadSchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof createUploadSchema }>(req).body;
    const session = await uploads.createSession({ userId: authed.userId, ...body });
    res.status(201).json(ok(session));
  }),
);

/** Status, so a resuming client can learn which chunks are still missing. */
creativeRouter.get(
  '/uploads/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    res.json(ok(await uploads.getSession(String(req.params.id), authed.userId)));
  }),
);

creativeRouter.put(
  '/uploads/:id/chunks/:index',
  requireAuth,
  // Raw body: this route receives binary, not JSON. The limit is one chunk plus
  // a small allowance, so an oversized body is rejected before it is buffered.
  express.raw({ type: '*/*', limit: uploads.CHUNK_SIZE + 1024 }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const index = Number(req.params.index);
    const body = req.body as Buffer;

    if (!Buffer.isBuffer(body)) {
      throw new AppError('bad_request', 'Chunk body must be raw binary.');
    }

    const result = await uploads.putChunk(
      String(req.params.id),
      authed.userId,
      index,
      body,
    );
    res.json(ok(result));
  }),
);

const completeUploadSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/i, 'Checksum must be a SHA-256 hex digest.').optional(),
});

creativeRouter.post(
  '/uploads/:id/complete',
  requireAuth,
  validate({ body: completeUploadSchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof completeUploadSchema }>(req).body;
    const result = await uploads.completeUpload(
      String(req.params.id),
      authed.userId,
      body.checksum,
    );
    res.json(ok({ ...result, url: storage.url(result.storageKey) }));
  }),
);

creativeRouter.delete(
  '/uploads/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    await uploads.abortUpload(String(req.params.id), authed.userId);
    res.json(ok({ aborted: true }));
  }),
);

// ── Drafts ──

const saveDraftSchema = z.object({
  id: z.string().max(32).optional(),
  caption: z.string().max(2200).optional(),
  coverKey: z.string().max(400).optional(),
  editList: edlSchema,
});

const ownershipCheckerFor = (userId: number) => (keys: string[]) =>
  uploads.assertOwnedKeys(userId, keys);

creativeRouter.post(
  '/drafts',
  requireAuth,
  limits.write,
  validate({ body: saveDraftSchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof saveDraftSchema }>(req).body;
    const editList = await validateEdl(body.editList, ownershipCheckerFor(authed.userId));

    const draft = await drafts.saveDraft(authed.userId, {
      ...(body.id ? { id: body.id } : {}),
      ...(body.caption !== undefined ? { caption: body.caption } : {}),
      ...(body.coverKey ? { coverKey: body.coverKey } : {}),
      editList,
    });
    res.status(body.id ? 200 : 201).json(ok(draft));
  }),
);

creativeRouter.get(
  '/drafts',
  requireAuth,
  validate({ query: pageQuerySchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const { cursor, limit } = valid<{ query: typeof pageQuerySchema }>(req).query;
    const page = await drafts.listDrafts(authed.userId, cursor, limit);
    res.json(
      ok(page.items, {
        hasMore: page.hasMore,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }),
    );
  }),
);

creativeRouter.get(
  '/drafts/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    res.json(ok(await drafts.getDraft(authed.userId, String(req.params.id))));
  }),
);

creativeRouter.delete(
  '/drafts/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    await drafts.deleteDraft(authed.userId, String(req.params.id));
    res.json(ok({ deleted: true }));
  }),
);

// ── Publish ──

const publishSchema = z.object({
  editList: edlSchema,
  caption: z.string().max(2200).default(''),
  privacy: z.enum(['public', 'followers', 'friends', 'private']),
  categoryId: z.string().max(32).optional(),
  coverKey: z.string().max(400).optional(),
  coverTimeMs: z.number().int().min(0).optional(),
  hashtags: z.array(z.string().max(64)).max(30).optional(),
  mentions: z.array(z.string().max(30)).max(30).optional(),
  locationName: z.string().max(120).optional(),
  allowComments: z.boolean().optional(),
  allowShare: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  allowRemix: z.boolean().optional(),
  allowDuet: z.boolean().optional(),
  draftId: z.string().max(32).optional(),
});

creativeRouter.post(
  '/videos',
  requireAuth,
  limits.upload,
  validate({ body: publishSchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const body = valid<{ body: typeof publishSchema }>(req).body;
    const editList = await validateEdl(body.editList, ownershipCheckerFor(authed.userId));

    const result = await publishing.publish(authed.userId, { ...body, editList });
    res.status(201).json(ok(result));
  }),
);

creativeRouter.get(
  '/render-jobs/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    res.json(ok(await publishing.getRenderJob(authed.userId, String(req.params.id))));
  }),
);

// ── Music ──

const musicQuerySchema = z.object({
  q: z.string().max(80).optional(),
  category: z.string().max(60).optional(),
  trending: z.coerce.boolean().optional(),
  favourites: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

interface TrackRow {
  id: number;
  public_id: string;
  title: string;
  artist: string;
  category: string | null;
  audio_url: string;
  cover_url: string | null;
  duration_sec: number;
  is_trending: number;
  usage_count: number;
  is_favourite?: number;
}

creativeRouter.get(
  '/music',
  requireAuth,
  limits.read,
  validate({ query: musicQuerySchema }),
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const q = valid<{ query: typeof musicQuerySchema }>(req).query;
    const limit = q.limit ?? 30;

    const conditions = ['m.is_enabled = 1', 'm.deleted_at IS NULL'];
    const params: Record<string, unknown> = { userId: authed.userId, limit };

    if (q.q) {
      conditions.push('(m.title LIKE :search OR m.artist LIKE :search)');
      params.search = `%${q.q}%`;
    }
    if (q.category) {
      conditions.push('m.category = :category');
      params.category = q.category;
    }
    if (q.trending) conditions.push('m.is_trending = 1');
    if (q.favourites) conditions.push('f.user_id IS NOT NULL');

    const rows = await query<TrackRow>(
      `SELECT m.id, m.public_id, m.title, m.artist, m.category, m.audio_url, m.cover_url,
              m.duration_sec, m.is_trending, m.usage_count,
              (f.user_id IS NOT NULL) AS is_favourite
         FROM music_tracks m
         LEFT JOIN music_favourites f ON f.track_id = m.id AND f.user_id = :userId
        WHERE ${conditions.join(' AND ')}
        ORDER BY m.is_trending DESC, m.usage_count DESC, m.id DESC
        LIMIT :limit`,
      params,
    );

    const tracks: MusicTrack[] = rows.map((r) => ({
      id: r.public_id,
      title: r.title,
      artist: r.artist,
      category: r.category ?? 'general',
      audioUrl: r.audio_url,
      ...(r.cover_url ? { coverUrl: r.cover_url } : {}),
      durationSec: Number(r.duration_sec),
      isTrending: r.is_trending === 1,
      isFavourite: Number(r.is_favourite) === 1,
      usageCount: Number(r.usage_count),
    }));

    res.json(ok(tracks));
  }),
);

creativeRouter.get(
  '/music/categories',
  requireAuth,
  limits.read,
  asyncHandler(async (_req, res) => {
    const rows = await query<{ category: string; n: number }>(
      `SELECT category, COUNT(*) AS n FROM music_tracks
        WHERE is_enabled = 1 AND deleted_at IS NULL AND category IS NOT NULL
        GROUP BY category ORDER BY n DESC`,
    );
    res.json(ok(rows.map((r) => ({ name: r.category, trackCount: Number(r.n) }))));
  }),
);

async function musicTrackId(req: Request): Promise<number> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM music_tracks WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId: String(req.params.id) },
  );
  if (!row) throw new AppError('not_found', 'Track not found.');
  return row.id;
}

creativeRouter.post(
  '/music/:id/favourite',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const trackId = await musicTrackId(req);
    await execute(
      'INSERT IGNORE INTO music_favourites (user_id, track_id) VALUES (:userId, :trackId)',
      { userId: authed.userId, trackId },
    );
    res.json(ok({ favourite: true }));
  }),
);

creativeRouter.delete(
  '/music/:id/favourite',
  requireAuth,
  limits.write,
  asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const trackId = await musicTrackId(req);
    await execute(
      'DELETE FROM music_favourites WHERE user_id = :userId AND track_id = :trackId',
      { userId: authed.userId, trackId },
    );
    res.json(ok({ favourite: false }));
  }),
);
