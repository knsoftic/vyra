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
  /** Columns an operator may set when creating a row, and which are required. */
  creatable?: {
    fields: Record<string, 'string' | 'number' | 'boolean'>;
    required: string[];
  };
  /** Only for tables that carry `deleted_at`. */
  softDelete?: boolean;
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

  /**
   * Creating a row.
   *
   * `creatable` names the columns an operator may set and their types, exactly
   * like `editable` — the incoming key selects from that list and is never
   * interpolated. `required` are the ones a row is meaningless without.
   */
  if (options.creatable) {
    const creatable = options.creatable;
    const createSchema = z.object({
      values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    });

    adminMoneyRouter.post(
      `/admin/${options.path}`,
      ...guard,
      limits.write,
      validate({ body: createSchema }),
      asyncHandler(async (req, res) => {
        const body = valid<{ body: typeof createSchema }>(req).body;

        for (const column of creatable.required) {
          const value = body.values[column];
          if (value === undefined || value === '') {
            throw new AppError('validation_failed', `'${column}' is required.`);
          }
        }

        const columns: string[] = [];
        const placeholders: string[] = [];
        const params: Record<string, unknown> = {};

        for (const [column, value] of Object.entries(body.values)) {
          const kind = creatable.fields[column];
          if (!kind) throw new AppError('validation_failed', `'${column}' cannot be set here.`);
          if (kind === 'boolean' && typeof value !== 'boolean') {
            throw new AppError('validation_failed', `'${column}' expects a boolean.`);
          }
          if (kind === 'number' && typeof value !== 'number') {
            throw new AppError('validation_failed', `'${column}' expects a number.`);
          }
          columns.push(`\`${column}\``);
          placeholders.push(`:${column}`);
          params[column] = kind === 'boolean' ? (value ? 1 : 0) : value;
        }

        if (columns.length === 0) throw new AppError('validation_failed', 'Nothing to create.');

        let insertId: number | string;
        try {
          const result = await execute(
            `INSERT INTO \`${options.table}\` (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
            params,
          );
          insertId = result.insertId;
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === 'ER_DUP_ENTRY') {
            throw new AppError('conflict', 'A row with that key already exists.');
          }
          // The table requires a column the form did not send. Naming it is the
          // difference between a fixable message and "something went wrong".
          if (code === 'ER_NO_DEFAULT_FOR_FIELD') {
            const field = /Field '([^']+)'/.exec((err as Error).message)?.[1];
            throw new AppError(
              'validation_failed',
              field ? `'${field}' is required and was not provided.` : 'A required column is missing.',
            );
          }
          throw err;
        }

        await audit(req, {
          module: options.module,
          action: 'create',
          targetType: options.table,
          targetId: String(insertId),
          newValue: body.values,
        });
        res.status(201).json(ok({ id: insertId }));
      }),
    );
  }

  /**
   * Deleting a row.
   *
   * Soft where the table supports it, because a catalogue row is referenced by
   * content that already exists: hard-deleting a music track would orphan every
   * video that used it. Where there is no `deleted_at`, disabling is offered
   * instead of removal and this route is not registered at all.
   */
  if (options.softDelete) {
    adminMoneyRouter.delete(
      `/admin/${options.path}/:id`,
      ...guard,
      limits.write,
      asyncHandler(async (req, res) => {
        const id = String(req.params.id);
        const result = await execute(
          `UPDATE \`${options.table}\` SET deleted_at = CURRENT_TIMESTAMP(3)
            WHERE \`${idColumn}\` = :id AND deleted_at IS NULL`,
          { id },
        );
        if (result.affectedRows === 0) throw new AppError('not_found', 'No such row.');

        await audit(req, {
          module: options.module,
          action: 'delete',
          targetType: options.table,
          targetId: id,
        });
        res.json(ok({ deleted: true }));
      }),
    );
  }
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
  creatable: {
    fields: {
      coins: 'number', bonus_coins: 'number', base_price: 'number', base_currency: 'string',
      discount_percent: 'number', is_popular: 'boolean', is_enabled: 'boolean', sort_order: 'number',
    },
    required: ['coins', 'base_price', 'base_currency'],
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
  creatable: {
    fields: {
      slug: 'string', name: 'string', icon: 'string', coins: 'number',
      is_featured: 'boolean', is_active: 'boolean', sort_order: 'number',
    },
    required: ['slug', 'name', 'icon', 'coins'],
  },
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
  creatable: {
    fields: {
      slug: 'string', label: 'string', kind: 'string', account_name: 'string',
      account_number: 'string', currencies: 'string', instructions: 'string', is_enabled: 'boolean',
    },
    required: ['slug', 'label', 'kind', 'currencies', 'account_name', 'account_number'],
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
  creatable: {
    fields: {
      slug: 'string', label: 'string', kind: 'string', field_label: 'string', network: 'string',
      min_amount: 'number', fee_percent: 'number', processing_time: 'string', is_enabled: 'boolean',
    },
    required: ['slug', 'label', 'kind', 'field_label'],
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
  creatable: {
    fields: {
      code: 'string', label: 'string', symbol: 'string',
      coins_per_unit: 'number', min_amount: 'number', is_enabled: 'boolean',
    },
    required: ['code', 'label', 'symbol', 'coins_per_unit'],
  },
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
  creatable: {
    fields: {
      task_key: 'string', title: 'string', description: 'string', icon: 'string',
      metric: 'string', target: 'number', reward_coins: 'number', reward_label: 'string',
      is_enabled: 'boolean', sort_order: 'number',
    },
    required: ['task_key', 'title', 'metric', 'target', 'reward_coins'],
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
  creatable: {
    fields: {
      criterion_key: 'string', label: 'string', metric: 'string', required: 'number',
      unit: 'string', is_boolean: 'boolean', is_enabled: 'boolean', sort_order: 'number',
    },
    required: ['criterion_key', 'label', 'metric', 'required'],
  },
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
