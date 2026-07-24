import Redis from 'ioredis';
import { buildRateLimitKey } from '../src/redis/keys';
import { FixedWindow } from '../src/limiter/algorithms/fixedWindow';
import { closeRedisClient } from '../src/redis/client';

const RUN_ID = `test-fw-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function testKey(label: string): string {
  return buildRateLimitKey('fixed-window', `${RUN_ID}-${label}`);
}

async function flushKeys(redis: Redis, pattern: string): Promise<void> {
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
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

describe('FixedWindow — within limit', () => {
  const LIMIT = 5;
  const limiter = new FixedWindow({ limit: LIMIT, windowSeconds: 60, ttlSeconds: 120 });

  it('allows LIMIT requests and decrements remaining correctly', async () => {
    const key = testKey('within-limit');
    for (let i = 0; i < LIMIT; i++) {
      const result = await limiter.consume(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1 - i);
    }
  });
});

describe('FixedWindow — exhaustion and reset', () => {
  const LIMIT = 2;
  const WINDOW = 2; // 2 seconds to avoid jitter at exact second boundaries
  const limiter = new FixedWindow({ limit: LIMIT, windowSeconds: WINDOW, ttlSeconds: 10 });

  it('rejects requests over limit and resets after window', async () => {
    const key = testKey('exhaustion');
    
    // Exhaust the window
    await limiter.consume(key);
    const lastAllowed = await limiter.consume(key);
    expect(lastAllowed.allowed).toBe(true);
    
    const rejected = await limiter.consume(key);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
    expect(rejected.retryAfterMs).toBeLessThanOrEqual(WINDOW * 1000);

    // Wait until the next window
    const now = Date.now();
    const timeToNextWindow = lastAllowed.resetAtMs - now;
    await sleep(timeToNextWindow + 50); // slight buffer
    
    const reset = await limiter.consume(key);
    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(LIMIT - 1);
  });
});

describe('FixedWindow — concurrency', () => {
  const LIMIT = 10;
  const limiter = new FixedWindow({ limit: LIMIT, windowSeconds: 60, ttlSeconds: 120 });

  it('parallel consume() calls never allow more than LIMIT requests', async () => {
    const key = testKey('concurrency');
    const results = await Promise.all(
      Array.from({ length: LIMIT * 2 }, () => limiter.consume(key)),
    );

    const allowed = results.filter((r) => r.allowed).length;
    const rejected = results.filter((r) => !r.allowed).length;

    expect(allowed).toBe(LIMIT);
    expect(rejected).toBe(LIMIT);
  });
});

describe('FixedWindow — TTL', () => {
  const limiter = new FixedWindow({ limit: 5, windowSeconds: 2, ttlSeconds: 10 });

  it('sets a TTL on the Redis key', async () => {
    const key = testKey('ttl');
    await limiter.consume(key);

    const windowStartMs = Math.floor(Date.now() / 2000) * 2000;
    const actualKey = `${key}:${windowStartMs}`;

    const ttl = await testRedis.ttl(actualKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10);
  });
});
