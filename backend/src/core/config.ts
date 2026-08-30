/**
 * Environment configuration.
 *
 * Parsed once, at boot, through a schema. A missing or malformed variable stops
 * the process immediately with a readable list — the server never starts in a
 * half-configured state and then fails on the first request that needs the value.
 *
 * Note what is NOT here: business rules. Coin rates, task rewards, monetization
 * thresholds and exploration rates all live in the database so an admin can change
 * them without a deploy (ADR-015). This file holds infrastructure only.
 */

import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1).default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1).default('vyra'),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),

  // Two distinct secrets: a leaked access secret must not also mint refresh tokens.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  STORAGE_ENDPOINT: z.string().default('http://127.0.0.1:9000'),
  STORAGE_BUCKET: z.string().default('vyra-media'),
  STORAGE_ACCESS_KEY: z.string().default('vyra'),
  STORAGE_SECRET_KEY: z.string().default('vyra-secret'),
  STORAGE_PUBLIC_URL: z.string().default('http://127.0.0.1:9000/vyra-media'),

  // Live streaming. The application never carries video: it issues the ingest
  // credential and points viewers at the media server, which is deployment.
  LIVE_INGEST_URL: z.string().default('rtmp://127.0.0.1:1935/live'),
  LIVE_PLAYBACK_URL: z.string().default('http://127.0.0.1:8080'),

  // Email. With no SMTP host the mailer logs instead of delivering, which is
  // what makes development possible — and what the launch preflight refuses to
  // let through to production.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Vyra <no-reply@vyra.app>'),

  // Push. Same principle: without a key the outbox records what would have been
  // sent rather than claiming it was.
  PUSH_PROVIDER_KEY: z.string().optional(),

  ML_SERVICE_URL: z.string().default('http://127.0.0.1:8000'),

  // Upload chunk size. 5 MB is a good default for mobile networks — small enough
  // that a failed chunk is cheap to retry, large enough to avoid chatty overhead.
  // Tunable because the right value depends on the network, and because tests
  // want something far smaller than a real upload.
  UPLOAD_CHUNK_SIZE: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(5 * 1024 * 1024),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:8081')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  RATE_LIMIT_ENABLED: bool.default(true),
  TRUST_PROXY: bool.default(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  console.error('Copy .env.example to .env and fill in the missing values.\n');
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
} as const;

export type Config = typeof config;
