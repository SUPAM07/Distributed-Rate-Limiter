import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';

export interface GCRAConfig {
  /** The time in milliseconds between requests (1 / rate) */
  emissionIntervalMs: number;
  /** Maximum burst capacity (number of requests that can be made instantly) */
  burstCapacity: number;
  /** TTL in seconds applied to the Redis key */
  ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Lua Script
// ---------------------------------------------------------------------------
// KEYS[1]  - the rate-limit Redis key
// ARGV[1]  - emissionIntervalMs
// ARGV[2]  - burstToleranceMs (emissionIntervalMs * burstCapacity)
// ARGV[3]  - now (Unix timestamp in ms)
// ARGV[4]  - ttlSeconds
// ARGV[5]  - weight
// ---------------------------------------------------------------------------
const GCRA_LUA = `
local key              = KEYS[1]
local emissionInterval = tonumber(ARGV[1])
local burstTolerance   = tonumber(ARGV[2])
local now              = tonumber(ARGV[3])
local ttl              = tonumber(ARGV[4])
local weight           = tonumber(ARGV[5])

local tat = tonumber(redis.call('GET', key) or "0")

if tat < now then
  tat = now
end

local increment = weight * emissionInterval
local newTat = tat + increment

local allowed = 0
local retryAfterMs = 0

-- The theoretical limit time is now + burstTolerance.
-- If newTat exceeds this, the request is rejected.
local limitTime = now + burstTolerance

if newTat <= limitTime then
  redis.call('SET', key, tostring(newTat), 'EX', ttl)
  allowed = 1
  tat = newTat
else
  allowed = 0
  -- If rejected, the retry time is when TAT drops enough to allow 'weight' increment
  -- Time required = newTat - limitTime
  retryAfterMs = newTat - limitTime
end

-- Remaining capacity can be estimated from how far TAT is from limitTime
-- remaining = (limitTime - tat) / emissionInterval
local remainingRaw = (limitTime - tat) / emissionInterval
local remaining = math.floor(math.max(0, remainingRaw))

return { allowed, remaining, tat, retryAfterMs }
`;

export class GCRA extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT = GCRA_LUA;
  private readonly config: GCRAConfig;

  constructor(config: GCRAConfig) {
    super();
    if (config.emissionIntervalMs <= 0) throw new Error('GCRA: emissionIntervalMs must be > 0');
    if (config.burstCapacity <= 0) throw new Error('GCRA: burstCapacity must be > 0');
    if (config.ttlSeconds <= 0) throw new Error('GCRA: ttlSeconds must be > 0');
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
    
    // resetAtMs: When TAT drops to 'now', the bucket is fully reset
    // i.e., tat is the exact timestamp when the bucket will be completely empty.
    const resetAtMs = Math.max(now, tat);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
