import { SlidingWindowLog } from '../src/limiter/algorithms/slidingWindowLog';
import { runBenchmark } from './tokenBucket.bench';
import type { BenchmarkResult } from './tokenBucket.bench';

export async function runSlidingWindowLogBenchmark(totalRequests: number): Promise<BenchmarkResult> {
  const limiter = new SlidingWindowLog({ limit: totalRequests, windowSeconds: 3600, ttlSeconds: 7200 });
  return runBenchmark('sliding-window-log', limiter, totalRequests);
}
