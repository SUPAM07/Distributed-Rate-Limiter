/**
 * Phase 1 Tests — Token Bucket Rate Limiter
 *
 * Coverage:
 *  1. Requests within the limit are allowed
 *  2. Bucket exhaustion → 429
 *  3. Correct remaining count after each request
 *  4. Boundary: exactly at capacity, exactly over capacity
 *  5. Token refill over time
 *  6. Concurrent requests cannot bypass the configured limit
 *  7. Atomic behaviour: parallel consume() calls never over-consume
 *
 * Requires a real Redis instance. Set REDIS_HOST / REDIS_PORT in the
 * environment or rely on the defaults (localhost:6379).
 *
 * The test suite uses a unique key prefix per run to avoid cross-test
 * pollution when run against a shared Redis.
 */

import supertest from 'supertest';
import Redis from 'ioredis';
import app from '../src/app';
import { buildRateLimitKey } from '../src/redis/keys';
import { TokenBucket } from '../src/limiter/algorithms/tokenBucket';
import { closeRedisClient } from '../src/redis/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unique suffix for this test run so parallel Jest workers don't collide. */
const RUN_ID = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function testKey(label: string): string {
  return buildRateLimitKey('token-bucket', `${RUN_ID}-${label}`);
}

/** Flush a specific Redis key before use. */
async function flushKey(redis: Redis, key: string): Promise<void> {
  await redis.del(key);
}

/** Sleep for ms milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test Redis client (separate from the app client so we can flush keys cleanly)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// HTTP layer tests (via supertest)
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await supertest(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dependencies.redis).toBe('ok');
  });
});

describe('GET /api/test — HTTP layer', () => {
  it('returns 200 with rate-limit headers when within limit', async () => {
    const res = await supertest(app).get('/api/test');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Unit tests on TokenBucket directly
// ---------------------------------------------------------------------------

describe('TokenBucket — within limit', () => {
  const CAPACITY = 5;
  const bucket = new TokenBucket({ capacity: CAPACITY, refillRate: 1, ttlSeconds: 60 });

  beforeEach(async () => {
    await flushKey(testRedis, testKey('within-limit'));
  });

  it('allows CAPACITY requests and decrements remaining correctly', async () => {
    const key = testKey('within-limit');

    for (let i = 0; i < CAPACITY; i++) {
      const result = await bucket.consume(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(CAPACITY - 1 - i);
    }
  });
});

describe('TokenBucket — exhaustion and 429', () => {
  const CAPACITY = 3;
  const bucket = new TokenBucket({ capacity: CAPACITY, refillRate: 1, ttlSeconds: 60 });

  beforeEach(async () => {
    await flushKey(testRedis, testKey('exhaustion'));
  });

  it('rejects the (CAPACITY+1)th request', async () => {
    const key = testKey('exhaustion');

    for (let i = 0; i < CAPACITY; i++) {
      const r = await bucket.consume(key);
      expect(r.allowed).toBe(true);
    }

    const rejected = await bucket.consume(key);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
  });

  it('returns 429 from /api/test after exhaustion via HTTP', async () => {
    // Exhaust the global bucket via direct HTTP calls.
    // We cannot easily target a specific key here so we use separate supertest
    // calls and tolerate an already-full bucket by just checking that at some
    // point we do receive a 429.
    const responses: number[] = [];

    for (let i = 0; i < 20; i++) {
      const res = await supertest(app).get('/api/test');
      responses.push(res.status);
    }

    expect(responses).toContain(429);
  });
});

describe('TokenBucket — boundary conditions', () => {
  const CAPACITY = 1;
  const bucket = new TokenBucket({ capacity: CAPACITY, refillRate: 1, ttlSeconds: 60 });

  beforeEach(async () => {
    await flushKey(testRedis, testKey('boundary'));
  });

  it('capacity=1: first request allowed, second rejected', async () => {
    const key = testKey('boundary');

    const first = await bucket.consume(key);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(0);

    const second = await bucket.consume(key);
    expect(second.allowed).toBe(false);
  });
});

describe('TokenBucket — token refill over time', () => {
  // refillRate = 5 tokens/sec so after 300ms we should get ~1.5 tokens back.
  const CAPACITY = 2;
  const REFILL_RATE = 5; // tokens per second
  const bucket = new TokenBucket({ capacity: CAPACITY, refillRate: REFILL_RATE, ttlSeconds: 60 });

  beforeEach(async () => {
    await flushKey(testRedis, testKey('refill'));
  });

  it('allows a request after tokens have been refilled', async () => {
    const key = testKey('refill');

    // Exhaust the bucket.
    for (let i = 0; i < CAPACITY; i++) {
      await bucket.consume(key);
    }

    // Confirm rejection.
    const rejected = await bucket.consume(key);
    expect(rejected.allowed).toBe(false);

    // Wait long enough for at least 1 token to refill.
    // 1 token at 5/s = 200ms; wait 400ms to be safe.
    await sleep(400);

    const refilled = await bucket.consume(key);
    expect(refilled.allowed).toBe(true);
  });
});

describe('TokenBucket — atomic behaviour under concurrency', () => {
  const CAPACITY = 5;
  const bucket = new TokenBucket({ capacity: CAPACITY, refillRate: 1, ttlSeconds: 60 });

  beforeEach(async () => {
    await flushKey(testRedis, testKey('concurrency'));
  });

  it('parallel consume() calls never allow more than CAPACITY requests', async () => {
    const key = testKey('concurrency');

    // Fire 2× CAPACITY requests simultaneously.
    const results = await Promise.all(
      Array.from({ length: CAPACITY * 2 }, () => bucket.consume(key)),
    );

    const allowed = results.filter((r) => r.allowed).length;
    const rejected = results.filter((r) => !r.allowed).length;

    // Exactly CAPACITY should be allowed — Lua atomicity prevents over-consumption.
    expect(allowed).toBe(CAPACITY);
    expect(rejected).toBe(CAPACITY);
  });

  it('allowed counts reported are monotonically non-increasing remaining', async () => {
    const key = testKey('concurrency-monotonic');
    await flushKey(testRedis, key);

    // Sequential consume calls should produce strictly decreasing remaining.
    const remainings: number[] = [];
    for (let i = 0; i < CAPACITY; i++) {
      const r = await bucket.consume(key);
      expect(r.allowed).toBe(true);
      remainings.push(r.remaining);
    }

    for (let i = 1; i < remainings.length; i++) {
      expect(remainings[i]).toBeLessThan(remainings[i - 1]!);
    }
  });
});

describe('TokenBucket — Redis key TTL', () => {
  it('sets a TTL on the Redis key', async () => {
    const TTL = 10;
    const bucket = new TokenBucket({ capacity: 5, refillRate: 1, ttlSeconds: TTL });
    const key = testKey('ttl');
    await flushKey(testRedis, key);

    await bucket.consume(key);

    const ttl = await testRedis.ttl(key);
    // TTL should be set and positive (between 1 and TTL seconds).
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TTL);
  });
});
