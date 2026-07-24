import { config } from '../config/env';
import type { RateLimiter } from './types';
import { TokenBucket } from './algorithms/tokenBucket';
import { FixedWindow } from './algorithms/fixedWindow';
import { SlidingWindowLog } from './algorithms/slidingWindowLog';
import { SlidingWindowCounter } from './algorithms/slidingWindowCounter';

export function createRateLimiter(): RateLimiter {
  const algorithm = config.rateLimit.algorithm;

  switch (algorithm) {
    case 'token-bucket':
      return new TokenBucket({
        capacity: config.rateLimit.capacity,
        refillRate: config.rateLimit.refillRate,
        ttlSeconds: config.rateLimit.ttlSeconds,
      });

    case 'fixed-window':
      return new FixedWindow({
        limit: config.rateLimit.limit,
        windowSeconds: config.rateLimit.windowSeconds,
        // Provide enough TTL to outlive the window
        ttlSeconds: Math.max(config.rateLimit.ttlSeconds, config.rateLimit.windowSeconds * 2),
      });

    case 'sliding-window-log':
      return new SlidingWindowLog({
        limit: config.rateLimit.limit,
        windowSeconds: config.rateLimit.windowSeconds,
        ttlSeconds: Math.max(config.rateLimit.ttlSeconds, config.rateLimit.windowSeconds * 2),
      });

    case 'sliding-window-counter':
      return new SlidingWindowCounter({
        limit: config.rateLimit.limit,
        windowSeconds: config.rateLimit.windowSeconds,
        ttlSeconds: Math.max(config.rateLimit.ttlSeconds, config.rateLimit.windowSeconds * 2),
      });

    default:
      // This should be caught by config validation, but TypeScript requires a fallback or exhaustive check
      throw new Error(`Unknown rate limit algorithm: ${algorithm}`);
  }
}
