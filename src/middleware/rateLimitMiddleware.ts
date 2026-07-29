import type { Request, Response, NextFunction } from 'express';
import { createRateLimiter } from '../limiter/createRateLimiter';
import { buildRateLimitKey } from '../redis/keys';
import { config } from '../config/env';
import { logger } from '../shared/logger';
import { setRateLimitHeaders } from '../limiter/headers/rateLimitHeaders';

// ---------------------------------------------------------------------------
// Singleton limiter instance shared across all requests.
// ---------------------------------------------------------------------------

const limiter = createRateLimiter();

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------
// Separated from algorithm logic per architecture rules.
// Phase 1: use IP address. Extensible to API keys, user IDs, etc. in later phases.

function resolveIdentifier(req: Request): string {
  // req.ip can be undefined in rare edge cases; fall back to 'unknown'.
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  // Normalise IPv6 loopback so tests work consistently.
  return ip === '::1' ? '127.0.0.1' : ip;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let result;

  try {
    const identifier = resolveIdentifier(req);
    const key = buildRateLimitKey(config.rateLimit.algorithm, identifier);
    result = await limiter.consume(key);
  } catch (err: unknown) {
    // Architecture rule 8: infrastructure failures must be distinguishable from rate-limit rejection.
    const message = err instanceof Error ? err.message : 'Redis error';
    logger.error('rate_limit.redis_error', message);
    res.status(503).json({
      error: 'Service temporarily unavailable',
      code: 'RATE_LIMITER_UNAVAILABLE',
    });
    return;
  }

  const limit = config.rateLimit.algorithm === 'token-bucket' 
    ? config.rateLimit.capacity 
    : config.rateLimit.limit;
    
  setRateLimitHeaders(res, result, limit);

  if (!result.allowed) {
    res.status(429).json({
      error: 'Too Many Requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterMs: result.retryAfterMs,
    });
    return;
  }

  next();
}
