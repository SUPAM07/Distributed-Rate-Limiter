import supertest from 'supertest';
import Redis from 'ioredis';
import app from '../../src/app';
import { buildRateLimitKey } from '../../src/redis/keys';
import { TokenBucket } from '../../src/limiter/algorithms/tokenBucket';
import { closeRedisClient } from '../../src/redis/client';

const RUN_ID = `test-tb-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function testKey(label: string): string {
  return buildRateLimitKey('token-bucket', `${RUN_ID}-${label}`);
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

describe('HTTP smoke tests', () => {
  it('GET /health returns healthy Redis status', async () => {
    const res = await supertest(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dependencies.redis).toBe('ok');
  });

  it('GET /api/test returns standard rate-limit headers', async () => {
    const res = await supertest(app).get('/api/test');

    expect([200, 429]).toContain(res.status);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });
});

describe('TokenBucket', () => {
  it('allows exactly CAPACITY requests and decrements remaining', async () => {
    const CAPACITY = 5;
    const bucket = new TokenBucket({ capacity: CAPACITY, refillRate: 1, ttlSeconds: 60 });
    const key = testKey('within-limit');

    for (let i = 0; i < CAPACITY; i++) {
      const result = await bucket.consume(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(CAPACITY - 1 - i);
      expect(result.resetAtMs).toBeGreaterThan(Date.now());
    }

    const rejected = await bucket.consume(key);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
  });

  it('capacity=1 allows first request and rejects second', async () => {
    const bucket = new TokenBucket({ capacity: 1, refillRate: 1, ttlSeconds: 60 });
    const key = testKey('boundary');

    const first = await bucket.consume(key);
    const second = await bucket.consume(key);

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(0);
    expect(second.allowed).toBe(false);
    expect(second.remaining).toBe(0);
  });

  it('refills tokens over time', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 5, ttlSeconds: 60 });
    const key = testKey('refill');

    await bucket.consume(key);
    await bucket.consume(key);
    expect((await bucket.consume(key)).allowed).toBe(false);

    await sleep(400);

    expect((await bucket.consume(key)).allowed).toBe(true);
  });

  it('parallel consume calls never admit more than capacity', async () => {
    const CAPACITY = 5;
    const bucket = new TokenBucket({ capacity: CAPACITY, refillRate: 1, ttlSeconds: 60 });
    const key = testKey('concurrency');

    const results = await Promise.all(
      Array.from({ length: CAPACITY * 2 }, () => bucket.consume(key)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(CAPACITY);
    expect(results.filter((r) => !r.allowed)).toHaveLength(CAPACITY);
  });

  it('sets TTL on its Redis key', async () => {
    const TTL = 10;
    const bucket = new TokenBucket({ capacity: 5, refillRate: 1, ttlSeconds: TTL });
    const key = testKey('ttl');

    await bucket.consume(key);

    const ttl = await testRedis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TTL);
  });
});
