/**
 * Admin routes over the money configuration.
 *
 * Everything here is configuration, not movement. Approving a purchase or a
 * withdrawal — the paths that move value — live in the wallet module with their
 * ledger writes; these routes edit the catalogue those flows read: what a coin
 * costs, which payment accounts buyers send to, what the daily tasks pay.
 *
 * Every write is audited. "Who changed the payout rate" is a question with an
 * answer, always.
 */

import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { requireAdmin, type AdminRequest } from '../../middleware/rbac.ts';
import { AppError } from '../../core/errors.ts';
import { query, execute } from '../../core/db.ts';
import { audit } from '../../middleware/audit.ts';
import * as admin from './admin.service.ts';

export const adminMoneyRouter: Router = Router();
const guard: RequestHandler[] = [requireAuth, requireAdmin];

/** Same allow-listed editor as the content catalogues, for money tables. */
function editor(options: {
  path: string;
  module: string;
  table: string;
  idColumn?: string;
  listSql: string;
  editable: Record<string, 'string' | 'number' | 'boolean'>;
}): void {
  const idColumn = options.idColumn ?? 'id';

  adminMoneyRouter.get(
    `/admin/${options.path}`,
    ...guard,
    limits.read,
    asyncHandler(async (_req, res) => {
      res.json(ok({ items: await query(options.listSql) }));
    }),
  );

  const patchSchema = z.object({
    changes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  });

  adminMoneyRouter.patch(
    `/admin/${options.path}/:id`,
    ...guard,
    limits.write,
    validate({ body: patchSchema }),
    asyncHandler(async (req, res) => {
      const body = valid<{ body: typeof patchSchema }>(req).body;
      const id = String(req.params.id);

      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      for (const [column, value] of Object.entries(body.changes)) {
        const kind = options.editable[column];
        if (!kind) throw new AppError('validation_failed', `'${column}' is not editable here.`);
        if (kind === 'boolean' && typeof value !== 'boolean') {
          throw new AppError('validation_failed', `'${column}' expects a boolean.`);
        }
        if (kind === 'number') {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            throw new AppError('validation_failed', `'${column}' expects a non-negative number.`);
          }
        }
        sets.push(`\`${column}\` = :set_${column}`);
        params[`set_${column}`] = kind === 'boolean' ? (value ? 1 : 0) : value;
      }
      if (sets.length === 0) throw new AppError('validation_failed', 'Nothing to change.');

      const result = await execute(
        `UPDATE \`${options.table}\` SET ${sets.join(', ')} WHERE \`${idColumn}\` = :id`,
        params,
      );
      if (result.affectedRows === 0) throw new AppError('not_found', 'No such row.');

      await audit(req, {
        module: options.module,
        action: 'update',
        targetType: options.table,
        targetId: id,
        newValue: body.changes,
      });
      res.json(ok({ saved: true }));
    }),
  );
}

editor({
  path: 'coin-packages',
  module: 'coins',
  table: 'coin_packages',
  listSql: `SELECT id, coins, bonus_coins AS bonusCoins, base_price AS price, base_currency AS currency,
                   discount_percent AS discountPercent, is_popular AS isPopular, is_enabled AS isEnabled,
                   sort_order AS sortOrder
              FROM coin_packages ORDER BY sort_order, coins`,
  editable: {
    coins: 'number', bonus_coins: 'number', base_price: 'number', discount_percent: 'number',
    is_popular: 'boolean', is_enabled: 'boolean', sort_order: 'number',
  },
});

editor({
  path: 'gift-catalogue',
  module: 'gifts',
  table: 'gifts',
  listSql: `SELECT g.id, g.slug, g.name, g.icon, g.coins, g.is_featured AS isFeatured, g.is_active AS isActive,
                   g.sort_order AS sortOrder,
                   (SELECT COUNT(*) FROM gift_transactions t WHERE t.gift_id = g.id) AS timesSent
              FROM gifts g ORDER BY g.sort_order, g.coins`,
  editable: { name: 'string', icon: 'string', coins: 'number', is_featured: 'boolean', is_active: 'boolean', sort_order: 'number' },
});

