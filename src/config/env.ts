import 'dotenv/config';



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

export type AlgorithmType = 'token-bucket' | 'fixed-window' | 'sliding-window-log' | 'sliding-window-counter' | 'leaky-bucket' | 'gcra';

function parseAlgorithm(key: string, raw: string): AlgorithmType {
  const allowed = ['token-bucket', 'fixed-window', 'sliding-window-log', 'sliding-window-counter', 'leaky-bucket', 'gcra'];
  if (!allowed.includes(raw)) {
    throw new Error(`Environment variable ${key} must be one of: ${allowed.join(', ')}, got: "${raw}"`);
  }
  return raw as AlgorithmType;
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
     * Rate limiting algorithm to use.
     */
    algorithm: parseAlgorithm(
      'RATE_LIMIT_ALGORITHM',
      optionalEnv('RATE_LIMIT_ALGORITHM', 'token-bucket'),
    ),
    /**
     * Window duration in seconds (for fixed-window, sliding-window-log, sliding-window-counter).
     */
    windowSeconds: parsePositiveInt(
      'RATE_LIMIT_WINDOW_SECONDS',
      optionalEnv('RATE_LIMIT_WINDOW_SECONDS', '60'),
    ),
    /**
     * Maximum number of requests per window (for fixed-window, sliding-window-log, sliding-window-counter).
     */
    limit: parsePositiveInt(
      'RATE_LIMIT_LIMIT',
      optionalEnv('RATE_LIMIT_LIMIT', '10'),
    ),
    /**
     * Maximum number of tokens in the bucket (= max burst capacity).
     */
    capacity: parsePositiveInt(
      'RATE_LIMIT_CAPACITY',
      optionalEnv('RATE_LIMIT_CAPACITY', '10'),
    ),
    /**
     * Number of tokens refilled per second.
     */
    refillRate: parsePositiveInt(
      'RATE_LIMIT_REFILL_RATE',
      optionalEnv('RATE_LIMIT_REFILL_RATE', '1'),
    ),
    /**
     * TTL for the Redis key.
     */
    ttlSeconds: parsePositiveInt(
      'RATE_LIMIT_TTL_SECONDS',
      optionalEnv('RATE_LIMIT_TTL_SECONDS', '3600'),
    ),

    leakyBucket: {
      capacity: parsePositiveInt(
        'LEAKY_BUCKET_CAPACITY',
        optionalEnv('LEAKY_BUCKET_CAPACITY', '10'),
      ),
      leakRate: parsePositiveInt(
        'LEAKY_BUCKET_LEAK_RATE',
        optionalEnv('LEAKY_BUCKET_LEAK_RATE', '1'),
      ),
    },

    gcra: {
      emissionIntervalMs: parsePositiveInt(
        'GCRA_EMISSION_INTERVAL',
        optionalEnv('GCRA_EMISSION_INTERVAL', '100'), // 100ms per request (10 req/s)
      ),
      burstCapacity: parsePositiveInt(
        'GCRA_BURST_CAPACITY',
        optionalEnv('GCRA_BURST_CAPACITY', '10'),
      ),
    },
  },
} as const;
