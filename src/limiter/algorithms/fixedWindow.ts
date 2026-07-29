import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';
import { requirePositiveNumber, requireGreaterThanOrEqual } from '../validators/configValidator';
import { calculateRetryAfterMsForWindow } from '../retry/retryAfter';
import { alignToWindow } from '../utils/timeUtils';

export interface FixedWindowConfig {
  limit: number;
  windowSeconds: number;
  ttlSeconds: number;
}

export class FixedWindow extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT_FILENAME = 'fixedWindow.lua';
  private readonly config: FixedWindowConfig;

  constructor(config: FixedWindowConfig) {
    super();
    requirePositiveNumber(config.limit, 'limit', 'FixedWindow');
    requirePositiveNumber(config.windowSeconds, 'windowSeconds', 'FixedWindow');
    requireGreaterThanOrEqual(config.ttlSeconds, config.windowSeconds, 'ttlSeconds', 'windowSeconds', 'FixedWindow');
    this.config = config;
  }

  async consume(key: string, weight = 1): Promise<RateLimiterResult> {
    const now = Date.now();
    const { limit, windowSeconds, ttlSeconds } = this.config;
    const windowMs = windowSeconds * 1000;
    
    const windowStartMs = alignToWindow(now, windowMs);
    const windowKey = `${key}:${windowStartMs}`;

    const [allowedRaw, remainingRaw] = await this.evalScript<[number, number]>(1, [
      windowKey,
      String(limit),
      String(ttlSeconds),
      String(weight),
    ]);

    const allowed = allowedRaw === 1;
    const remaining = remainingRaw;

    const resetAtMs = windowStartMs + windowMs;
    const retryAfterMs = calculateRetryAfterMsForWindow(allowed, resetAtMs, now);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
