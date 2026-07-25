import request from 'supertest';
import { app } from '../../src/app';
import { closeRedisClient } from '../../src/redis/client';

// ---------------------------------------------------------------------------
// End-to-end integration tests:
// HTTP request → Express middleware → Rate Limiter → Redis → HTTP response
// ---------------------------------------------------------------------------

afterAll(async () => {
  await closeRedisClient();
});

describe('Integration: GET /api/test', () => {
  it('returns X-RateLimit-* headers and proper JSON on every call', async () => {
    const res = await request(app).get('/api/test');

    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();

    const reset = Number(res.headers['x-ratelimit-reset']);
    expect(reset).toBeGreaterThan(0); // Unix seconds in the future
  });

  it('eventually returns 429 with RATE_LIMIT_EXCEEDED code', async () => {
    // Hit until exhausted or 30 requests, whichever comes first
    let hit429 = false;
    for (let i = 0; i < 30; i++) {
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

  it('GET /health returns 200 with dependencies.redis', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.dependencies?.redis).toBe('ok');
  });
});
