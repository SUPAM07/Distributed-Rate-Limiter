# Phase 1 — Core Rate Limiter Foundation

## 1. Overview

Phase 1 establishes the core foundation of **ThrottleX**, a Redis-backed distributed rate-limiting system.

The primary goal of this phase was to build one complete rate-limiting path from an incoming HTTP request to an atomic rate-limit decision stored in Redis.

The implemented request flow is:

```text
Client Request
      │
      ▼
Express HTTP Server
      │
      ▼
Rate-Limit Middleware
      │
      ├── Resolve Client Identifier
      ├── Generate Redis Key
      │
      ▼
Token Bucket Limiter
      │
      ▼
Redis Lua Script
      │
      ├── Read Bucket State
      ├── Calculate Token Refill
      ├── Check Available Tokens
      ├── Consume Token
      ├── Update State
      └── Refresh TTL
      │
      ▼
RateLimiterResult
      │
   ┌──┴─────────────┐
   │                │
Allowed          Rejected
   │                │
 200              429

Redis unavailable → 503
```

The phase intentionally implements only the **Token Bucket** algorithm while establishing abstractions that allow additional algorithms to be introduced in later phases.

---

# 2. Technology Stack

The Phase 1 backend uses:

* Node.js
* TypeScript
* Express
* Redis
* ioredis
* Redis Lua scripting
* Jest
* ts-jest
* Supertest
* dotenv

TypeScript strict mode is enabled to maintain strong type safety across the codebase.

---

# 3. Project Structure

The Phase 1 implementation follows a modular structure:

```text
RATE_LIMITER/
├── src/
│   ├── config/
│   │   └── env.ts
│   │
│   ├── redis/
│   │   ├── client.ts
│   │   └── keys.ts
│   │
│   ├── limiter/
│   │   ├── types.ts
│   │   └── algorithms/
│   │       └── tokenBucket.ts
│   │
│   ├── middleware/
│   │   └── rateLimitMiddleware.ts
│   │
│   ├── routes/
│   │   ├── health.ts
│   │   └── test.ts
│   │
│   ├── app.ts
│   └── server.ts
│
├── tests/
│   └── tokenBucket.test.ts
│
├── .env.example
├── package.json
├── tsconfig.json
└── jest.config.ts
```

Each layer has a clearly separated responsibility.

---

# 4. Configuration Layer

## `src/config/env.ts`

Environment configuration is centralized instead of reading `process.env` throughout the application.

Configuration includes:

```text
PORT
REDIS_HOST
REDIS_PORT
REDIS_PASSWORD

RATE_LIMIT_CAPACITY
RATE_LIMIT_REFILL_RATE
RATE_LIMIT_WINDOW_SECONDS
RATE_LIMIT_TTL_SECONDS
```

Example configuration:

```env
PORT=3000

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

RATE_LIMIT_CAPACITY=10
RATE_LIMIT_REFILL_RATE=1
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_TTL_SECONDS=3600
```

The configuration layer exposes typed values to the rest of the application.

This keeps infrastructure and rate-limit configuration separate from business logic.

---

# 5. Redis Integration

## `src/redis/client.ts`

A centralized Redis client is implemented using `ioredis`.

The Redis layer is responsible for:

* creating the Redis connection
* reusing a shared Redis client
* handling connection events
* logging connection state
* handling Redis errors
* closing the connection during graceful shutdown

Observed startup events include:

```text
redis.connect
redis.ready
```

This confirms that the application can establish and initialize its Redis dependency successfully.

The shared client prevents individual modules from creating unnecessary independent Redis connections.

---

# 6. Redis Key Strategy

## `src/redis/keys.ts`

Rate-limit keys are generated through a centralized key-building function.

The namespace follows:

```text
throttlex:rl:{identifier}
```

Example:

```text
throttlex:rl:127.0.0.1
```

The purpose of centralized key generation is to:

* prevent inconsistent key formats
* avoid key collisions
* provide a clear namespace
* make future algorithm-specific key strategies easier to introduce

The client identifier is currently derived from the request IP.

