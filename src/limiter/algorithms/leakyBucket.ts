import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';

export interface LeakyBucketConfig {
  /** Maximum number of requests the bucket can hold */
  capacity: number;
  /** Number of requests that leak out of the bucket per second */
  leakRate: number;
  /** TTL in seconds applied to the Redis key */
  ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Lua Script
// ---------------------------------------------------------------------------
// KEYS[1]  - the rate-limit Redis key
// ARGV[1]  - capacity
// ARGV[2]  - leakRate (per second)
// ARGV[3]  - now (Unix timestamp in ms)
// ARGV[4]  - ttlSeconds
// ARGV[5]  - weight
// ---------------------------------------------------------------------------
const LEAKY_BUCKET_LUA = `
local key       = KEYS[1]
local capacity  = tonumber(ARGV[1])
local leakRate  = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local ttl       = tonumber(ARGV[4])
local weight    = tonumber(ARGV[5])

local raw = redis.call('HMGET', key, 'level', 'lastUpdateTime')
local level          = tonumber(raw[1])
local lastUpdateTime = tonumber(raw[2])

if level == nil or lastUpdateTime == nil then
  level = 0
  lastUpdateTime = now
end

local elapsedSeconds = (now - lastUpdateTime) / 1000
local leaked = elapsedSeconds * leakRate
level = math.max(0, level - leaked)

local allowed = 0
local remaining = 0

if level + weight <= capacity then
  level = level + weight
  allowed = 1
  remaining = capacity - math.ceil(level)
else
  allowed = 0
  remaining = capacity - math.ceil(level)
end

-- Persist updated state
redis.call('HSET', key, 'level', tostring(level), 'lastUpdateTime', tostring(now))
redis.call('EXPIRE', key, ttl)

return { allowed, remaining }
`;

export class LeakyBucket extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT = LEAKY_BUCKET_LUA;
  private readonly config: LeakyBucketConfig;

  constructor(config: LeakyBucketConfig) {
    super();
    if (config.capacity <= 0) throw new Error('LeakyBucket: capacity must be > 0');
    if (config.leakRate <= 0) throw new Error('LeakyBucket: leakRate must be > 0');
    if (config.ttlSeconds <= 0) throw new Error('LeakyBucket: ttlSeconds must be > 0');
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

    // resetAtMs: When the bucket is completely empty.
    // level = capacity - remaining
    // seconds to empty = level / leakRate
    const currentLevel = capacity - remaining;
    const secondsToEmpty = currentLevel / leakRate;
    const resetAtMs = now + Math.ceil(secondsToEmpty * 1000);

    // retryAfterMs: If rejected, how long until 'weight' amount of capacity is free?
    // We need (currentLevel + weight) to drop down to 'capacity'.
    // Overcapacity = (currentLevel + weight) - capacity
    let retryAfterMs = 0;
    if (!allowed) {
      const neededLeak = (currentLevel + weight) - capacity;
      retryAfterMs = Math.max(0, Math.ceil((neededLeak / leakRate) * 1000));
    }

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
