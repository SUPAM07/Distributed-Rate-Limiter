export function calculateRetryAfterMsForWindow(allowed: boolean, resetAtMs: number, nowMs: number): number {
  return allowed ? 0 : Math.max(0, resetAtMs - nowMs);
}

export function calculateRetryAfterMsForRate(allowed: boolean, neededAmount: number, ratePerSecond: number): number {
  return allowed ? 0 : Math.ceil((neededAmount / ratePerSecond) * 1000);
}