The key-resolution mechanism can later be extended to support:

* API keys
* authenticated user IDs
* tenant IDs
* route-specific identifiers
* composite identifiers

---

# 7. Rate Limiter Abstraction

## `src/limiter/types.ts`

The core limiter is separated from HTTP-specific behavior through a common contract.

Conceptually:

```typescript
interface RateLimiterResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
  retryAfterMs: number;
}

interface RateLimiter {
  consume(key: string): Promise<RateLimiterResult>;
}
```

The result communicates:

### `allowed`

Whether the current request is permitted.

### `remaining`

The remaining rate-limit capacity after processing the request.

### `resetAtMs`

Timestamp representing bucket reset/refill information.

### `retryAfterMs`

How long a rejected client should wait before another request can be accepted.

This abstraction allows the HTTP layer to remain independent from the underlying algorithm.

Future implementations can follow the same contract:

```text
RateLimiter
    │
    ├── TokenBucket
    ├── FixedWindow
    ├── SlidingWindow
    ├── LeakyBucket
    └── CompositeLimiter
```

This is an important architectural foundation for later phases.

---

# 8. Token Bucket Algorithm

## `src/limiter/algorithms/tokenBucket.ts`

Phase 1 implements the **Token Bucket** algorithm.

Each bucket is configured with:

```text
capacity
refillRate
ttlSeconds
```

Conceptually, a bucket contains:

```text
tokens
lastRefillTime
```

A request consumes one token.

If at least one token is available:

```text
tokens >= 1

→ consume token
→ allow request
```

If insufficient tokens are available:

```text
tokens < 1

→ reject request
→ calculate retry time
```

Tokens refill according to elapsed time.

Conceptually:

```text
elapsedTime = currentTime - lastRefillTime

refilledTokens =
    elapsedTime × refillRate

availableTokens =
    min(capacity, currentTokens + refilledTokens)
```

This means no background refill worker is required.

Refill is calculated lazily whenever the bucket is accessed.

---

# 9. Atomic Redis Lua Execution

The most important distributed-system property implemented in Phase 1 is **atomic rate-limit state mutation**.

A naive implementation could perform:

```text
GET bucket
     ↓
Calculate refill
     ↓
Check tokens
     ↓
Consume
     ↓
SET bucket
```

This is unsafe under concurrency.

Two application instances could read the same state before either writes its update.

Example race:

```text
Bucket = 1 token

Server A reads → 1
Server B reads → 1

Server A allows request
Server B allows request

Result:

2 requests allowed using 1 token
```

ThrottleX avoids this race by executing the complete state transition inside a single Redis Lua script.

The operation is effectively:

```text
Read bucket state
        ↓
Determine current timestamp
        ↓
Calculate elapsed time
        ↓
Refill available tokens
        ↓
Clamp tokens to capacity
        ↓
Check whether token is available
        ↓
Consume if allowed
        ↓
Update token count
        ↓
Update refill timestamp
        ↓
Refresh key TTL
        ↓
Return decision
```

Redis executes Lua scripts atomically.

Therefore, concurrent application instances cannot interleave the internal bucket state transition.

This provides the core correctness guarantee required for distributed rate limiting.

---

# 10. Redis TTL Management

Every active bucket receives an expiration time.

Conceptually:

```text
throttlex:rl:{identifier}
        │
        └── TTL
```

The TTL is refreshed as part of the atomic Lua operation.

This prevents abandoned rate-limit keys from remaining in Redis indefinitely.

Without TTL cleanup, high-cardinality identifiers could continuously accumulate:

```text
User 1
User 2
User 3
...
User 10,000,000
```

leading to unnecessary Redis memory growth.

Phase 1 tests verify that limiter keys receive a positive TTL.

---

# 11. Rate-Limit Middleware

## `src/middleware/rateLimitMiddleware.ts`

The HTTP middleware connects Express with the core limiter.

The flow is:

