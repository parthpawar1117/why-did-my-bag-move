/**
 * Live mode: re-explain the bag on a timer with fresh CMC data.
 *
 * Credit budget: live quotes/market data are cached ~60 s and history/sectors
 * ~1 h on the server, so each refresh costs about 3-5 credits. Refreshing every
 * 2 minutes, pausing while the tab is hidden, and stopping after 10 minutes
 * caps one live session at roughly 25 credits.
 */
export const LIVE_INTERVAL_MS = 2 * 60_000;
export const LIVE_MAX_MS = 10 * 60_000;

export type LiveStep = "off" | "paused" | "wait" | "refresh" | "expired";

export function liveStep(s: { enabled: boolean; hidden: boolean; busy: boolean; startedAt: number; lastRunAt: number; now: number }): LiveStep {
  if (!s.enabled) return "off";
  if (s.now - s.startedAt >= LIVE_MAX_MS) return "expired";
  if (s.hidden) return "paused";
  if (s.busy) return "wait";
  return s.now - s.lastRunAt >= LIVE_INTERVAL_MS ? "refresh" : "wait";
}

/** Minimum gap between any two requests from one page, so rapid clicking cannot hammer the API. */
export const MIN_REQUEST_GAP_MS = 2_000;

/**
 * When may the page send its next request? `cooldownUntil` comes from a 429's
 * Retry-After header. Returns 0 if it may send now, otherwise ms to wait.
 */
export function waitBeforeRequest(s: { now: number; lastRequestAt: number; cooldownUntil: number }): number {
  return Math.max(0, s.cooldownUntil - s.now, s.lastRequestAt + MIN_REQUEST_GAP_MS - s.now);
}

/** Retry-After header (seconds) to milliseconds; defaults to 60 s if missing or invalid. */
export function retryAfterMs(header: string | null): number {
  const sec = Number(header);
  return Number.isFinite(sec) && sec > 0 ? Math.min(sec, 600) * 1000 : 60_000;
}

export function formatAgo(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s ago`;
}
