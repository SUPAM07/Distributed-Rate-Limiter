import { RateLimitConfigurationError } from '../../errors/RateLimiterError';

export function requirePositiveNumber(value: number, name: string, context: string): void {
  if (value <= 0) {
    throw new RateLimitConfigurationError(`${context}: ${name} must be > 0`);
  }
}

export function requireGreaterThanOrEqual(value: number, min: number, name: string, minName: string, context: string): void {
  if (value < min) {
    throw new RateLimitConfigurationError(`${context}: ${name} must be >= ${minName}`);
  }
}
