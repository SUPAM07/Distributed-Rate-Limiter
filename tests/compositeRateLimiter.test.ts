import { CompositeRateLimiter } from '../src/limiter/compositeRateLimiter';
import type { RateLimiter } from '../src/limiter/types';

describe('CompositeRateLimiter', () => {
  it('throws if no limiters provided', () => {
    expect(() => new CompositeRateLimiter([])).toThrow(/requires at least one/);
  });

  it('allows request if all limiters allow', async () => {
    const mockAllow = { allowed: true, remaining: 10, resetAtMs: 100, retryAfterMs: 0 };
    const l1: RateLimiter = { consume: jest.fn().mockResolvedValue(mockAllow) };
    const l2: RateLimiter = { consume: jest.fn().mockResolvedValue({ ...mockAllow, remaining: 5, resetAtMs: 200 }) };
    
    const composite = new CompositeRateLimiter([l1, l2]);
    const result = await composite.consume('test-key', 2);
    
    expect(result.allowed).toBe(true);
    // Should return the minimum remaining and maximum resetAtMs
    expect(result.remaining).toBe(5);
    expect(result.resetAtMs).toBe(200);
    
    // Each limiter should be called with a suffixed key
    expect(l1.consume).toHaveBeenCalledWith('test-key:composite:0', 2);
    expect(l2.consume).toHaveBeenCalledWith('test-key:composite:1', 2);
  });

  it('rejects immediately on first rejection', async () => {
    const mockAllow = { allowed: true, remaining: 10, resetAtMs: 100, retryAfterMs: 0 };
    const mockReject = { allowed: false, remaining: 0, resetAtMs: 500, retryAfterMs: 400 };
    
    const l1: RateLimiter = { consume: jest.fn().mockResolvedValue(mockAllow) };
    const l2: RateLimiter = { consume: jest.fn().mockResolvedValue(mockReject) };
    const l3: RateLimiter = { consume: jest.fn().mockResolvedValue(mockAllow) };
    
    const composite = new CompositeRateLimiter([l1, l2, l3]);
    const result = await composite.consume('test-key');
    
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(400);
    
    expect(l1.consume).toHaveBeenCalled();
    expect(l2.consume).toHaveBeenCalled();
    expect(l3.consume).not.toHaveBeenCalled(); // Fast fail
  });
});
