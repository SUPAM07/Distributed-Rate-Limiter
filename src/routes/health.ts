import { Router } from 'express';
import { getRedisClient } from '../redis/client';

const router = Router();

/**
 * GET /health
 *
 * Returns service status and confirms Redis connectivity.
 * Does not go through rate-limit middleware — it is exempt by design.
 */
router.get('/health', async (_req, res) => {
  let redisStatus: 'ok' | 'error' = 'ok';

  try {
    const pong = await getRedisClient().ping();
    if (pong !== 'PONG') {
      redisStatus = 'error';
    }
  } catch {
    redisStatus = 'error';
  }

  const status = redisStatus === 'ok' ? 'ok' : 'degraded';
  const httpStatus = redisStatus === 'ok' ? 200 : 503;

  res.status(httpStatus).json({
    status,
    ts: new Date().toISOString(),
    dependencies: {
      redis: redisStatus,
    },
  });
});

export default router;
