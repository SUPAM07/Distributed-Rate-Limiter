import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';
import { requirePositiveNumber } from '../validators/configValidator';
import { calculateRetryAfterMsForRate } from '../retry/retryAfter';

export interface LeakyBucketConfig {
  capacity: number;
  leakRate: number;
  ttlSeconds: number;
}

export class LeakyBucket extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT_FILENAME = 'leakyBucket.lua';
  private readonly config: LeakyBucketConfig;

  constructor(config: LeakyBucketConfig) {
    super();
    requirePositiveNumber(config.capacity, 'capacity', 'LeakyBucket');
    requirePositiveNumber(config.leakRate, 'leakRate', 'LeakyBucket');
    requirePositiveNumber(config.ttlSeconds, 'ttlSeconds', 'LeakyBucket');
    this.config = config;
  }

  async consume(key: string, weight = 1): Promise<RateLimiterResult> {
    const now = Date.now();
    const { capacity, leakRate, ttlSeconds } = this.config;

    const [allowedRaw, remainingRaw] = await this.evalScript<[number, number]>(1, [
      key,
      String(capacity),
      String(leakRate),
      String(now),
      String(ttlSeconds),
      String(weight),
    ]);

    const allowed = allowedRaw === 1;
    const remaining = Math.max(0, remainingRaw);

    const currentLevel = capacity - remaining;
    const secondsToEmpty = currentLevel / leakRate;
    const resetAtMs = now + Math.ceil(secondsToEmpty * 1000);

    const neededLeak = (currentLevel + weight) - capacity;
    const retryAfterMs = calculateRetryAfterMsForRate(allowed, neededLeak, leakRate);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
