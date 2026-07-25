import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';

export interface FixedWindowConfig {
  limit: number;
  windowSeconds: number;
  ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Lua Script
// ---------------------------------------------------------------------------
// KEYS[1] - the rate-limit Redis key for the current window
// ARGV[1] - limit
// ARGV[2] - ttlSeconds
// ARGV[3] - weight
// ---------------------------------------------------------------------------
const FIXED_WINDOW_LUA = `
local key    = KEYS[1]
local limit  = tonumber(ARGV[1])
local ttl    = tonumber(ARGV[2])
local weight = tonumber(ARGV[3])

local count = tonumber(redis.call('GET', key) or "0")

local allowed = 0
local remaining = 0

if count + weight <= limit then
  count = redis.call('INCRBY', key, weight)
  if count == weight then
    redis.call('EXPIRE', key, ttl)
  end
  allowed = 1
  remaining = limit - count
else
  allowed = 0
  remaining = math.max(0, limit - count)
end

return { allowed, remaining }
`;

export class FixedWindow extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT = FIXED_WINDOW_LUA;
  private readonly config: FixedWindowConfig;

  constructor(config: FixedWindowConfig) {
    super();
    if (config.limit <= 0) throw new Error('FixedWindow: limit must be > 0');
    if (config.windowSeconds <= 0) throw new Error('FixedWindow: windowSeconds must be > 0');
    if (config.ttlSeconds < config.windowSeconds) {
      throw new Error('FixedWindow: ttlSeconds must be >= windowSeconds');
    }
    this.config = config;
  }

  async consume(key: string, weight = 1): Promise<RateLimiterResult> {
    const now = Date.now();
    const { limit, windowSeconds, ttlSeconds } = this.config;
    const windowMs = windowSeconds * 1000;
    
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
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
    const retryAfterMs = allowed ? 0 : Math.max(0, resetAtMs - now);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
