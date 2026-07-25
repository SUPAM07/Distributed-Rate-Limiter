import request from 'supertest';
import { app } from '../../src/app';
import { closeRedisClient } from '../../src/redis/client';

// ---------------------------------------------------------------------------
// Middleware unit tests
// These tests exercise the full HTTP → middleware → limiter path via supertest.
// NOTE: The middleware singleton is shared across tests, so we cannot test
// "first request" isolation here — we only test the observable HTTP contract.
// ---------------------------------------------------------------------------

afterAll(async () => {
  await closeRedisClient();
});

describe('rateLimitMiddleware', () => {
  it('returns X-RateLimit-* headers on every response', async () => {
    // Hit the endpoint; may be 200 or 429 depending on prior test state.
    // We only assert on header presence, not status, to keep this idempotent.
    const res = await request(app).get('/api/test');
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('returns Retry-After header on 429 responses', async () => {
    // Drain until 429 (or verify 429 is already active)
    let hit429 = false;
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get('/api/test');
      if (res.status === 429) {
        expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(res.headers['retry-after']).toBeDefined();
        hit429 = true;
        break;
      }
    }
    expect(hit429).toBe(true);
  });

  it('GET /health returns 200 with dependencies.redis property', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.dependencies?.redis).toBeDefined();
  });
});
