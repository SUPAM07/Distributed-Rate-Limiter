/**
 * Central key generation for all ThrottleX Redis keys.
 *
 * Namespace: throttlex:rl:{identifier}
 *
 * Rules:
 * - Never expose raw user IDs, raw API keys, or secrets in keys.
 * - Identifier should already be normalised/hashed by the caller if needed.
 */

const NAMESPACE = 'throttlex:rl';

/**
 * Build the Redis key for a rate-limit bucket.
 *
 * @param identifier - A normalised string identifying the requester (e.g. IP address).
 * @returns           - Redis key string in the form `throttlex:rl:{identifier}`.
 */
export function buildRateLimitKey(identifier: string): string {
  if (!identifier || identifier.trim() === '') {
    throw new Error('Rate-limit identifier must be a non-empty string');
  }
  return `${NAMESPACE}:${identifier}`;
}
