# Phase 2 — Multi-Algorithm Rate Limiting Engine

## 1. Overview

Phase 2 expands the **ThrottleX** core foundation established in Phase 1 into a multi-algorithm rate-limiting engine. 

While Phase 1 supported only the Token Bucket algorithm, Phase 2 introduces three additional core rate-limiting strategies:
* **Fixed Window**
* **Sliding Window Log**
* **Sliding Window Counter**

Phase 2 also introduces the **Rate Limiter Factory** (`createRateLimiter`), which decouples algorithm instantiation from Express middleware. The middleware can now enforce rate limits dynamically based on environment configuration without changing its code or signature.

The updated architecture and request flow:

```text
Client Request
      │
      ▼
Express HTTP Server
      │
      ▼
Rate-Limit Middleware
      │
      ├── Resolve Identifier (IP)
      ├── Read Environment Config (RATE_LIMIT_ALGORITHM)
      ├── Build Key: throttlex:rl:{algorithm}:{identifier}
      │
      ▼
RateLimiter Factory (createRateLimiter)
      │
      ├── Token Bucket Strategy
      ├── Fixed Window Strategy
      ├── Sliding Window Log Strategy
      └── Sliding Window Counter Strategy
      │
      ▼
Redis Lua Script (Atomic State Transition per Algorithm)
      │
      ▼
RateLimiterResult (allowed, remaining, resetAtMs, retryAfterMs)
      │
   ┌──┴─────────────┐
   │                │
Allowed          Rejected
   │                │
 200              429

Redis unavailable → 503
```

---

## 2. Technology Stack & Key Changes

Phase 2 continues to build upon the Phase 1 tech stack while introducing:
* **Redis Sorted Sets (ZSET):** Used by Sliding Window Log for precise timestamp tracking.
* **Redis Hashes (HMGET / HSET / HINCRBY):** Used by Sliding Window Counter to manage previous and current window counts.
* **Algorithm Factory Pattern:** Centralized instantiation of rate limiters.
* **Algorithm-Namespaced Keys:** Prevention of key collision across different algorithm strategies.

---

## 3. Project Structure Updates

The project directory structure after Phase 2:

```text
RATE_LIMITER/
├── src/
│   ├── config/
│   │   └── env.ts                      # Updated with RATE_LIMIT_ALGORITHM & window options
│   ├── redis/
│   │   ├── client.ts
│   │   └── keys.ts                     # Key format: throttlex:rl:{algorithm}:{identifier}
│   ├── limiter/
│   │   ├── types.ts
│   │   ├── createRateLimiter.ts        # [NEW] Factory for rate limiters
│   │   └── algorithms/
│   │       ├── tokenBucket.ts
│   │       ├── fixedWindow.ts          # [NEW] Fixed Window implementation
│   │       ├── slidingWindowLog.ts     # [NEW] Sliding Window Log implementation
│   │       └── slidingWindowCounter.ts # [NEW] Sliding Window Counter implementation
│   ├── middleware/
│   │   └── rateLimitMiddleware.ts      # Refactored to use generic RateLimiter factory
│   ├── routes/
│   │   ├── health.ts
│   │   └── test.ts
│   ├── app.ts
│   └── server.ts
├── tests/
│   ├── tokenBucket.test.ts
│   ├── fixedWindow.test.ts             # [NEW] Fixed Window tests
│   ├── slidingWindowLog.test.ts        # [NEW] Sliding Window Log tests
│   ├── slidingWindowCounter.test.ts    # [NEW] Sliding Window Counter tests
│   └── rateLimiterFactory.test.ts      # [NEW] Factory unit tests
└── package.json
```

---

## 4. Environment & Configuration Extensions

### `src/config/env.ts`

Phase 2 extends environment parsing to validate algorithm types and window parameters:

```typescript
export type AlgorithmType = 
  | 'token-bucket' 
  | 'fixed-window' 
  | 'sliding-window-log' 
  | 'sliding-window-counter';
```

Added environment variables:

```env
# Selected algorithm
RATE_LIMIT_ALGORITHM=token-bucket

# Window configuration (for fixed-window, sliding-window-log, sliding-window-counter)
RATE_LIMIT_LIMIT=10
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_TTL_SECONDS=3600
```

Validation rules:
* `RATE_LIMIT_ALGORITHM` must be one of the four supported strings.
* `RATE_LIMIT_LIMIT` must be a positive integer.
* `RATE_LIMIT_WINDOW_SECONDS` must be a positive integer.

---

## 5. Centralized Key Namespacing

### `src/redis/keys.ts`

To prevent key collisions when switching algorithms or running multiple algorithms against the same Redis cluster, Phase 2 updates the key builder format:

```text
throttlex:rl:{algorithm}:{identifier}
```

Example generated keys:
* `throttlex:rl:token-bucket:127.0.0.1`
* `throttlex:rl:fixed-window:127.0.0.1`
* `throttlex:rl:sliding-window-log:127.0.0.1`
* `throttlex:rl:sliding-window-counter:127.0.0.1`

---

## 6. Rate Limiter Factory Pattern

### `src/limiter/createRateLimiter.ts`

The Rate Limiter Factory reads `config.rateLimit.algorithm` and instantiates the appropriate class implementing the common `RateLimiter` interface.

```typescript
export function createRateLimiter(): RateLimiter {
  switch (config.rateLimit.algorithm) {
    case 'token-bucket':
      return new TokenBucket(...);
    case 'fixed-window':
      return new FixedWindow(...);
    case 'sliding-window-log':
      return new SlidingWindowLog(...);
    case 'sliding-window-counter':
      return new SlidingWindowCounter(...);
    default:
      throw new Error(`Unknown rate limit algorithm: ${config.rateLimit.algorithm}`);
  }
}
```