```text
Incoming Request
       │
       ▼
Resolve Identifier
       │
       ▼
Generate Redis Key
       │
       ▼
TokenBucket.consume()
       │
       ▼
RateLimiterResult
       │
  ┌────┴────┐
  ▼         ▼
Allow     Reject
  │         │
next()     429
```

The middleware does not implement Token Bucket mathematics directly.

This keeps responsibilities separated:

```text
HTTP concerns
    ↓
Middleware

Algorithm logic
    ↓
Limiter

Atomic state
    ↓
Redis + Lua
```

---

# 12. Rate-Limit Headers

Successful rate-limited responses expose metadata through HTTP headers.

Example:

```text
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: <timestamp>
```

When a request exceeds the limit, the response also includes:

```text
Retry-After: <seconds>
```

These headers allow clients to understand:

* configured capacity
* remaining capacity
* reset/refill timing
* when to retry after rejection

---

# 13. HTTP Status Semantics

ThrottleX distinguishes between a client exceeding its limit and the rate-limiting infrastructure being unavailable.

## Allowed request

```text
HTTP 200
```

Example:

```json
{
  "message": "Request accepted",
  "ts": "<timestamp>"
}
```

---

## Rate limit exceeded

```text
HTTP 429 Too Many Requests
```

This means:

```text
Rate limiter operational
+
Client exceeded configured capacity
```

---

## Redis unavailable

```text
HTTP 503 Service Unavailable
```

Example:

```json
{
  "error": "Service temporarily unavailable",
  "code": "RATE_LIMITER_UNAVAILABLE"
}
```

This means:

```text
Rate-limiting infrastructure unavailable
```

It is intentionally different from `429`.

Therefore:

```text
429 = valid rate-limit rejection

503 = infrastructure failure
```

Phase 1 currently follows a fail-closed strategy when Redis is unavailable.

---

# 14. Health Endpoint

## `GET /health`

A health endpoint is provided to verify application availability.

Expected successful response:

```text
HTTP 200
```

with service health information and timestamp.

The health flow also verifies Redis connectivity according to the Phase 1 implementation.

This provides a basic operational endpoint for validating the application and its dependency.

---

# 15. Protected Test Endpoint

## `GET /api/test`

A test route is protected by the rate-limit middleware.

Complete execution flow:

```text
GET /api/test
      │
      ▼
rateLimitMiddleware
      │
      ▼
Resolve req.ip
      │
      ▼
buildRateLimitKey()
      │
      ▼
TokenBucket.consume()
      │
      ▼
Redis Lua Script
      │
      ▼
Decision
   ┌──┴───┐
   ▼      ▼
 200     429
```

This endpoint provides an end-to-end verification path for the entire Phase 1 architecture.

---

# 16. Application Setup

## `src/app.ts`

The application module is responsible for:

* creating the Express application
* configuring middleware
* mounting health routes
* mounting protected API routes

Application construction is kept separate from server startup.

This separation improves testability because Jest/Supertest can use the Express application without necessarily starting a real network listener.

---

# 17. Server Lifecycle

## `src/server.ts`

The server layer handles:

* application startup
* HTTP listener initialization
* Redis initialization
* `SIGINT`
* `SIGTERM`
* graceful HTTP shutdown
* Redis connection cleanup

The intended shutdown sequence is:

```text
Shutdown Signal
      │
      ▼
Stop accepting new HTTP traffic
      │
      ▼
Close HTTP server
      │
      ▼
Close Redis connection
      │
      ▼
Exit process
```

This prevents abrupt resource termination during normal shutdown.

---

# 18. Automated Testing

Phase 1 includes a Jest test suite covering the core correctness properties.

Command:

```bash
npm test
```

Verified result:

```text
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

The following behavior is tested.

---

## 18.1 Health Endpoint

Verified:

```text
GET /health → 200
```

The endpoint correctly reports healthy service state.

---

## 18.2 HTTP Rate-Limit Integration

Verified that:

```text
GET /api/test
```

returns:

```text
200
+
rate-limit headers
```

when the bucket has available capacity.

---

## 18.3 Requests Within Capacity

For a configured bucket capacity:

```text
CAPACITY = N
```

the first `N` requests are allowed.

Remaining capacity decreases correctly.

---

## 18.4 Bucket Exhaustion

The test verifies:

```text
Requests 1..N
    ↓
