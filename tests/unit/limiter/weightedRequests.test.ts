import Redis from 'ioredis';
import { buildRateLimitKey } from '../../src/redis/keys';
import { TokenBucket } from '../../src/limiter/algorithms/tokenBucket';
import { FixedWindow } from '../../src/limiter/algorithms/fixedWindow';
import { SlidingWindowLog } from '../../src/limiter/algorithms/slidingWindowLog';
import { GCRA } from '../../src/limiter/algorithms/gcra';
import { closeRedisClient } from '../../src/redis/client';

const RUN_ID = `test-weights-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

describe('Weighted Requests', () => {
  it('TokenBucket handles weights correctly', async () => {
    const key = buildRateLimitKey('token-bucket', `${RUN_ID}-tb`);
    const limiter = new TokenBucket({ capacity: 10, refillRate: 1, ttlSeconds: 10 });
    
    // consume 5 tokens at once
    const r1 = await limiter.consume(key, 5);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(5);

    // consume 6 tokens -> fails, requires 6 but only 5 left
    const r2 = await limiter.consume(key, 6);
    expect(r2.allowed).toBe(false);
    expect(r2.remaining).toBe(5); // unchanged
  });

  it('FixedWindow handles weights correctly', async () => {
    const key = buildRateLimitKey('fixed-window', `${RUN_ID}-fw`);
    const limiter = new FixedWindow({ limit: 10, windowSeconds: 60, ttlSeconds: 120 });
    
    const r1 = await limiter.consume(key, 5);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(5);

    const r2 = await limiter.consume(key, 6);
    expect(r2.allowed).toBe(false);
    expect(r2.remaining).toBe(5);
  });

  it('SlidingWindowLog handles weights correctly', async () => {
    const key = buildRateLimitKey('sliding-window-log', `${RUN_ID}-swl`);
    const limiter = new SlidingWindowLog({ limit: 10, windowSeconds: 60, ttlSeconds: 120 });
    
    const r1 = await limiter.consume(key, 5);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(5);

    const r2 = await limiter.consume(key, 6);
    expect(r2.allowed).toBe(false);
    expect(r2.remaining).toBe(5);
  });

  it('GCRA handles weights correctly', async () => {
    const key = buildRateLimitKey('gcra', `${RUN_ID}-gcra`);
    // emission=100ms, capacity=10 -> tolerance=1000ms
    const limiter = new GCRA({ emissionIntervalMs: 100, burstCapacity: 10, ttlSeconds: 10 });
    
    // consume weight 5 -> adds 500ms to TAT
    const r1 = await limiter.consume(key, 5);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(5);

    // consume weight 6 -> requires 600ms, but only 500ms tolerance left -> fails
    const r2 = await limiter.consume(key, 6);
    expect(r2.allowed).toBe(false);
    // TAT is unmodified, remaining is still 5
    expect(r2.remaining).toBe(5);
  });
});
