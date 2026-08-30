/**
 * Express application assembly.
 *
 * Kept separate from server.ts so tests can mount the app without binding a port
 * or starting the socket server.
 */

import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { config } from './core/config.ts';
import { logger } from './core/logger.ts';
import { API_PREFIX } from '../../shared/contracts/routes.ts';
import { errorHandler, notFoundHandler } from './middleware/error.ts';
import { healthRouter } from './modules/health/health.routes.ts';
import { authRouter } from './modules/auth/auth.routes.ts';
import { usersRouter } from './modules/users/users.routes.ts';
import { creativeRouter } from './modules/creative/creative.routes.ts';
import { mediaRouter } from './modules/media/media.routes.ts';
import { behaviourRouter } from './modules/behaviour/behaviour.routes.ts';
import { feedRouter } from './modules/feed/feed.routes.ts';
import { videosRouter } from './modules/videos/videos.routes.ts';
import { chatRouter } from './modules/chat/chat.routes.ts';
import { communitiesRouter } from './modules/chat/communities.routes.ts';
import { callsRouter } from './modules/chat/calls.routes.ts';
import { liveRouter } from './modules/live/live.routes.ts';
import { walletRouter } from './modules/wallet/wallet.routes.ts';
import { monetizationRouter } from './modules/wallet/monetization.routes.ts';
import { promotionRouter } from './modules/promotion/promotion.routes.ts';
import { trustRouter } from './modules/trust/trust.routes.ts';
import { notificationsRouter } from './modules/notifications/notifications.routes.ts';
import { engagementRouter } from './modules/social/engagement.routes.ts';
import { adminRouter } from './modules/admin/admin.routes.ts';
import { adminContentRouter } from './modules/admin/admin-content.routes.ts';
import { adminMoneyRouter } from './modules/admin/admin-money.routes.ts';

export function createApp(): Express {
  const app = express();

  // Behind a load balancer this is what makes req.ip the real client address —
  // and therefore what makes per-IP rate limiting meaningful.
  if (config.TRUST_PROXY) app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(
    cors({
      origin: (origin, callback) => {
        // Native apps and server-to-server calls send no Origin header.
        if (!origin || config.CORS_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed.`));
      },
      credentials: true,
      exposedHeaders: ['x-request-id', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // A request id on every response, echoed in logs and error bodies, so a user
  // report maps to exactly one log line.
  app.use((req, res, next) => {
    const id = req.header('x-request-id') ?? randomUUID();
    res.setHeader('x-request-id', id);
    next();
  });

  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const line = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(ms * 100) / 100,
        requestId: res.getHeader('x-request-id'),
      };
      if (res.statusCode >= 500) logger.error(line, 'request failed');
      else if (res.statusCode >= 400) logger.warn(line, 'request rejected');
      else logger.debug(line, 'request');
    });
    next();
  });

  // Probes sit outside the versioned prefix so infrastructure never has to know
  // the API version.
  app.use(healthRouter);

  const api = express.Router();
  api.use(authRouter);
  api.use(usersRouter);
  api.use(creativeRouter);
  api.use(mediaRouter);
  api.use(behaviourRouter);
  api.use(feedRouter);
  api.use(videosRouter);
  api.use(chatRouter);
  api.use(communitiesRouter);
  api.use(callsRouter);
  api.use(liveRouter);
  api.use(walletRouter);
  api.use(monetizationRouter);
  api.use(promotionRouter);
  api.use(trustRouter);
  api.use(notificationsRouter);
  api.use(engagementRouter);
  api.use(adminRouter);
  api.use(adminContentRouter);
  api.use(adminMoneyRouter);
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
