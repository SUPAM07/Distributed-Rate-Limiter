import { buildRateLimitKey } from '../../src/redis/keys';

describe('buildRateLimitKey', () => {
  it('formats key correctly', () => {
    expect(buildRateLimitKey('token-bucket', '127.0.0.1')).toBe('throttlex:rl:token-bucket:127.0.0.1');
  });

  it('throws for empty algorithm', () => {
    expect(() => buildRateLimitKey('', 'user-1')).toThrow('non-empty string');
  });

  it('throws for blank algorithm (whitespace only)', () => {
    expect(() => buildRateLimitKey('   ', 'user-1')).toThrow('non-empty string');
  });

  it('throws for empty identifier', () => {
    expect(() => buildRateLimitKey('token-bucket', '')).toThrow('non-empty string');
  });

  it('throws for blank identifier', () => {
    expect(() => buildRateLimitKey('token-bucket', '   ')).toThrow('non-empty string');
  });

  it('produces different keys for different algorithms', () => {
    const k1 = buildRateLimitKey('token-bucket', 'user-1');
    const k2 = buildRateLimitKey('fixed-window', 'user-1');
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different identifiers', () => {
    const k1 = buildRateLimitKey('token-bucket', 'user-1');
    const k2 = buildRateLimitKey('token-bucket', 'user-2');
    expect(k1).not.toBe(k2);
  });
});
