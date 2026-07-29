import { createRateLimiter } from '../../src/limiter/createRateLimiter';
import { TokenBucket } from '../../src/limiter/algorithms/tokenBucket';
import { FixedWindow } from '../../src/limiter/algorithms/fixedWindow';
import { SlidingWindowLog } from '../../src/limiter/algorithms/slidingWindowLog';
import { SlidingWindowCounter } from '../../src/limiter/algorithms/slidingWindowCounter';
import { config, AlgorithmType } from '../../src/config/env';

jest.mock('../../src/config/env', () => {
  const original = jest.requireActual('../../src/config/env');
  return {
    ...original,
    config: {
      ...original.config,
      rateLimit: {
        ...original.config.rateLimit,
        algorithm: 'token-bucket',
      },
    },
  };
});

describe('createRateLimiter', () => {
  function setAlgorithm(algorithm: AlgorithmType | string): void {
    (config.rateLimit as { algorithm: string }).algorithm = algorithm;
  }

  afterEach(() => {
    setAlgorithm('token-bucket');
  });

  it.each([
    ['token-bucket', TokenBucket],
    ['fixed-window', FixedWindow],
    ['sliding-window-log', SlidingWindowLog],
    ['sliding-window-counter', SlidingWindowCounter],
  ] as const)('creates %s', (algorithm, ExpectedClass) => {
    setAlgorithm(algorithm);
    expect(createRateLimiter()).toBeInstanceOf(ExpectedClass);
  });

  it('throws for an unknown algorithm instead of silently falling back', () => {
    setAlgorithm('unknown-algo');
    expect(() => createRateLimiter()).toThrow(/Unknown rate limit algorithm/i);
  });
});