editor({
  path: 'payment-methods',
  module: 'rates',
  table: 'payment_methods',
  listSql: `SELECT id, slug, label, kind, account_name AS accountName, account_number AS accountNumber,
                   instructions, is_enabled AS isEnabled
              FROM payment_methods ORDER BY id`,
  editable: {
    label: 'string', account_name: 'string', account_number: 'string',
    instructions: 'string', is_enabled: 'boolean',
  },
});

editor({
  path: 'payout-methods',
  module: 'rates',
  table: 'payout_methods',
  listSql: `SELECT id, slug, label, kind, field_label AS fieldLabel, network,
                   min_amount AS minAmount, fee_percent AS feePercent,
                   processing_time AS processingTime, is_enabled AS isEnabled
              FROM payout_methods ORDER BY id`,
  editable: {
    label: 'string', field_label: 'string', min_amount: 'number', fee_percent: 'number',
    processing_time: 'string', is_enabled: 'boolean',
  },
});

editor({
  path: 'currency-rates',
  module: 'rates',
  table: 'currency_rates',
  idColumn: 'code',
  listSql: `SELECT code, label, symbol, coins_per_unit AS coinsPerUnit, min_amount AS minAmount,
                   is_enabled AS isEnabled, updated_at AS updatedAt
              FROM currency_rates ORDER BY code`,
  editable: { label: 'string', symbol: 'string', coins_per_unit: 'number', min_amount: 'number', is_enabled: 'boolean' },
});

editor({
  path: 'daily-tasks',
  module: 'tasks',
  table: 'daily_tasks',
  listSql: `SELECT id, task_key AS taskKey, title, description, icon, metric, target,
                   reward_coins AS rewardCoins, is_enabled AS isEnabled, sort_order AS sortOrder
              FROM daily_tasks ORDER BY sort_order`,
  editable: {
    title: 'string', description: 'string', target: 'number', reward_coins: 'number',
    is_enabled: 'boolean', sort_order: 'number',
  },
});

editor({
  path: 'criteria',
  module: 'monetization',
  table: 'monetization_criteria',
  listSql: `SELECT id, criterion_key AS criterionKey, label, metric, required, unit,
                   is_boolean AS isBoolean, is_enabled AS isEnabled, sort_order AS sortOrder
              FROM monetization_criteria ORDER BY sort_order`,
  editable: { label: 'string', required: 'number', is_enabled: 'boolean', sort_order: 'number' },
});

// ── Payments ledger view ──
//
// Every movement of real money in one place: coin purchases in, withdrawals
// out, whatever their state. Read-only — decisions happen in their own queues.

adminMoneyRouter.get(
  '/admin/payments',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    const [purchases, withdrawals] = await Promise.all([
      query(
        `SELECT r.public_id AS id, u.username, r.coins, r.fiat_amount AS amount, r.fiat_currency AS currency,
                m.label AS method, r.status, r.transaction_ref AS reference, r.created_at AS createdAt,
                r.decided_at AS decidedAt
           FROM coin_purchase_requests r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN payment_methods m ON m.id = r.method_id
          WHERE r.deleted_at IS NULL
          ORDER BY r.id DESC LIMIT 100`,
      ),
      query(
        `SELECT w.public_id AS id, u.username, w.amount, w.net_amount AS netAmount, w.currency,
                m.label AS method, w.status, w.payout_ref AS reference, w.created_at AS createdAt,
                w.decided_at AS decidedAt
           FROM withdrawal_requests w
           JOIN users u ON u.id = w.user_id
           LEFT JOIN payout_methods m ON m.id = w.method_id
          WHERE w.deleted_at IS NULL
          ORDER BY w.id DESC LIMIT 100`,
      ),
    ]);
    res.json(ok({ purchases, withdrawals }));
  }),
);

// ── AI / ranking models (read view; weights have their own routes) ──

adminMoneyRouter.get(
  '/admin/models',
  ...guard,
  limits.read,
  asyncHandler(async (_req, res) => {
    const [models, experiments] = await Promise.all([
      query(
        `SELECT id, version, approach, status, notes, activated_at AS activatedAt, created_at AS createdAt
           FROM ranking_models ORDER BY id DESC LIMIT 50`,
      ),
      query(
        `SELECT id, experiment_id AS experimentId, hypothesis, status, primary_metric AS primaryMetric,
                started_at AS startedAt, ended_at AS endedAt
           FROM experiments ORDER BY id DESC LIMIT 50`,
      ),
    ]);
    res.json(ok({ models, experiments }));
  }),
);
