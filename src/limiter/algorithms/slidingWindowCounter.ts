import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';

export interface SlidingWindowCounterConfig {
  limit: number;
  windowSeconds: number;
  ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Lua Script
// ---------------------------------------------------------------------------
// KEYS[1] - the rate-limit Redis key
// ARGV[1] - limit
// ARGV[2] - now
// ARGV[3] - currWindowStartMs
// ARGV[4] - prevWindowStartMs
// ARGV[5] - windowMs
// ARGV[6] - ttlSeconds
// ARGV[7] - weight
// ---------------------------------------------------------------------------
const SLIDING_WINDOW_COUNTER_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local currStart = ARGV[3]
local prevStart = ARGV[4]
local windowMs = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])
local weight = tonumber(ARGV[7])

local counts = redis.call('HMGET', key, prevStart, currStart)
local prevCount = tonumber(counts[1]) or 0
local currCount = tonumber(counts[2]) or 0

local elapsedInCurrent = now - tonumber(currStart)
local weightFactor = math.max(0, (windowMs - elapsedInCurrent) / windowMs)
local estimatedCount = (prevCount * weightFactor) + currCount

local allowed = 0
local remaining = 0

if estimatedCount + weight <= limit then
  currCount = redis.call('HINCRBY', key, currStart, weight)
  redis.call('EXPIRE', key, ttl)
  allowed = 1
  estimatedCount = (prevCount * weightFactor) + currCount
  remaining = math.max(0, limit - math.floor(estimatedCount))
else
  allowed = 0
  remaining = math.max(0, limit - math.floor(estimatedCount))
end

return { allowed, remaining, estimatedCount }
`;

export class SlidingWindowCounter extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT = SLIDING_WINDOW_COUNTER_LUA;
  private readonly config: SlidingWindowCounterConfig;

  constructor(config: SlidingWindowCounterConfig) {
    super();
    if (config.limit <= 0) throw new Error('SlidingWindowCounter: limit must be > 0');
    if (config.windowSeconds <= 0) throw new Error('SlidingWindowCounter: windowSeconds must be > 0');
    if (config.ttlSeconds < config.windowSeconds * 2) {
      throw new Error('SlidingWindowCounter: ttlSeconds must be >= windowSeconds * 2');
    }
    this.config = config;
  }

  async consume(key: string, weight = 1): Promise<RateLimiterResult> {
    const now = Date.now();
    const { limit, windowSeconds, ttlSeconds } = this.config;
    const windowMs = windowSeconds * 1000;
    
    const currWindowStartMs = Math.floor(now / windowMs) * windowMs;
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
    const retryAfterMs = allowed ? 0 : Math.max(0, resetAtMs - now);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
