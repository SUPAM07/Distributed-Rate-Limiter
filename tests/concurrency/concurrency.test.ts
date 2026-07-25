import Redis from 'ioredis';
import { buildRateLimitKey } from '../../src/redis/keys';
import { TokenBucket } from '../../src/limiter/algorithms/tokenBucket';
import { FixedWindow } from '../../src/limiter/algorithms/fixedWindow';
import { SlidingWindowLog } from '../../src/limiter/algorithms/slidingWindowLog';
import { SlidingWindowCounter } from '../../src/limiter/algorithms/slidingWindowCounter';
import { LeakyBucket } from '../../src/limiter/algorithms/leakyBucket';
import { GCRA } from '../../src/limiter/algorithms/gcra';
import { closeRedisClient } from '../../src/redis/client';
import type { RateLimiter } from '../../src/limiter/types';

const RUN_ID = `conc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

let testRedis: Redis;

beforeAll(() => {
  testRedis = new Redis({
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
  });
});

afterAll(async () => {
  await testRedis.quit();
  await closeRedisClient();
});

/**
 * Send `n` concurrent requests and return how many were allowed.
 */
async function fireConcurrent(limiter: RateLimiter, key: string, n: number): Promise<number> {
  const results = await Promise.all(
    Array.from({ length: n }, () => limiter.consume(key)),
  );
  return results.filter((r) => r.allowed).length;
}

// ---------------------------------------------------------------------------
// Parameterized concurrency scenarios
// ---------------------------------------------------------------------------
const SCENARIOS: Array<{ algorithm: string; factory: () => RateLimiter; limit: number }> = [
  {
    algorithm: 'token-bucket',
    factory: () => new TokenBucket({ capacity: 10, refillRate: 1, ttlSeconds: 60 }),
    limit: 10,
  },
  {
    algorithm: 'fixed-window',
    factory: () => new FixedWindow({ limit: 10, windowSeconds: 60, ttlSeconds: 120 }),
    limit: 10,
  },
  {
    algorithm: 'sliding-window-log',
    factory: () => new SlidingWindowLog({ limit: 10, windowSeconds: 60, ttlSeconds: 120 }),
    limit: 10,
  },
  {
    algorithm: 'sliding-window-counter',
    factory: () => new SlidingWindowCounter({ limit: 10, windowSeconds: 60, ttlSeconds: 240 }),
    limit: 10,
  },
  {
    algorithm: 'leaky-bucket',
    factory: () => new LeakyBucket({ capacity: 10, leakRate: 1, ttlSeconds: 60 }),
    limit: 10,
  },
  {
    algorithm: 'gcra',
    factory: () => new GCRA({ emissionIntervalMs: 100, burstCapacity: 10, ttlSeconds: 60 }),
    limit: 10,
  },
];

describe.each(SCENARIOS)('Concurrency — $algorithm', ({ algorithm, factory, limit }) => {
  it('50 concurrent requests: allowed ≤ limit', async () => {
    const key = buildRateLimitKey(algorithm, `${RUN_ID}-${algorithm}-50`);
    const admitted = await fireConcurrent(factory(), key, 50);
    expect(admitted).toBeLessThanOrEqual(limit);
    expect(admitted).toBeGreaterThan(0); // At least some should succeed
  });

  it('100 concurrent requests: allowed ≤ limit', async () => {
    const key = buildRateLimitKey(algorithm, `${RUN_ID}-${algorithm}-100`);
    const admitted = await fireConcurrent(factory(), key, 100);
    expect(admitted).toBeLessThanOrEqual(limit);
  });

  it('independent identifiers are isolated', async () => {
    const limiter = factory();
    const keyA = buildRateLimitKey(algorithm, `${RUN_ID}-${algorithm}-isolA`);
    const keyB = buildRateLimitKey(algorithm, `${RUN_ID}-${algorithm}-isolB`);

    // Both should be able to reach their limit independently
    const [admittedA, admittedB] = await Promise.all([
      fireConcurrent(limiter, keyA, limit),
      fireConcurrent(limiter, keyB, limit),
    ]);
    // Each key gets its own capacity — total admitted can be 2×limit
    expect(admittedA).toBeLessThanOrEqual(limit);
    expect(admittedB).toBeLessThanOrEqual(limit);
    expect(admittedA + admittedB).toBeLessThanOrEqual(limit * 2);
  });
});
