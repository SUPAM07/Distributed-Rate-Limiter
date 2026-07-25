import { SlidingWindowCounter } from '../src/limiter/algorithms/slidingWindowCounter';
import { runBenchmark } from './tokenBucket.bench';
import type { BenchmarkResult } from './tokenBucket.bench';

export async function runSlidingWindowCounterBenchmark(totalRequests: number): Promise<BenchmarkResult> {
  const limiter = new SlidingWindowCounter({ limit: totalRequests, windowSeconds: 3600, ttlSeconds: 7200 });
  return runBenchmark('sliding-window-counter', limiter, totalRequests);
}
