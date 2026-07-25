# Phase 3 — Advanced Rate Limiting Algorithms & Composition

## 1. Overview

Phase 3 extends the **ThrottleX** rate-limiting engine with advanced algorithms, composition limiters, weighted request costs, and architecture refactoring.

The primary achievements of Phase 3 include:
* **Two New Algorithms:** Leaky Bucket and Generic Cell Rate Algorithm (GCRA).
* **Composition Limiters:** `CompositeRateLimiter` (multi-rule evaluation) and `HierarchicalRateLimiter` (nested org/team/user limits).
* **Weighted Requests:** Support for consuming variable token amounts per request (`weight` parameter).
* **Algorithm Registry:** Centralized resolution of rate-limiting strategies.
* **Shared `BaseRateLimiter`:** Unified abstract base class for Redis client management and atomic Lua script execution (`EVALSHA` with `NOSCRIPT` retry fallback).

The updated architecture and flow:

```text
Client Request (weight = N)
      │
      ▼
Express HTTP Server
      │
      ▼
Rate-Limit Middleware / Composite / Hierarchical Limiter
      │
      ├── Resolve Identifier (IP / Org / User)
      ├── Resolve Strategy via AlgorithmRegistry
      │
      ▼
BaseRateLimiter (evalScript)
      │
      ├── Cached SHA Execution (EVALSHA)
      ├── Fallback to SCRIPT LOAD on NOSCRIPT error
      │
      ▼
Redis Lua Script (Atomic State Mutation)
      │
      ├── Check Capacity vs Weight
      ├── Deduct Weight or Reject
      ├── Persist Updated State
      └── Refresh TTL
      │
      ▼
RateLimiterResult (allowed, remaining, resetAtMs, retryAfterMs)
      │
   ┌──┴─────────────┐
   │                │
Allowed          Rejected
   │                │
 200              429
```

---

## 2. Technology Stack & Key Additions

Phase 3 introduces the following core technical capabilities:
* **Abstract Class Inheritance (`BaseRateLimiter`):** Reduces duplicated Redis/Lua execution logic.
* **Dynamic Weight Consumption:** All 6 algorithms accept a request cost/weight.
* **Registry Pattern (`AlgorithmRegistry`):** Eliminates `switch`-statement branching.
* **Theoretical Arrival Time (TAT) Calculation:** Microsecond-precision GCRA implementation.

---

## 3. Project Structure Updates

The updated directory structure in Phase 3:

```text
RATE_LIMITER/
├── src/
│   ├── config/
│   │   └── env.ts                      # Updated with leakyBucket & gcra configs
│   ├── redis/
│   │   ├── client.ts
│   │   └── keys.ts
│   ├── limiter/
│   │   ├── types.ts                    # Updated RateLimiter interface (weight & key arrays)
│   │   ├── algorithmRegistry.ts        # [NEW] Centralized strategy registry
│   │   ├── compositeRateLimiter.ts     # [NEW] Multi-rule composite rate limiter
│   │   ├── hierarchicalRateLimiter.ts  # [NEW] Nested hierarchical rate limiter
│   │   ├── createRateLimiter.ts        # Refactored to use AlgorithmRegistry
│   │   ├── base/
│   │   │   └── baseRateLimiter.ts      # [NEW] Shared abstract base class for Lua
│   │   └── algorithms/
│   │       ├── tokenBucket.ts          # Extends BaseRateLimiter + weight support
│   │       ├── fixedWindow.ts          # Extends BaseRateLimiter + weight support
│   │       ├── slidingWindowLog.ts     # Extends BaseRateLimiter + weight support
│   │       ├── slidingWindowCounter.ts # Extends BaseRateLimiter + weight support
│   │       ├── leakyBucket.ts          # [NEW] Leaky Bucket implementation
│   │       └── gcra.ts                 # [NEW] GCRA implementation
│   ├── middleware/
│   │   └── rateLimitMiddleware.ts
│   └── app.ts
├── tests/
│   ├── leakyBucket.test.ts             # [NEW]
│   ├── gcra.test.ts                    # [NEW]
│   ├── compositeRateLimiter.test.ts    # [NEW]
│   ├── hierarchicalRateLimiter.test.ts # [NEW]
│   ├── weightedRequests.test.ts        # [NEW]
│   └── algorithmRegistry.test.ts       # [NEW]
└── package.json
```

