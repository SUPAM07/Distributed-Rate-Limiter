import Redis from 'ioredis';
import { buildRateLimitKey } from '../src/redis/keys';
import { SlidingWindowLog } from '../src/limiter/algorithms/slidingWindowLog';
import { closeRedisClient } from '../src/redis/client';

const RUN_ID = `test-swl-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function testKey(label: string): string {
  return buildRateLimitKey('sliding-window-log', `${RUN_ID}-${label}`);
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

describe('SlidingWindowLog', () => {
  it('allows exactly LIMIT active requests and reports remaining correctly', async () => {
    const LIMIT = 3;
    const limiter = new SlidingWindowLog({ limit: LIMIT, windowSeconds: 60, ttlSeconds: 120 });
    const key = testKey('within-limit');

    for (let i = 0; i < LIMIT; i++) {
      const result = await limiter.consume(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1 - i);
      expect(result.resetAtMs).toBeGreaterThan(Date.now());
    }

    const rejected = await limiter.consume(key);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
    expect(rejected.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('expires requests individually instead of resetting the whole window', async () => {
    const LIMIT = 2;
    const WINDOW = 2;
    const limiter = new SlidingWindowLog({ limit: LIMIT, windowSeconds: WINDOW, ttlSeconds: 10 });
    const key = testKey('progressive-expiration');

    const first = await limiter.consume(key);
    expect(first.allowed).toBe(true);

    await sleep(1000);

    const second = await limiter.consume(key);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);

    const rejected = await limiter.consume(key);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);

    await sleep(1150);

    const recovered = await limiter.consume(key);
    expect(recovered.allowed).toBe(true);
    expect(recovered.remaining).toBe(0);

    const rejectedAgain = await limiter.consume(key);
    expect(rejectedAgain.allowed).toBe(false);
  });

  it('parallel consume calls are atomic', async () => {
    const LIMIT = 10;
    const limiter = new SlidingWindowLog({ limit: LIMIT, windowSeconds: 60, ttlSeconds: 120 });
    const key = testKey('concurrency');

    const results = await Promise.all(
      Array.from({ length: LIMIT * 2 }, () => limiter.consume(key)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(LIMIT);
    expect(results.filter((r) => !r.allowed)).toHaveLength(LIMIT);
  });

  it('stores request state as a Redis sorted set with TTL', async () => {
    const TTL = 10;
    const limiter = new SlidingWindowLog({ limit: 3, windowSeconds: 2, ttlSeconds: TTL });
    const key = testKey('redis-state');

    await limiter.consume(key);

    expect(await testRedis.type(key)).toBe('zset');
    expect(await testRedis.zcard(key)).toBe(1);

    const ttl = await testRedis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TTL);
  });
});
