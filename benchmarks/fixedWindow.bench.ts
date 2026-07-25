import { buildRateLimitKey } from '../src/redis/keys';
import { FixedWindow } from '../src/limiter/algorithms/fixedWindow';
import { runBenchmark } from './tokenBucket.bench';
import type { BenchmarkResult } from './tokenBucket.bench';

const RUN_ID = `bench-fw-${Date.now()}`;

export async function runFixedWindowBenchmark(totalRequests: number): Promise<BenchmarkResult> {
  const limiter = new FixedWindow({ limit: totalRequests, windowSeconds: 3600, ttlSeconds: 7200 });
  return runBenchmark('fixed-window', limiter, totalRequests);
}
