/**
 * Coin purchases, withdrawals, tasks and referrals.
 *
 * Every route that moves value carries `Idempotency-Key`. Purchases and
 * withdrawals use the durable variant because their handlers carry the key into
 * the database, so a retry stays safe when the cache is unavailable (ADR-032).
 *
 * Administrator routes are mounted here rather than in a separate admin module
 * because they act on the same rows under the same invariants — splitting them
 * is how two code paths end up disagreeing about what "approved" means.
 */

import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { SOCKET_EVENTS } from '../../../../shared/contracts/routes.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { idempotency } from '../../middleware/idempotency.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { requireAdmin } from '../../middleware/rbac.ts';
import { emitToUser } from '../../socket.ts';
import * as purchases from './purchases.service.ts';
import * as withdrawals from './withdrawals.service.ts';
import * as rewards from './rewards.service.ts';
import * as eligibility from './monetization.service.ts';

export const monetizationRouter: Router = Router();

// ── Schemas ──

const currencyQuery = z.object({
  currency: z.string().trim().length(3).optional(),
});

const purchaseSchema = z
  .object({
    packageId: z.string().trim().max(64).optional(),
    coins: z.coerce.number().int().min(1).max(10_000_000).optional(),
    methodId: z.string().trim().min(1).max(64),
    transactionRef: z.string().trim().min(3).max(191),
    proofKey: z.string().trim().max(500).optional(),
    currency: z.string().trim().length(3).optional(),
  })
  .refine((v) => Boolean(v.packageId) || Boolean(v.coins), {
    message: 'Choose a package or enter a coin amount.',
  });

const withdrawalSchema = z.object({
  methodId: z.string().trim().min(1).max(64),
  amount: z.coerce.number().positive().max(1_000_000),
  destination: z.string().trim().min(3).max(255),
});

const convertSchema = z.object({
  amount: z.coerce.number().positive().max(10_000_000),
});

const decisionSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().min(3).max(500),
});

const withdrawalDecisionSchema = z.object({
  action: z.enum(['approve', 'pay', 'reject']),
  note: z.string().trim().min(3).max(500),
  payoutRef: z.string().trim().max(191).optional(),
});

// ── Catalogues ──

monetizationRouter.get(
  '/coins/packages',
  requireAuth,
  limits.read,
  validate({ query: currencyQuery }),
  asyncHandler(async (req, res) => {
    const { currency } = valid<{ query: typeof currencyQuery }>(req).query;
    res.json(ok(await purchases.listPackages((currency ?? 'USD').toUpperCase())));
  }),
);

monetizationRouter.get(
  '/coins/payment-methods',
  requireAuth,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await purchases.listPaymentMethods()));
  }),
);

monetizationRouter.get(
  '/payouts/methods',
  requireAuth,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await withdrawals.listPayoutMethods()));
  }),
);

// ── Buying coins ──

monetizationRouter.get(
  '/me/purchases',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await purchases.listPurchases(userId)));
  }),
);

monetizationRouter.post(
  '/coins/purchases',
  requireAuth,
  limits.money,
  // Durable: `coin_purchase_requests` carries the key under a unique index, so
  // a retry finds the original request instead of creating a second one for an
  // administrator to reconcile by hand.
  idempotency({ durable: true }),
  validate({ body: purchaseSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof purchaseSchema }>(req).body;
    const key = req.header('idempotency-key') ?? '';
    res.status(201).json(ok(await purchases.requestPurchase(userId, { ...body, idempotencyKey: key })));
  }),
);

// ── Withdrawing ──

monetizationRouter.get(
  '/me/withdrawals',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await withdrawals.listWithdrawals(userId)));
  }),
);

monetizationRouter.post(
  '/withdrawals',
  requireAuth,
  limits.money,
  // Durable: the hold carries the key on `wallet_ledger`, so a retry finds the
  // original request rather than placing a second hold.
  idempotency({ durable: true }),
  validate({ body: withdrawalSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof withdrawalSchema }>(req).body;
    const key = req.header('idempotency-key') ?? '';

    const request = await withdrawals.requestWithdrawal(userId, { ...body, idempotencyKey: key });
    emitToUser(userId, SOCKET_EVENTS.walletUpdated, { reason: 'withdrawal_requested' });
    res.status(201).json(ok(request));
  }),
);

monetizationRouter.post(
  '/withdrawals/:id/cancel',
  requireAuth,
  limits.money,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const result = await withdrawals.cancelWithdrawal(userId, String(req.params.id));
    emitToUser(userId, SOCKET_EVENTS.walletUpdated, { reason: 'withdrawal_cancelled' });
    res.json(ok(result));
  }),
);

// ── Tasks and rewards ──

monetizationRouter.get(
  '/me/tasks',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await rewards.listTasks(userId)));
  }),
);

// ── Monetization eligibility ──

monetizationRouter.get(
  '/me/monetization',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await eligibility.monetizationStatus(userId)));
  }),
);

/**
 * Applying.
 *
 * `limits.money` rather than `limits.write`: this puts an account into a
 * queue a human works through, and the rate a person can join that queue
 * should match the rest of the money surface.
 */
monetizationRouter.post(
  '/me/monetization/apply',
  requireAuth,
  limits.money,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await eligibility.applyForMonetization(userId)));
  }),
);

monetizationRouter.post(
  '/me/tasks/:id/claim',
  requireAuth,
  limits.money,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const result = await rewards.claimTask(userId, String(req.params.id));
    if (!result.alreadyClaimed) {
      emitToUser(userId, SOCKET_EVENTS.walletUpdated, { reason: 'task_reward' });
    }
    res.json(ok(result));
  }),
);

monetizationRouter.post(
  '/me/rewards/convert',
  requireAuth,
  limits.money,
  idempotency({ durable: true }),
  validate({ body: convertSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof convertSchema }>(req).body;
    const key = req.header('idempotency-key') ?? '';
    const result = await rewards.convertReward(userId, body.amount, key);
    emitToUser(userId, SOCKET_EVENTS.walletUpdated, { reason: 'reward_converted' });
    res.json(ok(result));
  }),
);

monetizationRouter.get(
  '/me/referrals',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await rewards.referralSummary(userId)));
  }),
);

// ── Administration ──

monetizationRouter.get(
  '/admin/purchases',
  requireAuth,
  requireAdmin,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await purchases.pendingPurchases()));
  }),
);

monetizationRouter.post(
  '/admin/purchases/:id',
  requireAuth,
  requireAdmin,
  limits.money,
  validate({ body: decisionSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof decisionSchema }>(req).body;
    const result = await purchases.decidePurchase(
      userId,
      String(req.params.id),
      body.approve,
      body.note,
    );
    res.json(ok(result));
  }),
);

monetizationRouter.get(
  '/admin/withdrawals',
  requireAuth,
  requireAdmin,
  limits.read,
  asyncHandler(async (_req, res) => {
    res.json(ok(await withdrawals.pendingWithdrawals()));
  }),
);

monetizationRouter.post(
  '/admin/withdrawals/:id',
  requireAuth,
  requireAdmin,
  limits.money,
  validate({ body: withdrawalDecisionSchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const body = valid<{ body: typeof withdrawalDecisionSchema }>(req).body;
    const result = await withdrawals.decideWithdrawal(
      userId,
      String(req.params.id),
      body.action,
      body.note,
      body.payoutRef,
    );
    res.json(ok(result));
  }),
);
