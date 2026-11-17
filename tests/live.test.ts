import { describe, expect, it } from "vitest";
import { formatAgo, LIVE_INTERVAL_MS, LIVE_MAX_MS, liveStep, MIN_REQUEST_GAP_MS, retryAfterMs, waitBeforeRequest } from "@/web/live";

const base = { enabled: true, hidden: false, busy: false, startedAt: 0, lastRunAt: 0 };

describe("liveStep", () => {
  it("waits until the refresh interval has passed, then refreshes", () => {
    expect(liveStep({ ...base, now: LIVE_INTERVAL_MS - 1 })).toBe("wait");
    expect(liveStep({ ...base, now: LIVE_INTERVAL_MS })).toBe("refresh");
  });

  it("does nothing when live mode is off", () => {
    expect(liveStep({ ...base, enabled: false, now: LIVE_INTERVAL_MS * 3 })).toBe("off");
  });

  it("pauses while the tab is hidden, to save credits", () => {
    expect(liveStep({ ...base, hidden: true, now: LIVE_INTERVAL_MS * 2 })).toBe("paused");
  });

  it("never overlaps a request that is still running", () => {
    expect(liveStep({ ...base, busy: true, now: LIVE_INTERVAL_MS * 2 })).toBe("wait");
  });

  it("stops automatically after the maximum live duration", () => {
    expect(liveStep({ ...base, lastRunAt: LIVE_MAX_MS - 1000, now: LIVE_MAX_MS })).toBe("expired");
  });

  it("refreshes every 2 minutes for at most 10 minutes", () => {
    expect(LIVE_INTERVAL_MS).toBe(120_000);
    expect(LIVE_MAX_MS).toBe(600_000);
  });
});

describe("waitBeforeRequest", () => {
  it("allows a request when there is no cooldown and the last one was long ago", () => {
    expect(waitBeforeRequest({ now: 10_000, lastRequestAt: 0, cooldownUntil: 0 })).toBe(0);
  });

  it("enforces a minimum gap between requests", () => {
    expect(waitBeforeRequest({ now: 1_500, lastRequestAt: 1_000, cooldownUntil: 0 })).toBe(MIN_REQUEST_GAP_MS - 500);
  });

  it("waits out a server cooldown after a 429", () => {
    expect(waitBeforeRequest({ now: 5_000, lastRequestAt: 0, cooldownUntil: 35_000 })).toBe(30_000);
  });
});

describe("retryAfterMs", () => {
  it("reads the Retry-After header and falls back to 60 s", () => {
    expect(retryAfterMs("31")).toBe(31_000);
    expect(retryAfterMs(null)).toBe(60_000);
    expect(retryAfterMs("soon")).toBe(60_000);
    expect(retryAfterMs("99999")).toBe(600_000);
  });
});

describe("formatAgo", () => {
  it("says how long ago the data was updated", () => {
    expect(formatAgo(0)).toBe("just now");
    expect(formatAgo(4_000)).toBe("just now");
    expect(formatAgo(20_400)).toBe("20s ago");
    expect(formatAgo(125_000)).toBe("2m 5s ago");
  });
});
