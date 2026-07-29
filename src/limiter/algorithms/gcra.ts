import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';
import { requirePositiveNumber } from '../validators/configValidator';

export interface GCRAConfig {
  emissionIntervalMs: number;
  burstCapacity: number;
  ttlSeconds: number;
}

export class GCRA extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT_FILENAME = 'gcra.lua';
  private readonly config: GCRAConfig;

  constructor(config: GCRAConfig) {
    super();
    requirePositiveNumber(config.emissionIntervalMs, 'emissionIntervalMs', 'GCRA');
    requirePositiveNumber(config.burstCapacity, 'burstCapacity', 'GCRA');
    requirePositiveNumber(config.ttlSeconds, 'ttlSeconds', 'GCRA');
    this.config = config;
  }

  async consume(key: string, weight = 1): Promise<RateLimiterResult> {
    const now = Date.now();
    const { emissionIntervalMs, burstCapacity, ttlSeconds } = this.config;
    const burstToleranceMs = emissionIntervalMs * burstCapacity;

    const [allowedRaw, remaining, tat, retryAfterMs] = await this.evalScript<[number, number, number, number]>(1, [
      key,
      String(emissionIntervalMs),
      String(burstToleranceMs),
      String(now),
      String(ttlSeconds),
      String(weight),
    ]);

    const allowed = allowedRaw === 1;
    const resetAtMs = Math.max(now, tat);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
