/**
 * Central key generation for all ThrottleX Redis keys.
 *
 * Namespace (Phase 2): throttlex:rl:{algorithm}:{identifier}
 *
 * Rules:
 * - Never expose raw user IDs, raw API keys, or secrets in keys.
 * - Identifier should already be normalised/hashed by the caller if needed.
 * - Algorithm name must always be included to prevent key collisions between
 *   algorithms sharing the same Redis instance.
 */

const NAMESPACE = 'throttlex:rl';

/**
 * Build the Redis key for a rate-limit bucket.
 *
 * @param algorithm  - The algorithm name (e.g. 'token-bucket', 'fixed-window').
 * @param identifier - A normalised string identifying the requester (e.g. IP address).
 * @returns            Redis key in the form `throttlex:rl:{algorithm}:{identifier}`.
 */
export function buildRateLimitKey(algorithm: string, identifier: string): string {
  if (!algorithm || algorithm.trim() === '') {
    throw new Error('Rate-limit algorithm must be a non-empty string');
  }
  if (!identifier || identifier.trim() === '') {
    throw new Error('Rate-limit identifier must be a non-empty string');
  }
  return `${NAMESPACE}:${algorithm}:${identifier}`;
}
