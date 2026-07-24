import 'dotenv/config';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (val === undefined || val === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optionalEnv(key: string, defaultVal: string): string {
  return process.env[key] ?? defaultVal;
}

function parsePositiveInt(key: string, raw: string): number {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer, got: "${raw}"`);
  }
  return n;
}

export const config = {
  port: parsePositiveInt('PORT', optionalEnv('PORT', '3000')),

  redis: {
    host: optionalEnv('REDIS_HOST', 'localhost'),
    port: parsePositiveInt('REDIS_PORT', optionalEnv('REDIS_PORT', '6379')),
    password: process.env['REDIS_PASSWORD'] || undefined,
  },

  rateLimit: {
    /**
     * Maximum number of tokens in the bucket (= max burst capacity).
     */
    capacity: parsePositiveInt(
      'RATE_LIMIT_CAPACITY',
      optionalEnv('RATE_LIMIT_CAPACITY', '10'),
    ),
    /**
     * Tokens refilled per second.
     */
    refillRate: parsePositiveInt(
      'RATE_LIMIT_REFILL_RATE',
      optionalEnv('RATE_LIMIT_REFILL_RATE', '1'),
    ),
    /**
     * Redis key TTL in seconds. Inactive keys expire after this duration.
     */
    ttlSeconds: parsePositiveInt(
      'RATE_LIMIT_TTL_SECONDS',
      optionalEnv('RATE_LIMIT_TTL_SECONDS', '3600'),
    ),
  },
} as const;
