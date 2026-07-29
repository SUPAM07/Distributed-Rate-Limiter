export function msToSeconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

export function alignToWindow(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}
