import { buildRateLimitKey } from '../../src/redis/keys';

describe('buildRateLimitKey', () => {
  it('namespaces identical identifiers by algorithm', () => {
    const identifier = '127.0.0.1';

    const keys = [
      buildRateLimitKey('token-bucket', identifier),
      buildRateLimitKey('fixed-window', identifier),
      buildRateLimitKey('sliding-window-log', identifier),
      buildRateLimitKey('sliding-window-counter', identifier),
    ];

    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toContain('token-bucket');
    expect(keys[1]).toContain('fixed-window');
    expect(keys[2]).toContain('sliding-window-log');
    expect(keys[3]).toContain('sliding-window-counter');
  });

  it('produces stable keys for the same algorithm and identifier', () => {
    expect(buildRateLimitKey('fixed-window', 'client-a'))
      .toBe(buildRateLimitKey('fixed-window', 'client-a'));
  });

  it('produces different keys for different identifiers', () => {
    expect(buildRateLimitKey('fixed-window', 'client-a'))
      .not.toBe(buildRateLimitKey('fixed-window', 'client-b'));
  });
});
