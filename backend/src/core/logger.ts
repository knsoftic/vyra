/** Structured logging. Pretty in development, JSON everywhere else. */

import pino from 'pino';
import { config } from './config.ts';

export const logger = pino({
  level: config.LOG_LEVEL,
  // Anything listed here is replaced with [Redacted] before it reaches a log sink.
  // Credentials and payout destinations must never appear in logs.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.code',
      'req.body.destination',
      'req.body.transactionRef',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.accessToken',
      '*.streamKey',
      '*.secret',
    ],
    censor: '[Redacted]',
  },
  ...(config.isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});

export type Logger = typeof logger;
