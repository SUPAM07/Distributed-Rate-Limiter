import { RateLimitAlgorithm, RateLimitResult } from "../core/rateLimitAlgorithm"
import { RateLimiterBackend } from "../core/rateLimiterBackend"

interface CounterState {
  currentWindowStart: number
  currentCount: number
  previousCount: number
}

export class SlidingWindowCounter implements RateLimitAlgorithm {

  constructor(
    private backend: RateLimiterBackend,
    private capacity: number,
    private windowMs: number
  ) {}

  async allowRequest(key: string): Promise<RateLimitResult> {

    const now = Date.now()

    let state: CounterState = await this.backend.get(key)

    if (!state) {
      state = {
        currentWindowStart: now,
        currentCount: 0,
        previousCount: 0
      }
    }

    const elapsed = now - state.currentWindowStart

    if (elapsed >= this.windowMs) {

      const windowsPassed = Math.floor(elapsed / this.windowMs)

      if (windowsPassed === 1) {
        state.previousCount = state.currentCount
      } else {
        state.previousCount = 0
      }

      state.currentCount = 0
      state.currentWindowStart = now
    }


    const weight = (this.windowMs - (now - state.currentWindowStart)) / this.windowMs

    const effectiveCount =
      state.currentCount + state.previousCount * weight

    if (effectiveCount >= this.capacity) {

      return {
        allowed: false,
        remaining: 0,
        retryAfter: this.windowMs - (now - state.currentWindowStart)
      }
    }

    state.currentCount++

    await this.backend.set(key, state)

    return {
      allowed: true,
      remaining: Math.max(0, this.capacity - Math.floor(effectiveCount))
    }

  }

}