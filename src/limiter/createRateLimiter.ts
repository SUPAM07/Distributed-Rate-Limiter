import { config } from '../config/env';
import type { RateLimiter } from './types';
import { AlgorithmRegistry } from './algorithmRegistry';

export function createRateLimiter(): RateLimiter {
  // Use the AlgorithmRegistry to resolve the configured algorithm.
  // This centralizes algorithm resolution and avoids switch statements inside the factory.
  return AlgorithmRegistry.resolve(config.rateLimit.algorithm, config);
}
