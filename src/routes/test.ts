import { Router } from 'express';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';

const router = Router();

/**
 * GET /api/test
 *
 * A simple rate-limited endpoint used to verify the full request pipeline:
 *   Request → Rate-Limit Middleware → Token Bucket → Redis/Lua → Allow or Reject
 *
 * Use this endpoint to verify bucket exhaustion and automatic token refill.
 */
router.get('/test', rateLimitMiddleware, (_req, res) => {
  res.status(200).json({
    message: 'Request accepted',
    ts: new Date().toISOString(),
  });
});

export default router;
