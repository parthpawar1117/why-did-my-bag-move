/**
 * Simple fixed-window rate limiter kept in memory. Protects the CMC credit
 * budget and the 50 calls/minute Basic limit from a single busy visitor.
 * (In-memory is per server instance; good enough for a demo deployment.)
 */
export interface RateLimiter {
  check(key: string): { ok: true } | { ok: false; retryAfterSec: number };
}

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    check(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= opts.windowMs) {
        if (windows.size > 10_000) windows.clear(); // bound memory
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= opts.limit) return { ok: false, retryAfterSec: Math.ceil((w.start + opts.windowMs - t) / 1000) };
      w.count += 1;
      return { ok: true };
    },
  };
}
