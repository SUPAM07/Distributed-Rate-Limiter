import { RateLimitAlgorithm } from "./rateLimitAlgorithm"
import { RateLimitResult } from "./rateLimitAlgorithm"

export class RateLimiter {

  constructor(
    private algorithm: RateLimitAlgorithm
  ) {}

  async check(key: string): Promise<RateLimitResult> {

    return this.algorithm.allowRequest(key)

  }

}