This decouples HTTP middleware logic completely from algorithm-specific dependencies.

---

## 7. Phase 2 Algorithm Implementations & Lua Scripts

All Phase 2 algorithms maintain the strict Phase 1 requirement: **All state transitions must be 100% atomic inside Redis Lua scripts.**

---

### 7.1 Fixed Window Algorithm

#### Implementation: `src/limiter/algorithms/fixedWindow.ts`

The Fixed Window algorithm divides time into fixed intervals (e.g. 60 seconds). A counter in Redis tracks requests within the current window boundary.

* **Window Key:** `throttlex:rl:fixed-window:{identifier}:{windowStartTimestamp}`
* **Redis Operation:** `GET`, `INCRBY`, `EXPIRE`

#### Atomic Lua Script:

```lua
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local count = tonumber(redis.call('GET', key) or "0")

if count + 1 <= limit then
  count = redis.call('INCRBY', key, 1)
  if count == 1 then
    redis.call('EXPIRE', key, ttl)
  end
  return { 1, limit - count }
else
  return { 0, math.max(0, limit - count) }
end
```

#### Evaluation:
* **Pros:** $O(1)$ memory and execution time; extremely simple.
* **Cons:** Suffer from traffic bursts at window boundaries (up to $2 \times limit$ within a boundary transition).

---

### 7.2 Sliding Window Log Algorithm

#### Implementation: `src/limiter/algorithms/slidingWindowLog.ts`

The Sliding Window Log algorithm stores timestamps of all individual requests in a Redis Sorted Set (ZSET).

* **Redis Key:** `throttlex:rl:sliding-window-log:{identifier}`
* **Sorted Set Member:** `<timestamp>-<uuid>`
* **Sorted Set Score:** `<timestamp>`

#### Atomic Lua Script:

```lua
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local windowStart = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local memberId = ARGV[5]

-- Remove timestamps outside the sliding window
redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

local count = tonumber(redis.call('ZCARD', key) or "0")

if count + 1 <= limit then
  redis.call('ZADD', key, now, memberId)
  redis.call('EXPIRE', key, ttl)
  return { 1, limit - count - 1 }
else
  return { 0, math.max(0, limit - count) }
end
```

#### Evaluation:
* **Pros:** Perfectly smooth precision with no window-boundary burst leakage.
* **Cons:** $O(N)$ memory usage proportional to the request count within the window.

---

### 7.3 Sliding Window Counter Algorithm

#### Implementation: `src/limiter/algorithms/slidingWindowCounter.ts`

The Sliding Window Counter combines the memory efficiency of Fixed Window with the precision of Sliding Window Log by maintaining request counts for the current and previous fixed windows in a Redis Hash.

* **Redis Key:** `throttlex:rl:sliding-window-counter:{identifier}`
* **Hash Fields:** `previousWindowStartMs`, `currentWindowStartMs`

#### Mathematical Formula:

$$\text{Estimated Count} = \text{Count}_{\text{prev}} \times \left( \frac{\text{WindowMs} - \text{ElapsedInCurrent}}{\text{WindowMs}} \right) + \text{Count}_{\text{curr}}$$

#### Atomic Lua Script:

```lua
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local currStart = ARGV[3]
local prevStart = ARGV[4]
local windowMs = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])

local counts = redis.call('HMGET', key, prevStart, currStart)
local prevCount = tonumber(counts[1]) or 0
local currCount = tonumber(counts[2]) or 0

local elapsedInCurrent = now - tonumber(currStart)
local weightFactor = math.max(0, (windowMs - elapsedInCurrent) / windowMs)
local estimatedCount = (prevCount * weightFactor) + currCount

if estimatedCount + 1 <= limit then
  currCount = redis.call('HINCRBY', key, currStart, 1)
  redis.call('EXPIRE', key, ttl)
  return { 1, math.max(0, limit - math.floor(estimatedCount + 1)) }
else
  return { 0, math.max(0, limit - math.floor(estimatedCount)) }
end
```

#### Evaluation:
* **Pros:** $O(1)$ memory usage with smooth sliding window approximation (99%+ accurate in practice).
* **Cons:** Minor approximation error assuming traffic in the previous window was evenly distributed.

---

## 8. Verification & Test Suite

Phase 2 introduces automated unit and integration tests across 5 test suites.

Command:

```bash
npm test
```

Verification Result:

```text
PASS tests/fixedWindow.test.ts
PASS tests/slidingWindowLog.test.ts
PASS tests/slidingWindowCounter.test.ts
PASS tests/tokenBucket.test.ts
PASS tests/rateLimiterFactory.test.ts

Test Suites: 5 passed, 5 total
Tests:       25 passed, 25 total
```

### Verified Properties:
1. **Fixed Window:** Exact limit enforcement within window; reset after boundary; atomic concurrent execution.
2. **Sliding Window Log:** Individual request removal over time; ZSET creation with TTL; strict precision.
3. **Sliding Window Counter:** Decaying previous window weight calculation; $O(1)$ Hash persistence; boundary correctness.
4. **Rate Limiter Factory:** Instantiates correct class based on config; throws on unsupported algorithm string.

---

## 9. Phase 2 Completion State

Phase 2 transforms ThrottleX into a multi-algorithm rate-limiting engine with 25 passing test suites and strict TypeScript validation. Middleware remains algorithm-agnostic while supporting four distinct algorithms via configuration.