Allowed

Request N+1
    ↓
Rejected
```

The limiter does not allow requests beyond configured capacity when no refill is available.

---

## 18.5 HTTP 429

After exhaustion:

```text
GET /api/test
```

correctly returns:

```text
429 Too Many Requests
```

This validates the complete path from Redis decision to HTTP response.

---

# 19. Boundary Testing

A bucket configured with:

```text
capacity = 1
```

was tested.

Expected:

```text
Request 1 → allowed
Request 2 → rejected
```

The test passed.

This verifies correct behavior at the smallest meaningful capacity boundary.

---

# 20. Token Refill Testing

The test suite verifies that exhausted buckets regain capacity over time.

Flow:

```text
Consume available tokens
        ↓
Bucket exhausted
        ↓
Request rejected
        ↓
Time passes
        ↓
Elapsed-time refill calculated
        ↓
Token becomes available
        ↓
Request allowed
```

The refill test passed successfully.

This confirms that refill calculations work without requiring a background process.

---

# 21. Concurrency and Atomicity Testing

Concurrency correctness is one of the most important requirements of Phase 1.

The test suite executes multiple `consume()` calls in parallel against the same bucket.

Conceptually:

```text
Promise.all([
    consume(key),
    consume(key),
    consume(key),
    ...
])
```

The test verifies:

```text
Allowed requests <= bucket capacity
```

even when many requests execute concurrently.

The following tests passed:

```text
parallel consume() calls never allow more than CAPACITY requests

allowed counts reported are monotonically non-increasing remaining
```

This provides evidence that the Lua-based state transition prevents race-condition over-consumption.

---

# 22. Redis TTL Testing

The test suite verifies that rate-limit keys have an expiration.

Expected:

```text
TTL > 0
```

This test passed.

Therefore inactive bucket keys can eventually be removed automatically by Redis.

---

# 23. TypeScript Verification

The project was checked using:

```bash
npx tsc --noEmit
```

The command completed without errors.

Result:

```text
TypeScript compilation: PASS
```

This confirms that the Phase 1 codebase passes static type checking.

---

# 24. Manual Redis Failure Test

Redis failure behavior was manually verified.

With Redis running:

```bash
curl -i http://localhost:3000/api/test
```

returned:

```text
HTTP/1.1 200 OK

X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: <timestamp>
```

The response body was:

```json
{
  "message": "Request accepted",
  "ts": "<timestamp>"
}
```

Redis was then stopped while the ThrottleX application remained running.

After Redis became unavailable:

```bash
curl -i http://localhost:3000/api/test
```

returned:

```text
HTTP/1.1 503 Service Unavailable
```

with:

```json
{
  "error": "Service temporarily unavailable",
  "code": "RATE_LIMITER_UNAVAILABLE"
}
```

This confirms that:

1. ThrottleX remains capable of returning a controlled HTTP response when Redis fails.
2. Redis infrastructure failure is not incorrectly returned as `429`.
3. The application follows the intended fail-closed behavior.

---

# 25. Phase 1 Verification Summary

| Requirement                      | Status |
| -------------------------------- | ------ |
| Node.js + TypeScript foundation  | PASS   |
| Strict TypeScript compilation    | PASS   |
| Express HTTP server              | PASS   |
| Environment configuration        | PASS   |
| Redis integration                | PASS   |
| Centralized Redis key generation | PASS   |
| RateLimiter abstraction          | PASS   |
| Token Bucket algorithm           | PASS   |
| Redis-backed bucket state        | PASS   |
| Atomic Lua execution             | PASS   |
| Rate-limit middleware            | PASS   |
| `/health` endpoint               | PASS   |
| `/api/test` protected endpoint   | PASS   |
| Rate-limit response headers      | PASS   |
| `429` on limit exhaustion        | PASS   |
| Token refill                     | PASS   |
| Boundary behavior                | PASS   |
| Concurrent atomic consumption    | PASS   |
| Redis key TTL                    | PASS   |
| Redis failure → `503`            | PASS   |
| Graceful lifecycle foundation    | PASS   |

Automated verification:

```text
10 / 10 tests passed
```

Type verification:

```text
npx tsc --noEmit
PASS
```

Manual infrastructure-failure verification:

```text
Redis UP   → 200
Redis DOWN → 503
PASS
```

---

# 26. Phase 1 Architectural Result

At the end of Phase 1, ThrottleX provides the following architecture:

```text
                     ┌────────────────────┐
                     │       Client       │
                     └─────────┬──────────┘
                               │
                               ▼
                     ┌────────────────────┐
                     │   Express Server   │
                     └─────────┬──────────┘
                               │
                               ▼
                  ┌──────────────────────────┐
                  │ Rate-Limit Middleware    │
                  │                          │
                  │ Resolve identifier       │
                  │ Generate Redis key       │
                  └────────────┬─────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │    RateLimiter      │
                    │      Contract       │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │    Token Bucket     │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Redis Lua Script    │
                    │                     │
                    │ Refill              │
                    │ Check               │
                    │ Consume             │
                    │ Persist             │
                    │ TTL                 │
                    └──────────┬──────────┘
                               │
                               ▼
                        ┌─────────────┐
                        │    Redis    │
                        └─────────────┘

