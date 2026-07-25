import { HierarchicalRateLimiter } from '../src/limiter/hierarchicalRateLimiter';
import type { RateLimiter, RateLimiterResult } from '../src/limiter/types';

describe('HierarchicalRateLimiter', () => {
  it('throws if no limiters provided', () => {
    expect(() => new HierarchicalRateLimiter([])).toThrow(/requires at least one/);
  });

  it('throws if number of keys does not match limiters', async () => {
    const l1: RateLimiter = { consume: jest.fn() };
    const h = new HierarchicalRateLimiter([l1, l1]);
    await expect(h.consume(['key1'])).rejects.toThrow(/expected 2 keys, but got 1/);
  });

  it('allows request if all levels allow', async () => {
    const mockAllow = { allowed: true, remaining: 100, resetAtMs: 100, retryAfterMs: 0 };
    const orgLimiter: RateLimiter = { consume: jest.fn().mockResolvedValue(mockAllow) };
    const userLimiter: RateLimiter = { consume: jest.fn().mockResolvedValue({ ...mockAllow, remaining: 10, resetAtMs: 200 }) };
    
    const hierarchical = new HierarchicalRateLimiter([orgLimiter, userLimiter]);
    const result = await hierarchical.consume(['org-abc', 'user-123'], 1);
    
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
    expect(result.resetAtMs).toBe(200);
    
    expect(orgLimiter.consume).toHaveBeenCalledWith('org-abc', 1);
    expect(userLimiter.consume).toHaveBeenCalledWith('user-123', 1);
  });

  it('rejects and halts if a parent level rejects', async () => {
    const mockAllow = { allowed: true, remaining: 10, resetAtMs: 100, retryAfterMs: 0 };
    const mockReject = { allowed: false, remaining: 0, resetAtMs: 500, retryAfterMs: 400 };
    
    const orgLimiter: RateLimiter = { consume: jest.fn().mockResolvedValue(mockReject) };
    const userLimiter: RateLimiter = { consume: jest.fn().mockResolvedValue(mockAllow) };
    
    const hierarchical = new HierarchicalRateLimiter([orgLimiter, userLimiter]);
    const result = await hierarchical.consume(['org-xyz', 'user-456']);
    
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(400);
    
    expect(orgLimiter.consume).toHaveBeenCalledWith('org-xyz', 1);
    expect(userLimiter.consume).not.toHaveBeenCalled(); // Fast fail
  });
});
