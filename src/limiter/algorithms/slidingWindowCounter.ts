import type Redis from 'ioredis';
import { getRedisClient } from '../../redis/client';
import type { RateLimiter, RateLimiterResult } from '../types';

export interface SlidingWindowCounterConfig {
  limit: number;
  windowSeconds: number;
  ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Lua Script
// ---------------------------------------------------------------------------
// We store both the previous and current window counts in a Redis hash.
//
// Hash fields:
//   <prevWindowStartMs> - count of previous window
//   <currWindowStartMs> - count of current window
//
// KEYS[1] - the rate-limit Redis key
// ARGV[1] - limit (integer)
// ARGV[2] - now (current time in milliseconds)
// ARGV[3] - currWindowStartMs (start of current window)
// ARGV[4] - prevWindowStartMs (start of previous window)
// ARGV[5] - windowMs (window duration in milliseconds)
// ARGV[6] - ttlSeconds (TTL for the key, applied if creating/updating)
//
// Returns array: [allowed (0/1), remaining (int), estimatedCount (number)]
// ---------------------------------------------------------------------------
const SLIDING_WINDOW_COUNTER_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local currStart = ARGV[3]
local prevStart = ARGV[4]
local windowMs = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])

-- Read counts from hash
local counts = redis.call('HMGET', key, prevStart, currStart)
local prevCount = tonumber(counts[1]) or 0
local currCount = tonumber(counts[2]) or 0

-- Clean up older window fields (optional but good for memory)
-- We can just rely on the TTL to clear the whole key, but since it's a sliding window
-- of a specific user, the hash might grow over time if they visit exactly once per window.
-- Better to delete old fields. We'll just let TTL handle it for simplicity since TTL is short.

-- Calculate estimated count
local elapsedInCurrent = now - tonumber(currStart)
local weight = math.max(0, (windowMs - elapsedInCurrent) / windowMs)
local estimatedCount = (prevCount * weight) + currCount

local allowed = 0
local remaining = 0

if estimatedCount < limit then
  -- Allow the request and increment current window
  currCount = redis.call('HINCRBY', key, currStart, 1)
  redis.call('EXPIRE', key, ttl)
  allowed = 1
  -- Re-calculate remaining after increment
  estimatedCount = (prevCount * weight) + currCount
  remaining = math.max(0, limit - math.floor(estimatedCount))
else
  allowed = 0
  remaining = 0
end

return { allowed, remaining, estimatedCount }
`;

export class SlidingWindowCounter implements RateLimiter {
  private readonly config: SlidingWindowCounterConfig;
  private readonly redis: Redis;
  private scriptSha: string | null = null;

  constructor(config: SlidingWindowCounterConfig) {
    if (config.limit <= 0) throw new Error('SlidingWindowCounter: limit must be > 0');
    if (config.windowSeconds <= 0) throw new Error('SlidingWindowCounter: windowSeconds must be > 0');
    if (config.ttlSeconds < config.windowSeconds * 2) {
      throw new Error('SlidingWindowCounter: ttlSeconds must be >= windowSeconds * 2');
    }
    this.config = config;
    this.redis = getRedisClient();
  }

  async consume(key: string): Promise<RateLimiterResult> {
    const now = Date.now();
    const { limit, windowSeconds, ttlSeconds } = this.config;
    const windowMs = windowSeconds * 1000;
    
    const currWindowStartMs = Math.floor(now / windowMs) * windowMs;
    const prevWindowStartMs = currWindowStartMs - windowMs;

    const [allowedRaw, remainingRaw] = await this.evalScript(key, [
      String(limit),
      String(now),
      String(currWindowStartMs),
      String(prevWindowStartMs),
      String(windowMs),
      String(ttlSeconds),
    ]);

    const allowed = allowedRaw === 1;
    const remaining = remainingRaw as number;

    const resetAtMs = currWindowStartMs + windowMs;
    const retryAfterMs = allowed ? 0 : Math.max(0, resetAtMs - now);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }

  private async evalScript(key: string, args: string[]): Promise<[number, number, number]> {
    const load = async (): Promise<string> => {
      const sha = await this.redis.script('LOAD', SLIDING_WINDOW_COUNTER_LUA) as string;
      this.scriptSha = sha;
      return sha;
    };

    if (!this.scriptSha) await load();

    const run = async (sha: string): Promise<[number, number, number]> => {
      return await this.redis.evalsha(sha, 1, key, ...args) as [number, number, number];
    };

    try {
      return await run(this.scriptSha!);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('NOSCRIPT')) {
        const newSha = await load();
        return await run(newSha);
      }
      throw err;
    }
  }
}
