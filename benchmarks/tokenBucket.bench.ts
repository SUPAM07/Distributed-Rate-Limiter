import Redis from 'ioredis';
import { buildRateLimitKey } from '../src/redis/keys';
import { TokenBucket } from '../src/limiter/algorithms/tokenBucket';
import type { RateLimiter } from '../src/limiter/types';

const RUN_ID = `bench-tb-${Date.now()}`;
const redis = new Redis();

async function cleanup() {
  await redis.quit();
}

export interface BenchmarkResult {
  algorithm: string;
  totalRequests: number;
  durationMs: number;
  requestsPerSec: number;
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  admitted: number;
  rejected: number;
}

export async function runBenchmark(
  algorithm: string,
  limiter: RateLimiter,
  totalRequests: number,
  concurrency = 10,
): Promise<BenchmarkResult> {
  const key = buildRateLimitKey(algorithm, `${RUN_ID}-${totalRequests}`);
  const latencies: number[] = [];
  let admitted = 0;
  let rejected = 0;

  const start = performance.now();

  // Process in batches of `concurrency`
  for (let sent = 0; sent < totalRequests; sent += concurrency) {
    const batch = Math.min(concurrency, totalRequests - sent);
    const results = await Promise.all(
      Array.from({ length: batch }, async () => {
        const t0 = performance.now();
        const result = await limiter.consume(key);
        const t1 = performance.now();
        latencies.push(t1 - t0);
        return result;
      }),
    );
    for (const r of results) {
      if (r.allowed) admitted++;
      else rejected++;
    }
  }

  const durationMs = performance.now() - start;

  latencies.sort((a, b) => a - b);
  const percentile = (p: number) => latencies[Math.floor(latencies.length * (p / 100))] ?? 0;

  return {
    algorithm,
    totalRequests,
    durationMs,
    requestsPerSec: Math.round((totalRequests / durationMs) * 1000),
    meanLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p50LatencyMs: percentile(50),
    p95LatencyMs: percentile(95),
    p99LatencyMs: percentile(99),
    admitted,
    rejected,
  };
}

if (require.main === module) {
  (async () => {
    const limiter = new TokenBucket({ capacity: 100, refillRate: 1000, ttlSeconds: 3600 });
    const result = await runBenchmark('token-bucket', limiter, 1000);
    console.log(result);
    await cleanup();
  })().catch(console.error);
}
