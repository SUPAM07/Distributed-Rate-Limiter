import type { RateLimiter, RateLimiterResult } from './types';

/**
 * HierarchicalRateLimiter
 * 
 * Supports nested rate limits (e.g., Organization -> Team -> User).
 * Takes an array of keys corresponding to each level in the hierarchy.
 * Parent limits (first in array) are evaluated before child limits.
 */
export class HierarchicalRateLimiter implements RateLimiter {
  private readonly limiters: RateLimiter[];

  constructor(limiters: RateLimiter[]) {
    if (!limiters || limiters.length === 0) {
      throw new Error('HierarchicalRateLimiter requires at least one rate limiter');
    }
    this.limiters = limiters;
  }

  async consume(keys: string | string[], weight = 1): Promise<RateLimiterResult> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    
    if (keyArray.length !== this.limiters.length) {
      throw new Error(`HierarchicalRateLimiter expected ${this.limiters.length} keys, but got ${keyArray.length}`);
    }

    let minRemaining = Infinity;
    let maxResetAtMs = 0;

    for (let i = 0; i < this.limiters.length; i++) {
      const limiter = this.limiters[i];
      const levelKey = keyArray[i];
      
      const result = await limiter.consume(levelKey, weight);

      if (!result.allowed) {
        // Stop evaluation immediately if a parent fails
        return result;
      }

      minRemaining = Math.min(minRemaining, result.remaining);
      maxResetAtMs = Math.max(maxResetAtMs, result.resetAtMs);
    }

    return {
      allowed: true,
      remaining: minRemaining,
      resetAtMs: maxResetAtMs,
      retryAfterMs: 0,
    };
  }
}
