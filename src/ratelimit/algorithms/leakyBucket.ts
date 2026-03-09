import { RateLimitAlgorithm, RateLimitResult } from "../core/rateLimitAlgorithm"
import { RateLimiterBackend } from "../core/rateLimiterBackend"

interface BucketState {
  water: number
  lastLeak: number
}


export class LeakyBucket implements RateLimitAlgorithm {

  constructor(
    private backend: RateLimiterBackend,
    private capacity: number,
    private leakRate: number
  ) {}

  async allowRequest(key: string): Promise<RateLimitResult> {

    const now = Date.now()

    const bucket = await this.backend.update<BucketState>(key, (state) => {

      if (!state) {
        return {
          water: 1,
          lastLeak: now
        }
      }

      const elapsed = (now - state.lastLeak) / 1000

      const leaked = elapsed * this.leakRate

      state.water = Math.max(0, state.water - leaked)

      state.lastLeak = now

      if (state.water < this.capacity) {
        state.water += 1
      }

      return state

    })

    if (bucket.water > this.capacity) {

      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil(1 / this.leakRate)
      }

    }

    return {
      allowed: true,
      remaining: Math.max(0, this.capacity - Math.floor(bucket.water))
    }

  }

}