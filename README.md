# ThrottleX — Distributed Rate Limiting Engine

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-%3E%3D6.0-red.svg)](https://redis.io/)
[![Express](https://img.shields.io/badge/Express-5.x-lightgrey.svg)](https://expressjs.com/)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](#license)

**ThrottleX** is a high-performance, enterprise-grade distributed rate limiting engine built with Node.js, TypeScript, and Redis. It is engineered to solve time-of-check to time-of-use (TOCTOU) race conditions and uneven traffic distribution across horizontally scaled service instances.

---

## ⚡ Key Highlights

- **Atomic Redis Transactions:** Executed entirely via Lua scripts (`EVALSHA` with automatic `NOSCRIPT` reload retry) to ensure zero race conditions across multi-instance deployments without distributed lock overhead.
- **6 Supported Algorithms:** Token Bucket, Fixed Window, Sliding Window Log, Sliding Window Counter, Leaky Bucket, and Generic Cell Rate Algorithm (GCRA).
- **High Throughput & Low Latency:** Benchmarked at **100,000+ RPS per node** with **P99 latencies < 0.5ms**.
- **Advanced Composition:** Built-in support for **Composite Rate Limiters** (evaluating multiple rules sequentially) and **Hierarchical Rate Limiters** (multi-level org/team/user policies).
- **Weighted Requests:** Dynamic cost billing per endpoint (e.g., `GET = 1`, `POST = 5`, `AI Endpoint = 100`).
- **Resilient Failure Separation:** Express middleware cleanly separates rate-limit enforcement (`429 Too Many Requests`) from infrastructure outages (`503 Service Unavailable`).
- **Extensible Architecture:** Decoupled framework layer, core engine, strategy implementations, and storage provider via a central **Algorithm Registry**.

---

## 🏗️ Architecture & Flow

```
Client Request
      │
      ▼
Express Middleware  ─────▶  [ Key Resolution: IP / API Key / User ID ]
      │
      ▼
Algorithm Registry  ─────▶  [ Selects Strategy: TokenBucket | GCRA | ... ]
      │
      ▼
Base Rate Limiter   ─────▶  [ SHA Cached Lua Script Execution ]
      │
      ▼
   Redis Server     ─────▶  [ Atomic Evaluation & State Update ]
      │
      ├──────────────────────┐
   Allowed                Rejected
      │                      │
      ▼                      ▼
  Next / 200            429 + Retry-After Header
```

---

## 📊 Supported Algorithms Comparison

| Algorithm | Redis Data Structure | Memory Overhead | Burst Handling | Best Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **Token Bucket** | Hash (`tokens`, `lastRefillTime`) | $O(1)$ | High (up to capacity) | General API rate limiting with burst allowance. |
| **Fixed Window** | String counter | $O(1)$ | High (window edge burst) | Simple window counts where burst edges are acceptable. |
| **Sliding Window Log** | Sorted Set (ZSET) | $O(N)$ requests | None | Strict precision where window-edge bursts are disallowed. |
| **Sliding Window Counter** | Hash (prev & curr window) | $O(1)$ | Smooth | Memory-efficient sliding window estimation. |
| **Leaky Bucket** | Hash (`level`, `lastUpdateTime`) | $O(1)$ | Smooths traffic | Traffic shaping and outbound request smoothing. |
| **GCRA** | String (`TAT` timestamp) | $O(1)$ | Configurable | High-precision cell-rate scheduling with minimal memory. |

---

## 🚀 Quick Start

### 1. Prerequisites

- **Node.js** `>= 18.x`
- **Redis** `>= 6.0` running locally or accessible via network.

### 2. Environment Setup

Copy `.env.example` to create your local `.env` configuration:

```bash
cp .env.example .env
```

Example `.env` configuration:

```env
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379

# Algorithm selection: token-bucket | fixed-window | sliding-window-log | sliding-window-counter | leaky-bucket | gcra
RATE_LIMIT_ALGORITHM=token-bucket
RATE_LIMIT_CAPACITY=10
RATE_LIMIT_REFILL_RATE=1
RATE_LIMIT_TTL_SECONDS=3600
```

### 3. Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Perform typecheck
npm run typecheck

# Run full test suite (113+ tests across 19 suites)
npm test
```

---

## 💡 Usage Examples

### 1. Express Middleware Usage

```typescript
import express from 'express';
import { rateLimitMiddleware } from './src/middleware/rateLimitMiddleware';

const app = express();

// Protect API routes
app.use('/api', rateLimitMiddleware);

app.get('/api/resource', (req, res) => {
  res.json({ message: 'Access granted' });
});
```

### 2. Programmatic Usage

```typescript
import { TokenBucket } from './src/limiter/algorithms/tokenBucket';

const limiter = new TokenBucket({
  capacity: 10,
  refillRate: 2, // 2 tokens per second
  ttlSeconds: 60,
});

const result = await limiter.consume('throttlex:rl:user:12345');

if (result.allowed) {
  console.log(`Allowed! Remaining tokens: ${result.remaining}`);
} else {
  console.log(`Rate limit exceeded. Retry after ${result.retryAfterMs}ms`);
}
```

### 3. Weighted Requests

```typescript
// Heavy operation costs 5 tokens
const result = await limiter.consume('throttlex:rl:user:12345', 5);
```

### 4. Composite Rate Limiter (Multiple Rules)

```typescript
import { TokenBucket } from './src/limiter/algorithms/tokenBucket';
import { FixedWindow } from './src/limiter/algorithms/fixedWindow';
import { CompositeRateLimiter } from './src/limiter/compositeRateLimiter';

const secondLimiter = new TokenBucket({ capacity: 10, refillRate: 10, ttlSeconds: 60 });
const dayLimiter = new FixedWindow({ limit: 1000, windowSeconds: 86400, ttlSeconds: 172800 });

const composite = new CompositeRateLimiter([secondLimiter, dayLimiter]);

// Checks second rule AND day rule; fails fast if either rule is violated
const result = await composite.consume('throttlex:rl:user:12345');
```

---

## 📈 Benchmarks

Run the built-in benchmarking harness to profile performance under simulated load:

```bash
npm run benchmark
```

### Sample Benchmark Results (25 Concurrent Connections)

```
=================================== ThrottleX Benchmark ===================================

Algorithm                | Requests   | Req/s      | Mean ms    | P50 ms     | P95 ms     | P99 ms     
-------------------------+------------+------------+------------+------------+------------+-----------
token-bucket             | 10,000     | 108,680    | 0.13       | 0.12       | 0.19       | 0.28       
fixed-window             | 10,000     | 130,837    | 0.11       | 0.09       | 0.20       | 0.38       
sliding-window-log       | 10,000     | 100,043    | 0.15       | 0.15       | 0.21       | 0.33       
sliding-window-counter   | 10,000     | 119,731    | 0.13       | 0.12       | 0.17       | 0.29       
leaky-bucket             | 10,000     | 118,425    | 0.13       | 0.13       | 0.18       | 0.28       
gcra                     | 10,000     | 127,780    | 0.12       | 0.12       | 0.17       | 0.25       
-------------------------+------------+------------+------------+------------+------------+-----------
```

---

## 🧪 Testing

The repository features comprehensive quality assurance with **113+ automated tests** across unit, integration, concurrency, boundary, and failure scenarios.

```bash
# Run unit & integration tests
npm test

# Run tests with code coverage report
npm run test:coverage
```

### Coverage Thresholds
- **Statements:** $\ge 80\%$
- **Functions:** $\ge 80\%$
- **Lines:** $\ge 80\%$
- **Branches:** $\ge 75\%$

---

## 📂 Project Structure

```
.
├── benchmarks/              # Benchmark runner & algorithm bench suites
├── context/                 # Architecture docs & phase specs
├── src/
│   ├── config/              # Type-safe environment configuration & validation
│   ├── limiter/
│   │   ├── algorithms/      # TokenBucket, FixedWindow, SlidingWindowLog, SlidingWindowCounter, LeakyBucket, GCRA
│   │   ├── base/            # Shared BaseRateLimiter abstract class with Lua EVALSHA execution
│   │   ├── algorithmRegistry.ts
│   │   ├── compositeRateLimiter.ts
│   │   ├── hierarchicalRateLimiter.ts
│   │   ├── createRateLimiter.ts
│   │   └── types.ts
│   ├── middleware/          # Express middleware (IP resolution, headers, 429/503 handling)
│   ├── redis/               # Singleton ioredis client & key builder
│   ├── routes/              # Express health & test routes
│   └── app.ts               # Express application factory
└── tests/                   # Unit, Integration, Concurrency, Boundary, & Failure test suites
```

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).
