/**
 * Process entry point.
 *
 * Boots the HTTP and socket servers, then shuts them down in the right order on
 * a signal: stop accepting new connections, let in-flight requests finish, close
 * the sockets, then release the database and Redis handles. Killing the pool
 * while a money transaction is mid-flight is exactly how a ledger ends up
 * inconsistent, so it happens last.
 */

import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { createSocketServer } from './socket.ts';
import { config } from './core/config.ts';
import { logger } from './core/logger.ts';
import { closeDb, pingDb } from './core/db.ts';
import { closeRedis, pingRedis } from './core/redis.ts';

const app = createApp();
const httpServer = createServer(app);
const io = createSocketServer(httpServer);

const SHUTDOWN_TIMEOUT_MS = 15000;
let shuttingDown = false;

async function start(): Promise<void> {
  const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
  if (!db) logger.warn('database is not reachable — /ready will report not ready');
  if (!redis) logger.warn('redis is not reachable — /ready will report not ready');

  httpServer.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      `Vyra API listening on http://localhost:${config.PORT}`,
    );
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // If a connection refuses to drain, exit anyway rather than hanging forever.
  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await io.close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    await closeDb();
    await closeRedis();
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  // The process state is no longer trustworthy after this — log and let the
  // orchestrator restart rather than continuing to serve requests.
  logger.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException');
});

void start().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
