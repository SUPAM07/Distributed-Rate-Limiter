import type Redis from 'ioredis';
import { getRedisClient } from '../../redis/client';
import type { RateLimiter, RateLimiterResult } from '../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TokenBucketConfig {
  /** Maximum number of tokens (burst capacity). */
  capacity: number;
  /** Tokens refilled per second. */
  refillRate: number;
  /** TTL in seconds applied to the Redis key when the bucket is idle. */
  ttlSeconds: number;
}

// ---------------------------------------------------------------------------
// Lua Script
// ---------------------------------------------------------------------------
//
// The entire token-bucket state transition executes atomically inside Redis.
// No separate read/write operations — avoids TOCTOU races across instances.
//
// Redis hash fields stored under the key:
//   tokens          – current token count (float stored as string)
//   lastRefillTime  – Unix timestamp in milliseconds when tokens were last refilled
//
// KEYS[1]  – the rate-limit Redis key (e.g. throttlex:rl:127.0.0.1)
// ARGV[1]  – capacity      (integer)
// ARGV[2]  – refillRate    (tokens per second, integer)
// ARGV[3]  – now           (current Unix time in milliseconds, integer)
// ARGV[4]  – ttlSeconds    (integer)
//
// Returns a two-element array:
//   [0] – 1 if allowed, 0 if rejected
//   [1] – remaining tokens after this request (integer, floor)
// ---------------------------------------------------------------------------

const TOKEN_BUCKET_LUA = `
local key            = KEYS[1]
local capacity       = tonumber(ARGV[1])
local refillRate     = tonumber(ARGV[2])
local now            = tonumber(ARGV[3])
local ttl            = tonumber(ARGV[4])

-- Read existing state
local raw = redis.call('HMGET', key, 'tokens', 'lastRefillTime')
local tokens         = tonumber(raw[1])
local lastRefillTime = tonumber(raw[2])

-- Initialise bucket on first access
if tokens == nil or lastRefillTime == nil then
  tokens         = capacity
  lastRefillTime = now
end

-- Refill based on elapsed time
local elapsedSeconds = (now - lastRefillTime) / 1000
local refilled       = elapsedSeconds * refillRate
tokens = math.min(capacity, tokens + refilled)

-- Attempt to consume one token
local allowed   = 0
local remaining = 0

if tokens >= 1 then
  tokens    = tokens - 1
  allowed   = 1
  remaining = math.floor(tokens)
else
  remaining = 0
end

-- Persist updated state and reset TTL
redis.call('HSET',   key, 'tokens', tostring(tokens), 'lastRefillTime', tostring(now))
redis.call('EXPIRE', key, ttl)

return { allowed, remaining }
`;

// ---------------------------------------------------------------------------
// TokenBucket class
// ---------------------------------------------------------------------------

export class TokenBucket implements RateLimiter {
  private readonly config: TokenBucketConfig;
  private readonly redis: Redis;
  /** Cached SHA after the first SCRIPT LOAD — avoids resending the script body. */
  private scriptSha: string | null = null;

  constructor(config: TokenBucketConfig) {
    if (config.capacity <= 0) {
      throw new Error('TokenBucket: capacity must be > 0');
    }
    if (config.refillRate <= 0) {
      throw new Error('TokenBucket: refillRate must be > 0');
    }
    if (config.ttlSeconds <= 0) {
      throw new Error('TokenBucket: ttlSeconds must be > 0');
    }
    this.config = config;
    this.redis = getRedisClient();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async consume(key: string): Promise<RateLimiterResult> {
    const now = Date.now();
    const { capacity, refillRate, ttlSeconds } = this.config;

    const [allowedRaw, remainingRaw] = await this.evalScript(key, [
      String(capacity),
      String(refillRate),
      String(now),
      String(ttlSeconds),
    ]);

    const allowed = allowedRaw === 1;
    const remaining = remainingRaw as number;

    // Time (ms) for the bucket to fully refill from current remaining count.
    // If allowed=false remaining=0, so the full refill time is: capacity / refillRate seconds.
    const tokensNeededForFull = capacity - remaining;
    const secondsToFull = tokensNeededForFull / refillRate;
    const resetAtMs = now + Math.ceil(secondsToFull * 1000);

    // How long until at least 1 token is available (only meaningful when rejected).
    const retryAfterMs = allowed ? 0 : Math.ceil(1000 / refillRate);

    return { allowed, remaining, resetAtMs, retryAfterMs };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Execute the Lua script using EVALSHA (cached) with EVAL fallback.
   * Caching the SHA avoids sending the full script on every request.
   */
  private async evalScript(
    key: string,
    args: string[],
  ): Promise<[number, number]> {
    const load = async (): Promise<string> => {
      const sha = await this.redis.script('LOAD', TOKEN_BUCKET_LUA) as string;
      this.scriptSha = sha;
      return sha;
    };

    if (!this.scriptSha) {
      await load();
    }

    const run = async (sha: string): Promise<[number, number]> => {
      const result = await this.redis.evalsha(sha, 1, key, ...args) as [number, number];
      return result;
    };

    try {
      return await run(this.scriptSha!);
    } catch (err: unknown) {
      // NOSCRIPT means the script was flushed from Redis (e.g. restart). Reload and retry once.
      if (err instanceof Error && err.message.startsWith('NOSCRIPT')) {
        const newSha = await load();
        return await run(newSha);
      }
      throw err;
    }
  }
}
