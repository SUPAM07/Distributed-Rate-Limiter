import { BaseRateLimiter } from '../base/baseRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../types';

export interface TokenBucketConfig {
  capacity: number;
  refillRate: number;
  ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Lua Script
// ---------------------------------------------------------------------------
// KEYS[1]  - the rate-limit Redis key
// ARGV[1]  - capacity
// ARGV[2]  - refillRate
// ARGV[3]  - now
// ARGV[4]  - ttlSeconds
// ARGV[5]  - weight (cost of the request)
// ---------------------------------------------------------------------------
const TOKEN_BUCKET_LUA = `
local key            = KEYS[1]
local capacity       = tonumber(ARGV[1])
local refillRate     = tonumber(ARGV[2])
local now            = tonumber(ARGV[3])
local ttl            = tonumber(ARGV[4])
local weight         = tonumber(ARGV[5])

local raw = redis.call('HMGET', key, 'tokens', 'lastRefillTime')
local tokens         = tonumber(raw[1])
local lastRefillTime = tonumber(raw[2])

if tokens == nil or lastRefillTime == nil then
  tokens         = capacity
  lastRefillTime = now
end

local elapsedSeconds = (now - lastRefillTime) / 1000
local refilled       = elapsedSeconds * refillRate
tokens = math.min(capacity, tokens + refilled)

local allowed   = 0
local remaining = 0

if tokens >= weight then
  tokens    = tokens - weight
  allowed   = 1
  remaining = math.floor(tokens)
else
  remaining = math.floor(tokens)
end

redis.call('HSET',   key, 'tokens', tostring(tokens), 'lastRefillTime', tostring(now))
redis.call('EXPIRE', key, ttl)

return { allowed, remaining }
`;

export class TokenBucket extends BaseRateLimiter implements RateLimiter {
  protected readonly LUA_SCRIPT = TOKEN_BUCKET_LUA;
  private readonly config: TokenBucketConfig;

  constructor(config: TokenBucketConfig) {
    super();
    if (config.capacity <= 0) throw new Error('TokenBucket: capacity must be > 0');
    if (config.refillRate <= 0) throw new Error('TokenBucket: refillRate must be > 0');
    if (config.ttlSeconds <= 0) throw new Error('TokenBucket: ttlSeconds must be > 0');
    this.config = config;
  }

  async consume(key: string, weight = 1): Promise<RateLimiterResult> {
    const now = Date.now();
    const { capacity, refillRate, ttlSeconds } = this.config;

    const [allowedRaw, remainingRaw] = await this.evalScript<[number, number]>(1, [
      key,
      String(capacity),
      String(refillRate),
      String(now),
      String(ttlSeconds),
      String(weight),
    ]);

    const allowed = allowedRaw === 1;
    const remaining = remainingRaw;

    const tokensNeededForFull = capacity - remaining;
    const secondsToFull = tokensNeededForFull / refillRate;
    const resetAtMs = now + Math.ceil(secondsToFull * 1000);

    const retryAfterMs = allowed ? 0 : Math.ceil((weight - remaining) / refillRate * 1000);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }
}