Decision:

Allowed              → 200 + rate-limit headers
Limit exceeded       → 429 + Retry-After
Redis unavailable    → 503 RATE_LIMITER_UNAVAILABLE
```

---

# 27. Key Design Decisions

## Redis as Shared State

Rate-limit state is stored outside the application process.

This allows the architecture to support multiple application instances sharing the same limiter state.

---

## Lua for Atomicity

The complete Token Bucket state transition executes atomically in Redis.

This prevents race conditions caused by separate read/write operations.

---

## Algorithm Abstraction

The `RateLimiter` contract separates algorithm implementation from HTTP middleware.

This allows future algorithms to be introduced without redesigning the request pipeline.

---

## TTL-Based Cleanup

Inactive rate-limit buckets expire automatically.

This prevents unlimited accumulation of stale Redis keys.

---

## Fail-Closed Infrastructure Policy

When Redis is unavailable, protected requests return:

```text
503 Service Unavailable
```

rather than bypassing the limiter.

This preserves rate-limit enforcement guarantees during dependency failure.

---

## HTTP and Algorithm Separation

The Token Bucket implementation does not directly depend on Express request or response objects.

The architecture remains:

```text
HTTP Layer
    ↓
Rate-Limit Abstraction
    ↓
Algorithm
    ↓
Redis
```

This improves maintainability, testing, and extensibility.

---

# 28. Deferred Features

The following features are intentionally outside Phase 1:

* Fixed Window algorithm
* Sliding Window algorithm
* Leaky Bucket algorithm
* Composite rate limiting
* per-route policies
* API-key/user/tenant policies
* dynamic configuration
* adaptive rate limiting
* anomaly detection
* Prometheus metrics
* Grafana dashboards
* admin dashboard
* advanced analytics
* benchmarking
* Redis Cluster
* advanced high-availability infrastructure

These capabilities should be implemented incrementally in later phases.

---

# 29. Phase 1 Completion State

Phase 1 successfully establishes the minimum distributed rate-limiter foundation:

```text
HTTP Request
      ↓
Rate-Limit Middleware
      ↓
Common Limiter Contract
      ↓
Token Bucket
      ↓
Atomic Redis Lua Execution
      ↓
Shared Redis State
      ↓
200 / 429 / 503
```

The implementation has been validated through:

* static TypeScript checking
* automated HTTP tests
* Token Bucket correctness tests
* boundary testing
* refill testing
* concurrency testing
* atomicity verification
* Redis TTL verification
* manual Redis failure testing

The core architecture is now ready to be extended in subsequent phases without redesigning the Phase 1 request-processing foundation.
