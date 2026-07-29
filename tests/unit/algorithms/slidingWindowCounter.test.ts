import Redis from 'ioredis';
import { buildRateLimitKey } from '../../src/redis/keys';
import { SlidingWindowCounter } from '../../src/limiter/algorithms/slidingWindowCounter';
import { closeRedisClient } from '../../src/redis/client';

const RUN_ID = `test-swc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function testKey(label: string): string {
  return buildRateLimitKey('sliding-window-counter', `${RUN_ID}-${label}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWindowOffset(windowMs: number, targetOffsetMs: number): Promise<void> {
  while (true) {
    const offset = Date.now() % windowMs;
    if (offset >= targetOffsetMs && offset < targetOffsetMs + 100) return;
    await sleep(20);
  }
}

let testRedis: Redis;

beforeAll(() => {
  testRedis = new Redis({
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
    password: process.env['REDIS_PASSWORD'] || undefined,
    maxRetriesPerRequest: 3,
  });
});

afterAll(async () => {
  await testRedis.quit();
  await closeRedisClient();
});

describe('SlidingWindowCounter', () => {
  it('allows LIMIT requests and rejects the next request', async () => {
    const LIMIT = 5;
    const limiter = new SlidingWindowCounter({ limit: LIMIT, windowSeconds: 60, ttlSeconds: 120 });
    const key = testKey('within-limit');

    for (let i = 0; i < LIMIT; i++) {
      const result = await limiter.consume(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
      expect(result.remaining).toBeLessThanOrEqual(LIMIT - 1);
      expect(result.resetAtMs).toBeGreaterThan(Date.now());
    }

    const rejected = await limiter.consume(key);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
  });

  it('carries previous-window traffic into the next window with decaying weight', async () => {
    const LIMIT = 5;
    const WINDOW_SECONDS = 4;
    const WINDOW_MS = WINDOW_SECONDS * 1000;
    const limiter = new SlidingWindowCounter({
      limit: LIMIT,
      windowSeconds: WINDOW_SECONDS,
      ttlSeconds: 20,
    });
    const key = testKey('weighted-boundary');

    // Put five requests late in one window so they should still have high weight
    // immediately after the next boundary.
    await waitForWindowOffset(WINDOW_MS, 3000);

    for (let i = 0; i < LIMIT; i++) {
      const result = await limiter.consume(key);
      expect(result.allowed).toBe(true);
    }

    const currentOffset = Date.now() % WINDOW_MS;
    await sleep(WINDOW_MS - currentOffset + 250);

    const firstInNextWindow = await limiter.consume(key);

    // A fixed-window implementation would reset to remaining=4 here.
    // A sliding counter must retain substantial previous-window usage.
    expect(firstInNextWindow.remaining).toBeLessThan(LIMIT - 1);

    // It must reach rejection before another full LIMIT requests can be admitted.
    const followUps = await Promise.all(
      Array.from({ length: LIMIT }, () => limiter.consume(key)),
    );
    expect(followUps.some((r) => !r.allowed)).toBe(true);
  }, 10_000);

  it('parallel consume calls never admit more than LIMIT', async () => {
    const LIMIT = 20;
    const limiter = new SlidingWindowCounter({ limit: LIMIT, windowSeconds: 60, ttlSeconds: 120 });
    const key = testKey('concurrency');

    const results = await Promise.all(
      Array.from({ length: LIMIT * 2 }, () => limiter.consume(key)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(LIMIT);
    expect(results.filter((r) => !r.allowed)).toHaveLength(LIMIT);
  });

  it('stores counter state in Redis with TTL', async () => {
    const TTL = 10;
    const limiter = new SlidingWindowCounter({ limit: 5, windowSeconds: 2, ttlSeconds: TTL });
    const key = testKey('redis-state');

    await limiter.consume(key);

    expect(await testRedis.exists(key)).toBe(1);

    const ttl = await testRedis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TTL);
  });
});
