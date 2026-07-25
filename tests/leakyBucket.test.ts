import Redis from 'ioredis';
import { buildRateLimitKey } from '../src/redis/keys';
import { LeakyBucket } from '../src/limiter/algorithms/leakyBucket';
import { closeRedisClient } from '../src/redis/client';

const RUN_ID = `test-lb-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function testKey(label: string): string {
  return buildRateLimitKey('leaky-bucket', `${RUN_ID}-${label}`);
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

describe('LeakyBucket — basic capacity', () => {
  const CAPACITY = 5;
  const LEAK_RATE = 1; // 1 per sec
  const limiter = new LeakyBucket({ capacity: CAPACITY, leakRate: LEAK_RATE, ttlSeconds: 10 });

  it('allows CAPACITY requests immediately (burst)', async () => {
    const key = testKey('burst');
    for (let i = 0; i < CAPACITY; i++) {
      const result = await limiter.consume(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(CAPACITY - i - 1);
    }
  });

  it('rejects requests over capacity', async () => {
    const key = testKey('exhaustion');
    // fill bucket
    for (let i = 0; i < CAPACITY; i++) {
      await limiter.consume(key);
    }
    
    // next request should fail
    const result = await limiter.consume(key);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    // Should need ~1 second to leak 1 item
    expect(result.retryAfterMs).toBeLessThanOrEqual(1050);
  });
});

describe('LeakyBucket — leak timing', () => {
  const CAPACITY = 2;
  const LEAK_RATE = 2; // 2 per sec (1 every 500ms)
  const limiter = new LeakyBucket({ capacity: CAPACITY, leakRate: LEAK_RATE, ttlSeconds: 10 });

  it('recovers capacity over time', async () => {
    const key = testKey('leak');
    
    // consume 2
    await limiter.consume(key);
    await limiter.consume(key);
    
    // bucket is full
    const rejected = await limiter.consume(key);
    expect(rejected.allowed).toBe(false);

    // wait for 1 item to leak (500ms)
    await sleep(550);
    
    const allowed = await limiter.consume(key);
    expect(allowed.allowed).toBe(true);
    
    // should be full again
    const rejected2 = await limiter.consume(key);
    expect(rejected2.allowed).toBe(false);
  });
});
