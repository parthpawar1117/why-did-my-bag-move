import { describe, expect, it } from "vitest";
import { MemoryCacheStore } from "@/cmc/cache";
import { trimForDisplay } from "@/cmc/trim";
import { splitCitations } from "@/web/citations";
import { handleExplain, type ExplainDeps } from "@/web/explain-handler";
import { createRateLimiter } from "@/web/rate-limit";
import { cmcError, fakeCmc, TEST_KEY } from "./helpers";

describe("createRateLimiter", () => {
  it("allows up to `limit` hits per window, then reports when to retry", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t });

    expect(limiter.check("ip1").ok).toBe(true);
    expect(limiter.check("ip1").ok).toBe(true);
    t = 15_000;
    expect(limiter.check("ip1")).toEqual({ ok: false, retryAfterSec: 45 });
    expect(limiter.check("ip2").ok).toBe(true); // other visitors unaffected
    t = 60_000;
    expect(limiter.check("ip1").ok).toBe(true); // new window
  });
});

describe("trimForDisplay", () => {
  it("shortens long arrays and strings so raw responses stay readable", () => {
    const out = trimForDisplay({ list: Array.from({ length: 30 }, (_, i) => i), text: "x".repeat(500) }, { maxItems: 3, maxString: 10 }) as {
      list: unknown[];
      text: string;
    };

    expect(out.list).toEqual([0, 1, 2, "... 27 more items"]);
    expect(out.text).toBe("xxxxxxxxxx... (490 more chars)");
  });
});

describe("splitCitations", () => {
  it("splits text into plain parts and citation ids", () => {
    expect(splitCitations("Market moved +1% [E2]. Beta 1.2 [E5] [E6].")).toEqual([
      { text: "Market moved +1% " },
      { cite: "E2" },
      { text: ". Beta 1.2 " },
      { cite: "E5" },
      { text: " " },
      { cite: "E6" },
      { text: "." },
    ]);
  });
});

function deps(over: Partial<ExplainDeps> = {}): ExplainDeps {
  return {
    apiKey: TEST_KEY,
    store: new MemoryCacheStore(),
    fetch: fakeCmc(),
    perVisitor: createRateLimiter({ limit: 100, windowMs: 60_000 }),
    global: createRateLimiter({ limit: 100, windowMs: 60_000 }),
    ...over,
  };
}

function post(body: unknown, ip = "1.2.3.4"): Request {
  return new Request("http://localhost/api/explain", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("handleExplain", () => {
  it("returns the report plus each raw CMC response, keyed by evidence id", async () => {
    const res = await handleExplain(post({ holdings: "SOL:20 BTC:0.1" }), deps());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.report.narrative.headline).toMatch(/Your bag is/);
    expect(body.report.attribution.rows.map((r: { symbol: string }) => r.symbol)).toEqual(["SOL", "BTC"]);
    const firstId = body.report.evidence[0].id;
    expect(body.raw[firstId]).toBeDefined();
    expect(JSON.stringify(body)).not.toContain(TEST_KEY);
  });

  it("rejects badly formatted holdings with a 400 and a helpful message", async () => {
    const res = await handleExplain(post({ holdings: "SOL twenty" }), deps());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/SYMBOL:amount/);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await handleExplain(post("not json"), deps());
    expect(res.status).toBe(400);
  });

  it("rate-limits a visitor with 429 and Retry-After", async () => {
    const d = deps({ perVisitor: createRateLimiter({ limit: 1, windowMs: 60_000 }) });

    await handleExplain(post({ holdings: "SOL:1" }), d);
    const res = await handleExplain(post({ holdings: "SOL:1" }), d);

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("hides key problems from visitors (500) without leaking details", async () => {
    const res = await handleExplain(post({ holdings: "SOL:1" }), deps({ fetch: fakeCmc({ "/v3/cryptocurrency/quotes/latest": cmcError(401, 1002, "This API Key is invalid.") }) }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("The server's CoinMarketCap key is not working. Please try again later.");
  });

  it("returns 503 when CMC is rate-limiting and nothing is cached", async () => {
    const res = await handleExplain(post({ holdings: "SOL:1" }), deps({ fetch: fakeCmc({ "/v3/cryptocurrency/quotes/latest": cmcError(429, 1008) }) }));

    expect(res.status).toBe(503);
  });

  it("returns 500 with a setup hint when no key is configured", async () => {
    const res = await handleExplain(post({ holdings: "SOL:1" }), deps({ apiKey: undefined }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/not configured/);
  });
});
