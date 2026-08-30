/**
 * Health endpoints.
 *
 * `/health` is a liveness probe: it answers if the process is up, and must never
 * touch a dependency — a slow database should not cause an orchestrator to kill
 * an otherwise healthy container.
 *
 * `/ready` is a readiness probe: it checks the dependencies the API cannot serve
 * without, and returns 503 when one is missing so traffic is routed elsewhere.
 */

import { Router } from 'express';
import { pingDb } from '../../core/db.ts';
import { pingRedis } from '../../core/redis.ts';
import { ok } from '../../../../shared/contracts/http.ts';
import { asyncHandler } from '../../middleware/async.ts';

export const healthRouter: Router = Router();

const startedAt = Date.now();

healthRouter.get('/health', (_req, res) => {
  res.json(
    ok({
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
    }),
  );
});

healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
    const ready = db && redis;
    res.status(ready ? 200 : 503).json(
      ok({
        ready,
        checks: { database: db ? 'up' : 'down', redis: redis ? 'up' : 'down' },
      }),
    );
  }),
);
