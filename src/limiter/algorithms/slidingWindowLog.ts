import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';
import { requirePositiveNumber, requireGreaterThanOrEqual } from '../validators/configValidator';
import { calculateRetryAfterMsForWindow } from '../retry/retryAfter';

export interface SlidingWindowLogConfig {
  limit: number;
  windowSeconds: number;
  ttlSeconds: number;
}

export class SlidingWindowLog extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT_FILENAME = 'slidingWindowLog.lua';
  private readonly config: SlidingWindowLogConfig;

  constructor(config: SlidingWindowLogConfig) {
    super();
    requirePositiveNumber(config.limit, 'limit', 'SlidingWindowLog');
    requirePositiveNumber(config.windowSeconds, 'windowSeconds', 'SlidingWindowLog');
    requireGreaterThanOrEqual(config.ttlSeconds, config.windowSeconds, 'ttlSeconds', 'windowSeconds', 'SlidingWindowLog');
    this.config = config;
  }

  async consume(key: string, weight = 1): Promise<RateLimiterResult> {
    const now = Date.now();
    const { limit, windowSeconds, ttlSeconds } = this.config;
    const windowMs = windowSeconds * 1000;
    const windowStartMs = now - windowMs;
    const memberId = `${now}-${Math.random().toString(36).slice(2)}`;

    const [allowedRaw, remainingRaw, oldestScoreRaw] = await this.evalScript<[number, number, number]>(1, [
      key,
      String(limit),
      String(now),
      String(windowStartMs),
      String(ttlSeconds),
      memberId,
      String(weight),
    ]);

    const allowed = allowedRaw === 1;
    const remaining = remainingRaw;
    const oldestScore = oldestScoreRaw;

    const resetAtMs = oldestScore > 0 ? oldestScore + windowMs : now;
    const retryAfterMs = calculateRetryAfterMsForWindow(allowed, resetAtMs, now);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
