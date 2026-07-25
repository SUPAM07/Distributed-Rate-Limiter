import Redis from 'ioredis';
import { buildRateLimitKey } from '../src/redis/keys';
import { GCRA } from '../src/limiter/algorithms/gcra';
import { closeRedisClient } from '../src/redis/client';

const RUN_ID = `test-gcra-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function testKey(label: string): string {
  return buildRateLimitKey('gcra', `${RUN_ID}-${label}`);
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

describe('GCRA — burst capacity', () => {
  // 1 request every 100ms. Burst capacity 5.
  // Burst tolerance = 500ms
  const limiter = new GCRA({ emissionIntervalMs: 100, burstCapacity: 5, ttlSeconds: 10 });

  it('allows burst up to burstCapacity', async () => {
    const key = testKey('burst');
    for (let i = 0; i < 5; i++) {
      const result = await limiter.consume(key);
      expect(result.allowed).toBe(true);
    }
  });

  it('rejects requests over burst capacity', async () => {
    const key = testKey('exhaustion');
    for (let i = 0; i < 5; i++) {
      await limiter.consume(key);
    }
    
    const result = await limiter.consume(key);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    // Must wait for TAT to drop enough to fit another 100ms
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(105);
  });
});

describe('GCRA — steady state emission', () => {
  const limiter = new GCRA({ emissionIntervalMs: 200, burstCapacity: 1, ttlSeconds: 10 });

  it('recovers 1 capacity per interval', async () => {
    const key = testKey('emission');
    
    // consume 1 (burst=1)
    const r1 = await limiter.consume(key);
    expect(r1.allowed).toBe(true);
    
    // immediately consume another -> rejected
    const r2 = await limiter.consume(key);
    expect(r2.allowed).toBe(false);

    // wait for emission interval
    await sleep(210);
    
    const r3 = await limiter.consume(key);
    expect(r3.allowed).toBe(true);
  });
});
