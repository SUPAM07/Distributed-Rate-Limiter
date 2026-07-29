import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';
import { requirePositiveNumber } from '../validators/configValidator';
import { calculateRetryAfterMsForRate } from '../retry/retryAfter';

export interface TokenBucketConfig {
  capacity: number;
  refillRate: number;
  ttlSeconds: number;
}

export class TokenBucket extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT_FILENAME = 'tokenBucket.lua';
  private readonly config: TokenBucketConfig;

  constructor(config: TokenBucketConfig) {
    super();
    requirePositiveNumber(config.capacity, 'capacity', 'TokenBucket');
    requirePositiveNumber(config.refillRate, 'refillRate', 'TokenBucket');
    requirePositiveNumber(config.ttlSeconds, 'ttlSeconds', 'TokenBucket');
    this.config = config;
  }

  async consume(key: string, weight = 1): Promise<RateLimiterResult> {
    const now = Date.now();
    const { capacity, refillRate, ttlSeconds } = this.config;

    const [allowedRaw, remainingRaw] = await this.evalScript<[number, number]>(1, [
      key,
      String(capacity),
      String(refillRate),
      String(now),
      String(ttlSeconds),
      String(weight),
    ]);

    const allowed = allowedRaw === 1;
    const remaining = remainingRaw;

    const tokensNeededForFull = capacity - remaining;
    const secondsToFull = tokensNeededForFull / refillRate;
    const resetAtMs = now + Math.ceil(secondsToFull * 1000);

    const retryAfterMs = calculateRetryAfterMsForRate(allowed, weight - remaining, refillRate);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
