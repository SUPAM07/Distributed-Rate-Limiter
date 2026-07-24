import { createRateLimiter } from '../src/limiter/createRateLimiter';
import { TokenBucket } from '../src/limiter/algorithms/tokenBucket';
import { FixedWindow } from '../src/limiter/algorithms/fixedWindow';
import { SlidingWindowLog } from '../src/limiter/algorithms/slidingWindowLog';
import { SlidingWindowCounter } from '../src/limiter/algorithms/slidingWindowCounter';
import { config, AlgorithmType } from '../src/config/env';

// We need to mock the config module to test different algorithms
jest.mock('../src/config/env', () => {
  const original = jest.requireActual('../src/config/env');
  return {
    ...original,
    config: {
      ...original.config,
      rateLimit: {
        ...original.config.rateLimit,
        algorithm: 'token-bucket', // default for mock
      },
    },
  };
});

describe('createRateLimiter', () => {
  const setAlgorithm = (algo: AlgorithmType | string) => {
    (config.rateLimit as any).algorithm = algo;
  };

  afterEach(() => {
    setAlgorithm('token-bucket');
  });

  it('creates a TokenBucket when configured', () => {
    setAlgorithm('token-bucket');
    const limiter = createRateLimiter();
    expect(limiter).toBeInstanceOf(TokenBucket);
  });

  it('creates a FixedWindow when configured', () => {
    setAlgorithm('fixed-window');
    const limiter = createRateLimiter();
    expect(limiter).toBeInstanceOf(FixedWindow);
  });

  it('creates a SlidingWindowLog when configured', () => {
    setAlgorithm('sliding-window-log');
    const limiter = createRateLimiter();
    expect(limiter).toBeInstanceOf(SlidingWindowLog);
  });

  it('creates a SlidingWindowCounter when configured', () => {
    setAlgorithm('sliding-window-counter');
    const limiter = createRateLimiter();
    expect(limiter).toBeInstanceOf(SlidingWindowCounter);
  });

  it('throws an error for unknown algorithms', () => {
    setAlgorithm('unknown-algo' as any);
    expect(() => createRateLimiter()).toThrow(/Unknown rate limit algorithm/);
  });
});
