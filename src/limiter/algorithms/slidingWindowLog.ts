import type Redis from 'ioredis';
import { getRedisClient } from '../../redis/client';
import type { RateLimiter, RateLimiterResult } from '../types';

export interface SlidingWindowLogConfig {
  limit: number;
  windowSeconds: number;
  ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Lua Script
// ---------------------------------------------------------------------------
// KEYS[1] - the rate-limit Redis key
// ARGV[1] - limit (integer)
// ARGV[2] - now (current time in milliseconds)
// ARGV[3] - windowStartMs (now - windowSeconds * 1000)
// ARGV[4] - ttlSeconds (integer)
// ARGV[5] - uniqueMemberId (to prevent ZSET collisions for same-millisecond requests)
//
// Returns array: [allowed (0/1), remaining (int), oldestScore (number or 0)]
// ---------------------------------------------------------------------------
const SLIDING_WINDOW_LOG_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local windowStart = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local memberId = ARGV[5]

-- Remove timestamps older than the current window
redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

local count = redis.call('ZCARD', key)

local allowed = 0
local remaining = 0

if count < limit then
  -- Add current request
  redis.call('ZADD', key, now, memberId)
  redis.call('EXPIRE', key, ttl)
  allowed = 1
  remaining = limit - count - 1
else
  allowed = 0
  remaining = 0
end

-- Get the oldest timestamp in the window (if any) to calculate reset/retry times
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = 0
if oldest[2] then
  oldestScore = tonumber(oldest[2])
end

return { allowed, remaining, oldestScore }
`;

export class SlidingWindowLog implements RateLimiter {
  private readonly config: SlidingWindowLogConfig;
  private readonly redis: Redis;
  private scriptSha: string | null = null;

  constructor(config: SlidingWindowLogConfig) {
    if (config.limit <= 0) throw new Error('SlidingWindowLog: limit must be > 0');
    if (config.windowSeconds <= 0) throw new Error('SlidingWindowLog: windowSeconds must be > 0');
    if (config.ttlSeconds < config.windowSeconds) {
      throw new Error('SlidingWindowLog: ttlSeconds must be >= windowSeconds');
    }
    this.config = config;
    this.redis = getRedisClient();
  }

  async consume(key: string): Promise<RateLimiterResult> {
    const now = Date.now();
    const { limit, windowSeconds, ttlSeconds } = this.config;
    const windowMs = windowSeconds * 1000;
    const windowStartMs = now - windowMs;
    // memberId needs to be unique so concurrent requests at the exact same millisecond don't overwrite each other in the ZSET
    const memberId = `${now}-${Math.random().toString(36).slice(2)}`;

    const [allowedRaw, remainingRaw, oldestScoreRaw] = await this.evalScript(key, [
      String(limit),
      String(now),
      String(windowStartMs),
      String(ttlSeconds),
      memberId,
    ]);

    const allowed = allowedRaw === 1;
    const remaining = remainingRaw as number;
    const oldestScore = oldestScoreRaw as number;

    // Reset occurs when the oldest current request falls out of the window.
    // If no requests, resetAtMs is now (bucket is already fully reset).
    const resetAtMs = oldestScore > 0 ? oldestScore + windowMs : now;
    
    let retryAfterMs = 0;
    if (!allowed) {
      retryAfterMs = Math.max(0, resetAtMs - now);
    }

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }

  private async evalScript(key: string, args: string[]): Promise<[number, number, number]> {
    const load = async (): Promise<string> => {
      const sha = await this.redis.script('LOAD', SLIDING_WINDOW_LOG_LUA) as string;
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
