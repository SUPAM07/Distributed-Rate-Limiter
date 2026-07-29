/**
 * ThrottleX Benchmark Runner
 *
 * Runs performance benchmarks for all supported rate-limiting algorithms
 * and prints a comparison table to stdout.
 *
 * Usage: npm run benchmark
 */
import os from 'os';
import { execSync } from 'child_process';
import Redis from 'ioredis';
import { TokenBucket } from '../src/limiter/algorithms/tokenBucket';
import { FixedWindow } from '../src/limiter/algorithms/fixedWindow';
import { SlidingWindowLog } from '../src/limiter/algorithms/slidingWindowLog';
import { SlidingWindowCounter } from '../src/limiter/algorithms/slidingWindowCounter';
import { LeakyBucket } from '../src/limiter/algorithms/leakyBucket';
import { GCRA } from '../src/limiter/algorithms/gcra';
import { runBenchmark, type BenchmarkResult } from './tokenBucket.bench';

// ---------------------------------------------------------------------------
// System info
// ---------------------------------------------------------------------------
function getRedisVersion(): string {
  try {
    const out = execSync('redis-cli --version', { encoding: 'utf8' }).trim();
    return out;
  } catch {
    return 'unknown';
  }
}

function printSystemInfo() {
  console.log('\n=== ThrottleX Benchmark Runner ===\n');
  console.log(`Node.js:      ${process.version}`);
  console.log(`OS:           ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`CPUs:         ${os.cpus().length}× ${os.cpus()[0]?.model ?? 'unknown'}`);
  console.log(`Memory:       ${Math.round(os.totalmem() / 1024 / 1024)} MB`);
  console.log(`Redis:        ${getRedisVersion()}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Benchmark scenarios
// ---------------------------------------------------------------------------
const SCENARIOS = [
  { name: 'token-bucket',          factory: () => new TokenBucket({ capacity: 100_000, refillRate: 100_000, ttlSeconds: 3600 }) },
  { name: 'fixed-window',          factory: () => new FixedWindow({ limit: 100_000, windowSeconds: 3600, ttlSeconds: 7200 }) },
  { name: 'sliding-window-log',    factory: () => new SlidingWindowLog({ limit: 100_000, windowSeconds: 3600, ttlSeconds: 7200 }) },
  { name: 'sliding-window-counter', factory: () => new SlidingWindowCounter({ limit: 100_000, windowSeconds: 3600, ttlSeconds: 7200 }) },
  { name: 'leaky-bucket',          factory: () => new LeakyBucket({ capacity: 100_000, leakRate: 100_000, ttlSeconds: 3600 }) },
  { name: 'gcra',                  factory: () => new GCRA({ emissionIntervalMs: 1, burstCapacity: 100_000, ttlSeconds: 3600 }) },
];

const targetArg = process.argv[2];
const concurrencyArg = process.argv[3];
const REQUEST_COUNTS = targetArg ? [parseInt(targetArg, 10)] : [1_000, 10_000, 100_000];
const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg, 10) : 50;


// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------
function printTable(results: BenchmarkResult[]) {
  const cols = [
    { key: 'algorithm',       label: 'Algorithm',           width: 24 },
    { key: 'totalRequests',   label: 'Requests',            width: 10 },
    { key: 'requestsPerSec',  label: 'Req/s',               width: 10 },
    { key: 'meanLatencyMs',   label: 'Mean ms',             width: 10 },
    { key: 'p50LatencyMs',    label: 'P50 ms',              width: 10 },
    { key: 'p95LatencyMs',    label: 'P95 ms',              width: 10 },
    { key: 'p99LatencyMs',    label: 'P99 ms',              width: 10 },
    { key: 'admitted',        label: 'Admitted',            width: 10 },
    { key: 'rejected',        label: 'Rejected',            width: 10 },
  ] as const;

  const sep = cols.map((c) => '-'.repeat(c.width)).join('-+-');
  const header = cols.map((c) => c.label.padEnd(c.width)).join(' | ');

  console.log('\n' + sep);
  console.log(header);
  console.log(sep);

  for (const r of results) {
    const row = cols.map((c) => {
      const val = r[c.key as keyof BenchmarkResult];
      const str = typeof val === 'number' ? Number(val.toFixed(2)).toString() : String(val);
      return str.padEnd(c.width);
    }).join(' | ');
    console.log(row);
  }
  console.log(sep + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  printSystemInfo();

  const redis = new Redis();
  const allResults: BenchmarkResult[] = [];

  for (const count of REQUEST_COUNTS) {
    console.log(`\n--- Running ${count.toLocaleString()} requests per algorithm ---`);
    for (const scenario of SCENARIOS) {
      process.stdout.write(`  Benchmarking ${scenario.name} @ ${count.toLocaleString()} requests... `);
      const limiter = scenario.factory();
      const result = await runBenchmark(scenario.name, limiter, count, CONCURRENCY);
      allResults.push(result);
      console.log(`${result.requestsPerSec} req/s  (P99 ${result.p99LatencyMs.toFixed(1)}ms)`);
    }
  }

  printTable(allResults);

  await redis.quit();
  console.log('Benchmark complete.\n');
}

main().catch((err) => {
  console.error('Benchmark runner failed:', err);
  process.exit(1);
});
