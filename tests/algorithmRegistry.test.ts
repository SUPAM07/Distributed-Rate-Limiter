import { AlgorithmRegistry, type RegistryConfig } from '../src/limiter/algorithmRegistry';
import { TokenBucket } from '../src/limiter/algorithms/tokenBucket';
import { FixedWindow } from '../src/limiter/algorithms/fixedWindow';
import { SlidingWindowLog } from '../src/limiter/algorithms/slidingWindowLog';
import { SlidingWindowCounter } from '../src/limiter/algorithms/slidingWindowCounter';
import { LeakyBucket } from '../src/limiter/algorithms/leakyBucket';
import { GCRA } from '../src/limiter/algorithms/gcra';

const baseConfig: RegistryConfig = {
  rateLimit: {
    algorithm: 'token-bucket',
    capacity: 10,
    refillRate: 1,
    limit: 10,
    windowSeconds: 60,
    ttlSeconds: 3600,
    leakyBucket: { capacity: 10, leakRate: 1 },
    gcra: { emissionIntervalMs: 100, burstCapacity: 10 },
  },
};

describe('AlgorithmRegistry — resolution', () => {
  it('resolves token-bucket to TokenBucket', () => {
    expect(AlgorithmRegistry.resolve('token-bucket', baseConfig)).toBeInstanceOf(TokenBucket);
  });
  it('resolves fixed-window to FixedWindow', () => {
    expect(AlgorithmRegistry.resolve('fixed-window', baseConfig)).toBeInstanceOf(FixedWindow);
  });
  it('resolves sliding-window-log to SlidingWindowLog', () => {
    expect(AlgorithmRegistry.resolve('sliding-window-log', baseConfig)).toBeInstanceOf(SlidingWindowLog);
  });
  it('resolves sliding-window-counter to SlidingWindowCounter', () => {
    expect(AlgorithmRegistry.resolve('sliding-window-counter', baseConfig)).toBeInstanceOf(SlidingWindowCounter);
  });
  it('resolves leaky-bucket to LeakyBucket', () => {
    expect(AlgorithmRegistry.resolve('leaky-bucket', baseConfig)).toBeInstanceOf(LeakyBucket);
  });
  it('resolves gcra to GCRA', () => {
    expect(AlgorithmRegistry.resolve('gcra', baseConfig)).toBeInstanceOf(GCRA);
  });
  it('throws for unknown algorithm', () => {
    expect(() => AlgorithmRegistry.resolve('unknown', baseConfig)).toThrow('Unknown rate limit algorithm: unknown');
  });
});

describe('AlgorithmRegistry — custom registration', () => {
  it('allows registering and resolving a custom algorithm', () => {
    const mockLimiter = { consume: jest.fn() };
    AlgorithmRegistry.register('custom-test', () => mockLimiter);
    const resolved = AlgorithmRegistry.resolve('custom-test', baseConfig);
    expect(resolved).toBe(mockLimiter);
  });
});
