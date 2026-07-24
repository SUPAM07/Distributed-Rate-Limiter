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
  });
});

afterAll(async () => {
  await testRedis.quit();
  await closeRedisClient();
});

describe('SlidingWindowLog — within limit', () => {
  const LIMIT = 3;
  const limiter = new SlidingWindowLog({ limit: LIMIT, windowSeconds: 60, ttlSeconds: 120 });

  it('allows LIMIT requests', async () => {
    const key = testKey('within-limit');
    for (let i = 0; i < LIMIT; i++) {
      const result = await limiter.consume(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1 - i);
    }
  });
});

describe('SlidingWindowLog — sliding expiration', () => {
  const LIMIT = 2;
  const WINDOW = 2;
  const limiter = new SlidingWindowLog({ limit: LIMIT, windowSeconds: WINDOW, ttlSeconds: 10 });

  it('rejects over limit and recovers space progressively', async () => {
    const key = testKey('expiration');
    
    // First request
    await limiter.consume(key);
    await sleep(1000); // Wait 1 second
    
    // Second request
    await limiter.consume(key);
    
    // Third request (should be rejected since limit=2 and window=2s)
    const rejected = await limiter.consume(key);
    expect(rejected.allowed).toBe(false);
    
    // Wait until the first request falls out of the 2-second window
    // It has been ~1000ms since the first request. Wait another 1100ms to be safe.
    await sleep(1100);
    
    // Should now allow exactly 1 request (the space from the first request freed)
    const recovered = await limiter.consume(key);
    expect(recovered.allowed).toBe(true);
    
    const rejectedAgain = await limiter.consume(key);
    expect(rejectedAgain.allowed).toBe(false);
  });
});

describe('SlidingWindowLog — concurrency', () => {
  const LIMIT = 10;
  const limiter = new SlidingWindowLog({ limit: LIMIT, windowSeconds: 60, ttlSeconds: 120 });

  it('parallel consume calls are atomic and safe', async () => {
    const key = testKey('concurrency');
    const results = await Promise.all(
      Array.from({ length: LIMIT * 2 }, () => limiter.consume(key)),
    );

    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(LIMIT);
  });
});
