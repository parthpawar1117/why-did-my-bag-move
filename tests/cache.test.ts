import { describe, expect, it, vi } from "vitest";
import { createCachedClient, defaultTtlMs } from "@/cmc/cache";
import { CmcError, createCmcClient, EvidenceLedger, type FetchLike } from "@/cmc/client";

const TEST_KEY = ["test", "key", "not", "real", "0000"].join("-");

function ok(data: unknown, credits = 1): Response {
  return new Response(JSON.stringify({ status: { timestamp: "2026-11-17T12:00:00.000Z", error_code: "0", credit_count: credits }, data }), {
    status: 200,
  });
}

function fail(httpStatus: number, errorCode: number): Response {
  return new Response(JSON.stringify({ status: { error_code: errorCode, error_message: `error ${errorCode}`, credit_count: 0 } }), {
    status: httpStatus,
  });
}

/** Builds a cached client on a fake clock, with a fetch whose replies we script. */
function setup(replies: Array<() => Response | Promise<Response>>) {
  let t = Date.parse("2026-11-17T12:00:00.000Z");
  const clock = {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
  const fetchFn = vi.fn<FetchLike>(async () => {
    const next = replies.shift();
    if (!next) throw new Error("unexpected extra fetch");
    return next();
  });
  const ledger = new EvidenceLedger();
  const inner = createCmcClient({ apiKey: TEST_KEY, fetch: fetchFn, ledger, now: clock.now });
  const client = createCachedClient(inner, { ledger, now: clock.now, ttlMs: () => 60_000, maxStaleMs: 24 * 3_600_000 });
  return { client, fetchFn, ledger, clock };
}

describe("createCachedClient", () => {
  it("serves a repeat request from cache inside the TTL, without calling CMC", async () => {
    const { client, fetchFn, ledger, clock } = setup([() => ok({ price: 1 })]);

    await client.get("/v3/cryptocurrency/quotes/latest", { id: "1" });
    clock.advance(30_000);
    const second = await client.get("/v3/cryptocurrency/quotes/latest", { id: "1" });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second.data).toEqual({ price: 1 });
    expect(second.evidence).toMatchObject({ id: "E2", cached: true, stale: false, ageMs: 30_000 });
    expect(ledger.totalCredits()).toBe(1);
  });

  it("treats params in any order as the same request", async () => {
    const { client, fetchFn } = setup([() => ok({})]);

    await client.get("/x", { a: "1", b: "2" });
    await client.get("/x", { b: "2", a: "1" });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("calls CMC again once the TTL has passed", async () => {
    const { client, fetchFn, clock } = setup([() => ok({ price: 1 }), () => ok({ price: 2 })]);

    await client.get("/v3/cryptocurrency/quotes/latest", { id: "1" });
    clock.advance(61_000);
    const fresh = await client.get("/v3/cryptocurrency/quotes/latest", { id: "1" });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fresh.data).toEqual({ price: 2 });
    expect(fresh.evidence.cached).toBe(false);
  });

  it.each([
    ["rate limit (429)", () => fail(429, 1008)],
    ["server error (500)", () => fail(500, 500)],
    [
      "network failure",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("falls back to the last good answer on %s and labels it stale", async (_label, failure) => {
    const { client, ledger, clock } = setup([() => ok({ price: 1 }), failure]);

    await client.get("/v3/cryptocurrency/quotes/latest", { id: "1" });
    clock.advance(5 * 60_000);
    const result = await client.get("/v3/cryptocurrency/quotes/latest", { id: "1" });

    expect(result.data).toEqual({ price: 1 });
    expect(result.evidence).toMatchObject({ cached: true, stale: true, ageMs: 5 * 60_000 });
    // The ledger stays honest: it shows the failed live attempt, then the stale answer used.
    expect(ledger.entries().map((e) => [e.id, e.ok, e.cached])).toEqual([
      ["E1", true, false],
      ["E2", false, false],
      ["E3", true, true],
    ]);
  });

  it.each([
    ["plan not allowed (403)", 403, 1006, "plan"],
    ["bad key (401)", 401, 1002, "auth"],
    ["bad request (400)", 400, 400, "bad_request"],
  ] as const)("does not hide %s behind cached data", async (_label, httpStatus, code, kind) => {
    const { client, clock } = setup([() => ok({ price: 1 }), () => fail(httpStatus, code)]);

    await client.get("/x");
    clock.advance(61_000);

    await expect(client.get("/x")).rejects.toMatchObject({ kind });
  });

  it("rethrows when there is no earlier answer to fall back to", async () => {
    const { client } = setup([() => fail(429, 1008)]);

    await expect(client.get("/x")).rejects.toBeInstanceOf(CmcError);
  });

  it("does not serve answers older than maxStaleMs", async () => {
    const { client, clock } = setup([() => ok({ price: 1 }), () => fail(500, 500)]);

    await client.get("/x");
    clock.advance(25 * 3_600_000);

    await expect(client.get("/x")).rejects.toMatchObject({ kind: "server" });
  });

  it("shares one CMC call between identical requests made at the same time", async () => {
    const { client, fetchFn } = setup([() => ok({ price: 1 })]);

    const [a, b] = await Promise.all([client.get("/x", { id: "1" }), client.get("/x", { id: "1" })]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual(b.data);
  });
});

describe("shared in-flight failure", () => {
  it("gives every waiting request the stale answer when the shared call fails", async () => {
    const { client, clock } = setup([() => ok({ price: 1 }), () => fail(429, 1008)]);

    await client.get("/x");
    clock.advance(61_000);
    const [a, b] = await Promise.all([client.get("/x"), client.get("/x")]);

    expect([a.data, b.data]).toEqual([{ price: 1 }, { price: 1 }]);
    expect([a.evidence.stale, b.evidence.stale]).toEqual([true, true]);
  });
});

describe("defaultTtlMs", () => {
  it("keeps live prices briefly and slow-moving data longer", () => {
    expect(defaultTtlMs("/v3/cryptocurrency/quotes/latest")).toBe(60_000);
    expect(defaultTtlMs("/v3/cryptocurrency/quotes/historical")).toBe(3_600_000);
    expect(defaultTtlMs("/v1/global-metrics/quotes/historical")).toBe(3_600_000);
    expect(defaultTtlMs("/v1/cryptocurrency/map")).toBe(86_400_000);
    expect(defaultTtlMs("/v1/cryptocurrency/categories")).toBe(3_600_000);
  });
});
