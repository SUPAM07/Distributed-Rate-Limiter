export interface RateLimitResult {
    allowed: boolean
    remaining: number
    retryAfter?: number
  }
  
  export interface RateLimitAlgorithm {
  
    allowRequest(
      key: string
    ): Promise<RateLimitResult>
  
  }