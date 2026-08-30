/**
 * Wallet reads.
 *
 * The balance and the ledger — no movements. Everything that *moves* value has
 * its own route in the module that owns the reason for the movement: gifts in
 * `live`, purchases and withdrawals in the monetization phase. A generic
 * "adjust my balance" endpoint is exactly what should not exist.
 *
 * The ledger is returned in full rather than summarised, because the whole
 * point of an append-only ledger is that someone can reconstruct how they got
 * to the number they are looking at.
 */

import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';
import { validate, valid } from '../../middleware/validate.ts';
import { limits } from '../../middleware/ratelimit.ts';
import { requireAuth, type AuthedRequest } from '../../middleware/auth.ts';
import { query } from '../../core/db.ts';
import * as ledger from './ledger.ts';

export const walletRouter: Router = Router();

walletRouter.get(
  '/me/wallet',
  requireAuth,
  limits.read,
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    res.json(ok(await ledger.getBalances(userId)));
  }),
);

const ledgerQuerySchema = z.object({
  wallet: z.enum(['coin', 'reward', 'live_gift', 'withdrawable']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

walletRouter.get(
  '/me/wallet/ledger',
  requireAuth,
  limits.read,
  validate({ query: ledgerQuerySchema }),
  asyncHandler(async (req, res) => {
    const { userId } = req as AuthedRequest;
    const { wallet, limit } = valid<{ query: typeof ledgerQuerySchema }>(req).query;

    const rows = await query<{
      public_id: string;
      wallet: string;
      entry_type: string;
      description: string;
      amount: string | number;
      balance_before: string | number;
      balance_after: string | number;
      status: string;
      created_at: Date;
    }>(
      `SELECT public_id, wallet, entry_type, description, amount,
              balance_before, balance_after, status, created_at
         FROM wallet_ledger
        WHERE user_id = :userId
          ${wallet ? 'AND wallet = :wallet' : ''}
        ORDER BY id DESC
        LIMIT :limit`,
      { userId, limit: limit ?? 50, ...(wallet ? { wallet } : {}) },
    );

    res.json(
      ok(
        rows.map((r) => ({
          id: r.public_id,
          wallet: r.wallet,
          type: r.entry_type,
          description: r.description,
          amount: Number(r.amount),
          balanceBefore: Number(r.balance_before),
          balanceAfter: Number(r.balance_after),
          status: r.status,
          createdAt: new Date(r.created_at).toISOString(),
        })),
      ),
    );
  }),
);
