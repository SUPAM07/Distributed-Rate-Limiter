import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';
import { requirePositiveNumber, requireGreaterThanOrEqual } from '../validators/configValidator';
import { calculateRetryAfterMsForWindow } from '../retry/retryAfter';
import { alignToWindow } from '../utils/timeUtils';

export interface SlidingWindowCounterConfig {
  limit: number;
  windowSeconds: number;
  ttlSeconds: number;
}

export class SlidingWindowCounter extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT_FILENAME = 'slidingWindowCounter.lua';
  private readonly config: SlidingWindowCounterConfig;

  constructor(config: SlidingWindowCounterConfig) {
    super();
    requirePositiveNumber(config.limit, 'limit', 'SlidingWindowCounter');
    requirePositiveNumber(config.windowSeconds, 'windowSeconds', 'SlidingWindowCounter');
    requireGreaterThanOrEqual(config.ttlSeconds, config.windowSeconds * 2, 'ttlSeconds', 'windowSeconds * 2', 'SlidingWindowCounter');
    this.config = config;
  }

  async consume(key: string, weight = 1): Promise<RateLimiterResult> {
    const now = Date.now();
    const { limit, windowSeconds, ttlSeconds } = this.config;
    const windowMs = windowSeconds * 1000;
    
    const currWindowStartMs = alignToWindow(now, windowMs);
    const prevWindowStartMs = currWindowStartMs - windowMs;

    const [allowedRaw, remainingRaw] = await this.evalScript<[number, number, number]>(1, [
      key,
      String(limit),
      String(now),
      String(currWindowStartMs),
      String(prevWindowStartMs),
      String(windowMs),
      String(ttlSeconds),
      String(weight),
    ]);

    const allowed = allowedRaw === 1;
    const remaining = remainingRaw;

    const resetAtMs = currWindowStartMs + windowMs;
    const retryAfterMs = calculateRetryAfterMsForWindow(allowed, resetAtMs, now);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