---

## 4. Shared `BaseRateLimiter` Architecture

### `src/limiter/base/baseRateLimiter.ts`

To DRY up Redis evaluation logic across all strategy classes, Phase 3 introduces the abstract `BaseRateLimiter` class.

Key responsibilities:
1. Reuses the singleton ioredis client.
2. Manages script SHA caching (`this.scriptSha`).
3. Executes Lua scripts via `evalsha`.
4. Catches `NOSCRIPT` errors (e.g. following a Redis restart), automatically reloading the script via `SCRIPT LOAD` and retrying execution.

```typescript
export abstract class BaseRateLimiter {
  protected readonly redis: Redis;
  private scriptSha: string | null = null;
  protected abstract readonly LUA_SCRIPT: string;

  constructor() {
    this.redis = getRedisClient();
  }

  protected async evalScript<T = unknown>(numKeys: number, args: (string | number)[]): Promise<T> {
    // SHA caching + NOSCRIPT retry fallback implementation
  }
}
```

---

## 5. Interface Extensions (Weighted Requests)

### `src/limiter/types.ts`

The `RateLimiter` interface was updated to accept an optional `weight` parameter and support array-based keys for hierarchical limiters:

```typescript
export interface RateLimiter {
  consume(key: string | string[], weight?: number): Promise<RateLimiterResult>;
}
```

Every algorithm implementation defaults `weight` to `1` when omitted.

---

## 6. Advanced Algorithm Implementations

### 6.1 Leaky Bucket Algorithm

#### Implementation: `src/limiter/algorithms/leakyBucket.ts`

The Leaky Bucket algorithm models traffic as water leaking out of a bucket at a constant rate. Requests add volume to the bucket. If the bucket level exceeds capacity, subsequent requests are rejected.

* **Redis Key:** `throttlex:rl:leaky-bucket:{identifier}`
* **Redis Fields:** `level` (current volume), `lastUpdateTime` (Unix timestamp ms)

#### Atomic Lua Script:

```lua
local key       = KEYS[1]
local capacity  = tonumber(ARGV[1])
local leakRate  = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local ttl       = tonumber(ARGV[4])
local weight    = tonumber(ARGV[5])

local raw = redis.call('HMGET', key, 'level', 'lastUpdateTime')
local level          = tonumber(raw[1]) or 0
local lastUpdateTime = tonumber(raw[2]) or now

local elapsedSeconds = (now - lastUpdateTime) / 1000
local leaked = elapsedSeconds * leakRate
level = math.max(0, level - leaked)

if level + weight <= capacity then
  level = level + weight
  redis.call('HSET', key, 'level', tostring(level), 'lastUpdateTime', tostring(now))
  redis.call('EXPIRE', key, ttl)
  return { 1, capacity - math.ceil(level) }
else
  redis.call('HSET', key, 'level', tostring(level), 'lastUpdateTime', tostring(now))
  redis.call('EXPIRE', key, ttl)
  return { 0, capacity - math.ceil(level) }
end
```

---

### 6.2 Generic Cell Rate Algorithm (GCRA)

#### Implementation: `src/limiter/algorithms/gcra.ts`

GCRA models rate limiting using **Theoretical Arrival Time (TAT)**. It tracks the time when the next cell/request is theoretically allowed to arrive.

* **Redis Key:** `throttlex:rl:gcra:{identifier}`
* **Redis Value:** `TAT` (timestamp in milliseconds)
* **Emission Interval ($T$):** Time between requests (`1 / rate`).
* **Burst Tolerance ($\tau$):** `emissionIntervalMs * burstCapacity`.

#### Mathematical Rule:

$$\text{limitTime} = \text{now} + \tau$$

$$\text{newTAT} = \max(\text{now}, \text{TAT}) + (\text{weight} \times T)$$

