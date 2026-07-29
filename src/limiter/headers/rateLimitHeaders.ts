import type { Response } from 'express';
import type { RateLimiterResult } from '../types';
import { msToSeconds } from '../utils/timeUtils';

export function setRateLimitHeaders(
  res: Response, 
  result: RateLimiterResult, 
  limit: number
): void {
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', msToSeconds(result.resetAtMs));

  if (!result.allowed) {
    res.setHeader('Retry-After', msToSeconds(result.retryAfterMs));
  }
}
