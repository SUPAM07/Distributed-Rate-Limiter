import Redis from 'ioredis';
import { buildRateLimitKey } from '../../src/redis/keys';
import { FixedWindow } from '../../src/limiter/algorithms/fixedWindow';
import { closeRedisClient } from '../../src/redis/client';

const RUN_ID = `test-fw-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function testKey(label: string): string {
  return buildRateLimitKey('fixed-window', `${RUN_ID}-${label}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

describe('FixedWindow', () => {
  it('allows exactly LIMIT requests and reports remaining correctly', async () => {
    const LIMIT = 5;
    const limiter = new FixedWindow({ limit: LIMIT, windowSeconds: 60, ttlSeconds: 120 });
    const key = testKey('within-limit');

    for (let i = 0; i < LIMIT; i++) {
      const result = await limiter.consume(key);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1 - i);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
      expect(result.remaining).toBeLessThanOrEqual(LIMIT);
      expect(result.resetAtMs).toBeGreaterThan(Date.now());
    }

    const rejected = await limiter.consume(key);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
  });

  it('uses the same reset boundary within one fixed window', async () => {
    const limiter = new FixedWindow({ limit: 5, windowSeconds: 60, ttlSeconds: 120 });
    const key = testKey('stable-reset');

    const first = await limiter.consume(key);
    const second = await limiter.consume(key);

    expect(first.resetAtMs).toBe(second.resetAtMs);
  });

  it('resets after the fixed window boundary', async () => {
    const LIMIT = 2;
    const WINDOW = 2;
    const limiter = new FixedWindow({ limit: LIMIT, windowSeconds: WINDOW, ttlSeconds: 10 });
    const key = testKey('reset');

    await limiter.consume(key);
    const lastAllowed = await limiter.consume(key);
    const rejected = await limiter.consume(key);

    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
    expect(rejected.retryAfterMs).toBeLessThanOrEqual(WINDOW * 1000);

    await sleep(Math.max(0, lastAllowed.resetAtMs - Date.now()) + 75);

    const reset = await limiter.consume(key);
    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(LIMIT - 1);
    expect(reset.resetAtMs).toBeGreaterThan(lastAllowed.resetAtMs);
  });

  it('parallel consume calls never admit more than LIMIT', async () => {
    const LIMIT = 10;
    const limiter = new FixedWindow({ limit: LIMIT, windowSeconds: 60, ttlSeconds: 120 });
    const key = testKey('concurrency');

    const results = await Promise.all(
      Array.from({ length: LIMIT * 2 }, () => limiter.consume(key)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(LIMIT);
    expect(results.filter((r) => !r.allowed)).toHaveLength(LIMIT);
  });

  it('sets TTL on the concrete Redis window key', async () => {
    const TTL = 10;
    const WINDOW_MS = 2000;
    const limiter = new FixedWindow({ limit: 5, windowSeconds: 2, ttlSeconds: TTL });
    const key = testKey('ttl');

    const before = Date.now();
    await limiter.consume(key);
    const after = Date.now();

    const possibleWindowStarts = new Set([
      Math.floor(before / WINDOW_MS) * WINDOW_MS,
      Math.floor(after / WINDOW_MS) * WINDOW_MS,
    ]);

    let ttl = -2;
    for (const start of possibleWindowStarts) {
      const candidate = await testRedis.ttl(`${key}:${start}`);
      if (candidate > 0) {
        ttl = candidate;
        break;
      }
    }

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TTL);
  });
});
