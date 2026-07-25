import { BaseRateLimiter } from '../base/baseRateLimiter';
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
// ARGV[1] - limit
// ARGV[2] - now
// ARGV[3] - windowStartMs
// ARGV[4] - ttlSeconds
// ARGV[5] - uniqueMemberId
// ARGV[6] - weight
// ---------------------------------------------------------------------------
const SLIDING_WINDOW_LOG_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local windowStart = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local memberId = ARGV[5]
local weight = tonumber(ARGV[6])

redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

local count = tonumber(redis.call('ZCARD', key) or "0")

local allowed = 0
local remaining = 0

if count + weight <= limit then
  -- Add one entry per weight unit to correctly track capacity
  -- We batch them into a single ZADD call for efficiency
  local zaddArgs = {}
  for i=1, weight do
    table.insert(zaddArgs, now)
    table.insert(zaddArgs, memberId .. '-' .. i)
  end
  if #zaddArgs > 0 then
    redis.call('ZADD', key, unpack(zaddArgs))
    redis.call('EXPIRE', key, ttl)
  end
  allowed = 1
  remaining = limit - count - weight
else
  allowed = 0
  remaining = math.max(0, limit - count)
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = 0
if oldest[2] then
  oldestScore = tonumber(oldest[2])
end

return { allowed, remaining, oldestScore }
`;

export class SlidingWindowLog extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT = SLIDING_WINDOW_LOG_LUA;
  private readonly config: SlidingWindowLogConfig;

  constructor(config: SlidingWindowLogConfig) {
    super();
    if (config.limit <= 0) throw new Error('SlidingWindowLog: limit must be > 0');
    if (config.windowSeconds <= 0) throw new Error('SlidingWindowLog: windowSeconds must be > 0');
    if (config.ttlSeconds < config.windowSeconds) {
      throw new Error('SlidingWindowLog: ttlSeconds must be >= windowSeconds');
    }
    this.config = config;
  }

  async consume(key: string, weight = 1): Promise<RateLimiterResult> {
    const now = Date.now();
    const { limit, windowSeconds, ttlSeconds } = this.config;
    const windowMs = windowSeconds * 1000;
    const windowStartMs = now - windowMs;
    const memberId = `${now}-${Math.random().toString(36).slice(2)}`;

    const [allowedRaw, remainingRaw, oldestScoreRaw] = await this.evalScript<[number, number, number]>(1, [
      key,
      String(limit),
      String(now),
      String(windowStartMs),
      String(ttlSeconds),
      memberId,
      String(weight),
    ]);

    const allowed = allowedRaw === 1;
    const remaining = remainingRaw;
    const oldestScore = oldestScoreRaw;

    const resetAtMs = oldestScore > 0 ? oldestScore + windowMs : now;
    let retryAfterMs = 0;
    if (!allowed) {
      retryAfterMs = Math.max(0, resetAtMs - now);
    }

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
