import Redis from 'ioredis';
import { buildRateLimitKey } from '../../src/redis/keys';
import { TokenBucket } from '../../src/limiter/algorithms/tokenBucket';
import { FixedWindow } from '../../src/limiter/algorithms/fixedWindow';
import { SlidingWindowLog } from '../../src/limiter/algorithms/slidingWindowLog';
import { closeRedisClient } from '../../src/redis/client';

const RUN_ID = `boundary-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Boundary: Token Bucket
// ---------------------------------------------------------------------------
describe('Boundary — TokenBucket', () => {
  const CAPACITY = 5;
  const limiter = new TokenBucket({ capacity: CAPACITY, refillRate: 5, ttlSeconds: 60 });

  it('first request is always allowed', async () => {
    const key = buildRateLimitKey('token-bucket', `${RUN_ID}-first`);
    const r = await limiter.consume(key);
    expect(r.allowed).toBe(true);
  });

  it('last allowed request (request #CAPACITY) is allowed', async () => {
    const key = buildRateLimitKey('token-bucket', `${RUN_ID}-last-allowed`);
    let last;
    for (let i = 0; i < CAPACITY; i++) {
      last = await limiter.consume(key);
    }
    expect(last!.allowed).toBe(true);
    expect(last!.remaining).toBe(0);
  });

  it('first rejected request (request #CAPACITY+1) is rejected', async () => {
    const key = buildRateLimitKey('token-bucket', `${RUN_ID}-first-rejected`);
    for (let i = 0; i < CAPACITY; i++) {
      await limiter.consume(key);
    }
    const r = await limiter.consume(key);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('bucket exactly empty: remaining is 0 when all tokens consumed', async () => {
    const key = buildRateLimitKey('token-bucket', `${RUN_ID}-exactly-empty`);
    for (let i = 0; i < CAPACITY; i++) {
      await limiter.consume(key);
    }
    const r = await limiter.consume(key);
    expect(r.remaining).toBe(0);
  });

  it('reports max remaining on fresh bucket', async () => {
    const key = buildRateLimitKey('token-bucket', `${RUN_ID}-fresh`);
    const r = await limiter.consume(key);
    expect(r.remaining).toBe(CAPACITY - 1);
  });
});

// ---------------------------------------------------------------------------
// Boundary: FixedWindow
// ---------------------------------------------------------------------------
describe('Boundary — FixedWindow', () => {
  const LIMIT = 3;
  const limiter = new FixedWindow({ limit: LIMIT, windowSeconds: 1, ttlSeconds: 5 });

  it('allows exactly LIMIT requests in a window', async () => {
    const key = buildRateLimitKey('fixed-window', `${RUN_ID}-fw-exact`);
    const results = [];
    for (let i = 0; i < LIMIT; i++) {
      results.push(await limiter.consume(key));
    }
    expect(results.every((r) => r.allowed)).toBe(true);

    // Next one should be rejected
    const rejected = await limiter.consume(key);
    expect(rejected.allowed).toBe(false);
  });

  it('window transition restores capacity', async () => {
    const key = buildRateLimitKey('fixed-window', `${RUN_ID}-fw-transition`);
    // Exhaust window
    for (let i = 0; i < LIMIT; i++) {
      await limiter.consume(key);
    }
    const r1 = await limiter.consume(key);
    expect(r1.allowed).toBe(false);

    // Wait for window to reset (1 second window)
    await sleep(1100);

    const r2 = await limiter.consume(key);
    expect(r2.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Boundary: SlidingWindowLog
// ---------------------------------------------------------------------------
describe('Boundary — SlidingWindowLog', () => {
  const LIMIT = 3;
  const limiter = new SlidingWindowLog({ limit: LIMIT, windowSeconds: 1, ttlSeconds: 5 });

  it('allows first request', async () => {
    const key = buildRateLimitKey('sliding-window-log', `${RUN_ID}-swl-first`);
    const r = await limiter.consume(key);
    expect(r.allowed).toBe(true);
  });

  it('rejects at LIMIT+1', async () => {
    const key = buildRateLimitKey('sliding-window-log', `${RUN_ID}-swl-limit`);
    for (let i = 0; i < LIMIT; i++) {
      await limiter.consume(key);
    }
    const r = await limiter.consume(key);
    expect(r.allowed).toBe(false);
  });
});