If $\text{newTAT} \le \text{limitTime}$, the request is allowed and $\text{newTAT}$ is saved to Redis.

#### Atomic Lua Script:

```lua
local key              = KEYS[1]
local emissionInterval = tonumber(ARGV[1])
local burstTolerance   = tonumber(ARGV[2])
local now              = tonumber(ARGV[3])
local ttl              = tonumber(ARGV[4])
local weight           = tonumber(ARGV[5])

local tat = tonumber(redis.call('GET', key) or "0")
if tat < now then tat = now end

local increment = weight * emissionInterval
local newTat = tat + increment
local limitTime = now + burstTolerance

if newTat <= limitTime then
  redis.call('SET', key, tostring(newTat), 'EX', ttl)
  return { 1, math.floor((limitTime - newTat) / emissionInterval), newTat, 0 }
else
  local retryAfterMs = newTat - limitTime
  return { 0, math.floor((limitTime - tat) / emissionInterval), tat, retryAfterMs }
end
```

---

## 7. Composition & Hierarchy Limiters

### 7.1 Composite Rate Limiter

#### Implementation: `src/limiter/compositeRateLimiter.ts`

Evaluates an array of independent `RateLimiter` instances sequentially.
* Evaluates Rule 1, Rule 2, ..., Rule N.
* **Fast-Fail Semantics:** If any rule fails (`allowed === false`), the composite limiter immediately returns the rejection without checking remaining rules.
* If all rules pass, it aggregates `remaining` as `min(remaining_i)` and `resetAtMs` as `max(resetAtMs_i)`.

### 7.2 Hierarchical Rate Limiter

#### Implementation: `src/limiter/hierarchicalRateLimiter.ts`

Supports multi-tier nested policy enforcement (e.g. `[OrgLimiter, TeamLimiter, UserLimiter]`).
* Accepts an array of matching keys `[orgKey, teamKey, userKey]`.
* Evaluates parent limits first. If the parent (e.g. Organization level) is exhausted, child limit evaluation is skipped entirely.

---

## 8. Algorithm Registry

### `src/limiter/algorithmRegistry.ts`

The `AlgorithmRegistry` provides a centralized map of algorithm names to factory functions.

```typescript
export class AlgorithmRegistry {
  private static readonly registry = new Map<string, AlgorithmFactory>();

  static register(name: string, factory: AlgorithmFactory): void;
  static resolve(name: string, config: RegistryConfig): RateLimiter;
}
```

Registered strategies:
* `token-bucket`
* `fixed-window`
* `sliding-window-log`
* `sliding-window-counter`
* `leaky-bucket`
* `gcra`

Custom rate-limiting algorithms can be dynamically registered at runtime without modifying core engine files.

---

## 9. Verification & Test Suite

Phase 3 expands the automated test suite to 47 passing tests across 12 test suites.

Command:

```bash
npm test
```

Test Results:

```text
PASS tests/leakyBucket.test.ts
PASS tests/gcra.test.ts
PASS tests/compositeRateLimiter.test.ts
PASS tests/hierarchicalRateLimiter.test.ts
PASS tests/weightedRequests.test.ts
PASS tests/algorithmRegistry.test.ts
PASS tests/tokenBucket.test.ts
PASS tests/fixedWindow.test.ts
PASS tests/slidingWindowLog.test.ts
PASS tests/slidingWindowCounter.test.ts
PASS tests/rateLimiterFactory.test.ts
PASS tests/rateLimitKeys.test.ts

Test Suites: 12 passed, 12 total
Tests:       47 passed, 47 total
```

### Key Verification Highlights:
1. **Weighted Requests:** Verified across all algorithms that a request with `weight = 5` deducts 5 capacity units atomically.
2. **Leaky Bucket:** Verified capacity drain, burst smoothing, and constant leak timing.
3. **GCRA:** Verified TAT calculation, burst tolerance limit, and constant-memory overhead.
4. **Composition & Hierarchy:** Verified fast-fail early exit on parent rejection and rule isolation.
