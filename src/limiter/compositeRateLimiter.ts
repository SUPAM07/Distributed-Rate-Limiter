import type { RateLimiter, RateLimiterResult } from './types';

/**
 * CompositeRateLimiter
 * 
 * Evaluates multiple rate limiters sequentially for a single request.
 * If any limiter rejects the request, the evaluation stops and the rejection is returned.
 * If all limiters allow the request, the most restrictive remaining capacity is returned.
 */
export class CompositeRateLimiter implements RateLimiter {
  private readonly limiters: RateLimiter[];

  constructor(limiters: RateLimiter[]) {
    if (!limiters || limiters.length === 0) {
      throw new Error('CompositeRateLimiter requires at least one rate limiter');
    }
    this.limiters = limiters;
  }

  async consume(key: string | string[], weight = 1): Promise<RateLimiterResult> {
    const baseKey = Array.isArray(key) ? key[0] : key;

    let minRemaining = Infinity;
    let maxResetAtMs = 0;

    for (let i = 0; i < this.limiters.length; i++) {
      const limiter = this.limiters[i];
      // Append an index to the key so each composed limiter operates in its own namespace
      const ruleKey = `${baseKey}:composite:${i}`;
      
      const result = await limiter.consume(ruleKey, weight);

      if (!result.allowed) {
        // Return immediately on first rejection
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
