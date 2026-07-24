import type { Request, Response, NextFunction } from 'express';
import { TokenBucket } from '../limiter/algorithms/tokenBucket';
import { buildRateLimitKey } from '../redis/keys';
import { config } from '../config/env';

// ---------------------------------------------------------------------------
// Singleton limiter instance shared across all requests.
// ---------------------------------------------------------------------------

const limiter = new TokenBucket({
  capacity: config.rateLimit.capacity,
  refillRate: config.rateLimit.refillRate,
  ttlSeconds: config.rateLimit.ttlSeconds,
});

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
    const key = buildRateLimitKey(identifier);
    result = await limiter.consume(key);
  } catch (err: unknown) {
    // Architecture rule 8: infrastructure failures must be distinguishable from rate-limit rejection.
    const message = err instanceof Error ? err.message : 'Redis error';
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'rate_limit.redis_error',
        message,
        ts: new Date().toISOString(),
      }),
    );
    res.status(503).json({
      error: 'Service temporarily unavailable',
      code: 'RATE_LIMITER_UNAVAILABLE',
    });
    return;
  }

  // Set standard rate-limit headers on every response.
  res.setHeader('X-RateLimit-Limit', config.rateLimit.capacity);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader(
    'X-RateLimit-Reset',
    Math.ceil(result.resetAtMs / 1000), // Unix seconds
  );

  if (!result.allowed) {
    res.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000));
    res.status(429).json({
      error: 'Too Many Requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterMs: result.retryAfterMs,
    });
    return;
  }

  next();
}
