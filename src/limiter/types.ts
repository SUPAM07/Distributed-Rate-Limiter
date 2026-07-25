/**
 * Core rate-limiter types shared across all algorithm implementations.
 *
 * Algorithm implementations must not import from Express or any HTTP framework.
 */

/**
 * The result returned by every rate-limiter after processing one request.
 */
export interface RateLimiterResult {
  /** True if the request is within the allowed limit. */
  allowed: boolean;

  /** Number of remaining tokens/requests before the limit is hit. */
  remaining: number;

  /**
   * Unix timestamp (milliseconds) at which the bucket will be fully refilled.
   * Useful for the X-RateLimit-Reset header.
   */
  resetAtMs: number;

  /**
   * Milliseconds the caller should wait before retrying.
   * 0 when the request is allowed.
   */
  retryAfterMs: number;
}

/**
 * Contract that every rate-limiting algorithm must satisfy.
 * Keeps middleware decoupled from specific algorithm implementations.
 */
export interface RateLimiter {
  /**
   * Consume tokens/capacity for a given request.
   *
   * @param key - The unique Redis key for this bucket/window, or an array of keys for hierarchical/composite limiters.
   * @param weight - Optional weight (cost) of the request. Defaults to 1.
   * @returns A promise resolving to the rate-limit result.
   */
  consume(key: string | string[], weight?: number): Promise<RateLimiterResult>;
}
