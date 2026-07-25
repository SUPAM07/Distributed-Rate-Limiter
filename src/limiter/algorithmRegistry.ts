import type { RateLimiter } from './types';
import type { AlgorithmType } from '../config/env';
import { TokenBucket } from './algorithms/tokenBucket';
import { FixedWindow } from './algorithms/fixedWindow';
import { SlidingWindowLog } from './algorithms/slidingWindowLog';
import { SlidingWindowCounter } from './algorithms/slidingWindowCounter';
import { LeakyBucket } from './algorithms/leakyBucket';
import { GCRA } from './algorithms/gcra';

// ---------------------------------------------------------------------------
// Typed configuration shape expected by the registry factories.
// Mirrors the shape exported by src/config/env.ts.
// ---------------------------------------------------------------------------
export interface RegistryConfig {
  rateLimit: {
    algorithm: AlgorithmType;
    windowSeconds: number;
    limit: number;
    capacity: number;
    refillRate: number;
    ttlSeconds: number;
    leakyBucket: {
      capacity: number;
      leakRate: number;
    };
    gcra: {
      emissionIntervalMs: number;
      burstCapacity: number;
    };
  };
}

type AlgorithmFactory = (config: RegistryConfig) => RateLimiter;

export class AlgorithmRegistry {
  private static readonly registry = new Map<string, AlgorithmFactory>();

  static {
    // Register built-in algorithms
    AlgorithmRegistry.register('token-bucket', (config) => new TokenBucket({
      capacity: config.rateLimit.capacity,
      refillRate: config.rateLimit.refillRate,
      ttlSeconds: config.rateLimit.ttlSeconds,
    }));

    AlgorithmRegistry.register('fixed-window', (config) => new FixedWindow({
      limit: config.rateLimit.limit,
      windowSeconds: config.rateLimit.windowSeconds,
      ttlSeconds: Math.max(config.rateLimit.ttlSeconds, config.rateLimit.windowSeconds * 2),
    }));

    AlgorithmRegistry.register('sliding-window-log', (config) => new SlidingWindowLog({
      limit: config.rateLimit.limit,
      windowSeconds: config.rateLimit.windowSeconds,
      ttlSeconds: Math.max(config.rateLimit.ttlSeconds, config.rateLimit.windowSeconds * 2),
    }));

    AlgorithmRegistry.register('sliding-window-counter', (config) => new SlidingWindowCounter({
      limit: config.rateLimit.limit,
      windowSeconds: config.rateLimit.windowSeconds,
      ttlSeconds: Math.max(config.rateLimit.ttlSeconds, config.rateLimit.windowSeconds * 2),
    }));

    AlgorithmRegistry.register('leaky-bucket', (config) => new LeakyBucket({
      capacity: config.rateLimit.leakyBucket.capacity,
      leakRate: config.rateLimit.leakyBucket.leakRate,
      ttlSeconds: config.rateLimit.ttlSeconds,
    }));

    AlgorithmRegistry.register('gcra', (config) => new GCRA({
      emissionIntervalMs: config.rateLimit.gcra.emissionIntervalMs,
      burstCapacity: config.rateLimit.gcra.burstCapacity,
      ttlSeconds: config.rateLimit.ttlSeconds,
    }));
  }

  static register(name: string, factory: AlgorithmFactory): void {
    AlgorithmRegistry.registry.set(name, factory);
  }

  static resolve(name: string, config: RegistryConfig): RateLimiter {
    const factory = AlgorithmRegistry.registry.get(name);
    if (!factory) {
      throw new Error(`Unknown rate limit algorithm: ${name}`);
    }
    return factory(config);
  }
}
