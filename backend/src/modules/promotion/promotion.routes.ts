/**
 * Promotion and campaign routes.
 *
 * Creating a campaign takes coins, so it carries `Idempotency-Key` and uses the
 * durable variant — `campaigns.idempotency_key` is unique per advertiser, so a
 * retry finds the original rather than funding a second one (ADR-032).
 *
 * There is no route here for buying engagement, and there is nowhere to add one
 * without inventing a field the contract does not have. That is deliberate.
 */

import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { idempotency } from '../../middleware/idempotency.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { requireAdmin } from '../../middleware/rbac.ts';
import { queryOne } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import * as campaigns from './campaigns.service.ts';
import * as delivery from './delivery.service.ts';

export const promotionRouter: Router = Router();

// ── Schemas ──

const targetingSchema = z.object({
  mode: z.enum(['automatic', 'custom', 'broad']).default('automatic'),
  countries: z.array(z.string().trim().length(2)).max(50).optional(),
  cities: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  languages: z.array(z.string().trim().min(2).max(10)).max(30).optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  categories: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  devices: z.array(z.enum(['ios', 'android', 'web'])).max(3).optional(),
  os: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
  // The platform's own minimum age is the floor; a campaign cannot target
  // below it however the request is phrased.
  ageMin: z.coerce.number().int().min(13).max(100).optional(),
  ageMax: z.coerce.number().int().min(13).max(100).optional(),
});

const objectiveSchema = z.enum([
  'awareness',
  'reach',
  'video_views',
  'engagement',
  'followers',
  'profile_visits',
  'website_traffic',
  'leads',
  'app_promotion',
]);

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  videoId: z.string().trim().max(64).optional(),
  objective: objectiveSchema,
  budgetCoins: z.coerce.number().int().min(1).max(100_000_000),
  durationDays: z.coerce.number().int().min(1).max(90),
  targeting: targetingSchema,
  dailyCapCoins: z.coerce.number().int().min(1).optional(),
  ctaLabel: z.string().trim().max(40).optional(),
  destinationUrl: z.string().trim().url().max(500).optional(),
  kind: z.enum(['promotion', 'campaign']).optional(),
});

const estimateSchema = z.object({
  budgetCoins: z.coerce.number().int().min(1).max(100_000_000),
  durationDays: z.coerce.number().int().min(1).max(90),
  targeting: targetingSchema,
});

const stateSchema = z.object({
  action: z.enum(['pause', 'resume', 'stop']),
});

const reviewSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().min(3).max(500),
});

const signalSchema = z.object({
  campaignId: z.string().trim().min(1).max(64),
  impressionId: z.string().trim().min(1).max(128),
});

// ── Advertiser ──

promotionRouter.post(
  '/campaigns/estimate',
  requireAuth,
  limits.read,
  validate({ body: estimateSchema }),
  asyncHandler(async (req, res) => {
    const body = valid<{ body: typeof estimateSchema }>(req).body;
    res.json(ok(await campaigns.estimate(body.budgetCoins, body.durationDays, body.targeting)));
  }),
);

promotionRouter.get(
  '/campaigns',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await campaigns.listCampaigns(userId)));
  }),
);

promotionRouter.post(
  '/campaigns',
  requireAuth,
  limits.money,
  // Durable: the budget hold carries the key on both `campaigns` and the ledger.
  idempotency({ durable: true }),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof createSchema }>(req).body;
    const key = req.header('idempotency-key') ?? '';
    res
      .status(201)
      .json(ok(await campaigns.createCampaign(userId, { ...body, idempotencyKey: key })));
  }),
);

promotionRouter.get(
  '/campaigns/:id',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await campaigns.getCampaign(userId, String(req.params.id))));
  }),
);

promotionRouter.get(
  '/campaigns/:id/metrics',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await campaigns.metrics(userId, String(req.params.id))));
  }),
);

promotionRouter.post(
  '/campaigns/:id/state',
  requireAuth,
  limits.money,
  validate({ body: stateSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof stateSchema }>(req).body;
    res.json(ok(await campaigns.setCampaignState(userId, String(req.params.id), body.action)));
  }),
);

// ── Delivery signals ──

/** Resolves a campaign's public id to its row id, or refuses. */
async function resolveCampaign(publicId: string): Promise<number> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM campaigns WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'Campaign not found.');
  return row.id;
}

/**
 * A promoted video was watched.
 *
 * Charged once per delivery. A viewer rewatching does not cost the advertiser
 * again, because `viewed_at` is set once.
 */
promotionRouter.post(
  '/campaigns/signals/view',
  requireAuth,
  limits.signals,
  validate({ body: signalSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof signalSchema }>(req).body;
    const campaignId = await resolveCampaign(body.campaignId);
    res.json(ok(await delivery.recordView(campaignId, userId, body.impressionId)));
  }),
);

/** A call to action was tapped. Recorded, never charged — the impression was. */
promotionRouter.post(
  '/campaigns/signals/click',
  requireAuth,
  limits.signals,
  validate({ body: signalSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof signalSchema }>(req).body;
    const campaignId = await resolveCampaign(body.campaignId);
    res.json(ok(await delivery.recordClick(campaignId, userId, body.impressionId)));
  }),
);

// ── Administration ──

promotionRouter.get(
  '/admin/campaigns',
  requireAuth,
  requireAdmin,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await campaigns.pendingCampaigns()));
  }),
);

promotionRouter.post(
  '/admin/campaigns/:id',
  requireAuth,
  requireAdmin,
  limits.money,
  validate({ body: reviewSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof reviewSchema }>(req).body;
    res.json(
      ok(await campaigns.reviewCampaign(userId, String(req.params.id), body.approve, body.note)),
    );
  }),
);
