export class RateLimiterError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class RateLimitConfigurationError extends RateLimiterError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT_CONFIG_ERROR');
  }
}

export class RateLimitRedisError extends RateLimiterError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT_REDIS_ERROR');
  }
}

export class RateLimitExecutionError extends RateLimiterError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT_EXECUTION_ERROR');
  }
}
