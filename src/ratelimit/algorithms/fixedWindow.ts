import { RateLimitAlgorithm, RateLimitResult } from "../core/rateLimitAlgorithm"
import { RateLimiterBackend } from "../core/rateLimiterBackend"

export class FixedWindow implements RateLimitAlgorithm {

  constructor(
    private backend: RateLimiterBackend,
    private capacity: number,
    private windowMs: number
  ) {}

  async allowRequest(key: string): Promise<RateLimitResult> {

    const count = await this.backend.increment(
      key,
      this.windowMs
    )

    if (count <= this.capacity) {

      return {
        allowed: true,
        remaining: this.capacity - count
      }
    }

    return {
      allowed: false,
      remaining: 0,
      retryAfter: this.windowMs
    }

  }

}