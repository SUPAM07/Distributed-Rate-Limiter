import type Redis from 'ioredis';
import { getRedisClient } from '../../redis/client';
import type { RateLimiter, RateLimiterResult } from '../types';

export interface FixedWindowConfig {
  /** Maximum number of requests allowed per window. */
  limit: number;
  /** Window duration in seconds. */
  windowSeconds: number;
  /** TTL in seconds applied to the Redis key. Should be >= windowSeconds. */
  ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Lua Script
// ---------------------------------------------------------------------------
// KEYS[1] - the rate-limit Redis key for the current window (e.g., throttlex:rl:fixed-window:127.0.0.1:1629837600)
// ARGV[1] - limit (integer)
// ARGV[2] - ttlSeconds (integer)
//
// Returns a two-element array:
// [0] - 1 if allowed, 0 if rejected
// [1] - remaining tokens after this request (integer)
// ---------------------------------------------------------------------------
const FIXED_WINDOW_LUA = `
local key   = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl   = tonumber(ARGV[2])

local count = redis.call('GET', key)
if count == false then
  count = 0
else
  count = tonumber(count)
end

local allowed = 0
local remaining = 0

if count < limit then
  count = redis.call('INCR', key)
  if count == 1 then
    redis.call('EXPIRE', key, ttl)
  end
  allowed = 1
  remaining = limit - count
else
  allowed = 0
  remaining = 0
end

return { allowed, remaining }
`;

export class FixedWindow implements RateLimiter {
  private readonly config: FixedWindowConfig;
  private readonly redis: Redis;
  private scriptSha: string | null = null;

  constructor(config: FixedWindowConfig) {
    if (config.limit <= 0) throw new Error('FixedWindow: limit must be > 0');
    if (config.windowSeconds <= 0) throw new Error('FixedWindow: windowSeconds must be > 0');
    if (config.ttlSeconds < config.windowSeconds) {
      throw new Error('FixedWindow: ttlSeconds must be >= windowSeconds');
    }
    this.config = config;
    this.redis = getRedisClient();
  }

  async consume(key: string): Promise<RateLimiterResult> {
    const now = Date.now();
    const { limit, windowSeconds, ttlSeconds } = this.config;
    const windowMs = windowSeconds * 1000;
    
    // Calculate the start time of the current window
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
    // Append window timestamp to the key to isolate different windows
    const windowKey = `${key}:${windowStartMs}`;

    const [allowedRaw, remainingRaw] = await this.evalScript(windowKey, [
      String(limit),
      String(ttlSeconds),
    ]);

    const allowed = allowedRaw === 1;
    const remaining = remainingRaw as number;

    const resetAtMs = windowStartMs + windowMs;
    const retryAfterMs = allowed ? 0 : Math.max(0, resetAtMs - now);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }

  private async evalScript(key: string, args: string[]): Promise<[number, number]> {
    const load = async (): Promise<string> => {
      const sha = await this.redis.script('LOAD', FIXED_WINDOW_LUA) as string;
      this.scriptSha = sha;
      return sha;
    };

    if (!this.scriptSha) await load();

    const run = async (sha: string): Promise<[number, number]> => {
      return await this.redis.evalsha(sha, 1, key, ...args) as [number, number];
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
