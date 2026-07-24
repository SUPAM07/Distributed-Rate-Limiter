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
   * Attempt to consume one unit of capacity for the given key.
   *
   * @param key - A namespaced Redis key identifying the rate-limit bucket.
   * @returns     RateLimiterResult describing the outcome.
   */
  consume(key: string): Promise<RateLimiterResult>;
}
