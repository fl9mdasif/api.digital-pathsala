import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Tests inject their own environment and must never read the developer's .env (it points at a real database).
if (process.env.NODE_ENV !== 'test') dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SUPER_ADMIN_PASS: z.string().min(1).optional(),
  ADMIN_EMAIL: z.string().optional(),

  PLATFORM_NAME: z.string().default('xyz'),
  PLATFORM_DOMAIN: z.string().default('xyz.com'),
  RESERVED_SLUGS: z.string().default(''),
  // The live client and local dev. Set CORS_ORIGINS in the host to add a custom domain.
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001,https://digital-pathsala.vercel.app'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  SENTRY_DSN: z.string().url().optional(),
  PUBLIC_CACHE_TTL_MS: z.coerce.number().int().min(0).default(15000),
  UPLOAD_PROVIDER: z.enum(['mock', 'cloudinary']).default('mock'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
});

const parsed = schema
  .superRefine((v, ctx) => {
    // A weak owner password is tolerated on a developer machine only.
    if (v.NODE_ENV === 'production' && v.SUPER_ADMIN_PASS && v.SUPER_ADMIN_PASS.length < 12) {
      ctx.addIssue({
        code: 'custom',
        path: ['SUPER_ADMIN_PASS'],
        message: 'must be at least 12 characters in production',
      });
    }
  })
  .safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${lines}`);
}

const e = parsed.data;

export const env = {
  ...e,
  isProd: e.NODE_ENV === 'production',
  isTest: e.NODE_ENV === 'test',
  corsOrigins: e.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  reservedSlugs: e.RESERVED_SLUGS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : e.NODE_ENV === 'production',
} as const;
