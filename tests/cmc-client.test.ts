import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CmcError, createCmcClient, EvidenceLedger, type FetchLike } from "@/cmc/client";

// Real responses captured by `npm run probe` (key replaced by "<your key>").
function sample(name: string): { httpStatus: number; response: unknown } {
  return JSON.parse(readFileSync(`samples/${name}.json`, "utf8"));
}

/** A fetch stand-in that replays a saved sample and records what it was asked. */
function replay(name: string) {
  const { httpStatus, response } = sample(name);
  return vi.fn<FetchLike>(async () =>
    new Response(JSON.stringify(response), { status: httpStatus, headers: { "content-type": "application/json" } }),
  );
}

const TEST_KEY = ["test", "key", "not", "real", "0000"].join("-");

describe("createCmcClient", () => {
  it("sends the key as the X-CMC_PRO_API_KEY header and builds the query string", async () => {
    const fetchFn = replay("quotes-latest");
    const client = createCmcClient({ apiKey: TEST_KEY, fetch: fetchFn });

    await client.get("/v3/cryptocurrency/quotes/latest", { symbol: "BTC,ETH,SOL", convert: "USD" });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/latest?symbol=BTC%2CETH%2CSOL&convert=USD");
    expect(new Headers(init?.headers).get("X-CMC_PRO_API_KEY")).toBe(TEST_KEY);
  });

  it("returns the data payload of a real quotes/latest response", async () => {
    const client = createCmcClient({ apiKey: TEST_KEY, fetch: replay("quotes-latest") });

    // Note: in v3, `quote` is an array of { symbol, price, ... }, not the v1/v2 `{ USD: {...} }` object.
    const { data } = await client.get<Array<{ symbol: string; quote: Array<{ symbol: string; price: number }> }>>(
      "/v3/cryptocurrency/quotes/latest",
      { symbol: "BTC,ETH,SOL" },
    );

    // Real-world gotcha: a symbol lookup returns every coin sharing that ticker
    // (e.g. "Solcoin" and "Sola Token" alongside Solana), so callers must
    // resolve symbols to the right coin themselves.
    const solanas = data.filter((c) => c.symbol === "SOL");
    expect(solanas.length).toBeGreaterThan(1);
    expect(data.map((c) => c.symbol)).toEqual(expect.arrayContaining(["BTC", "ETH", "SOL"]));
    expect(data[0]!.quote[0]).toMatchObject({ symbol: "USD", price: expect.any(Number) });
    expect(data[0]!.quote[0]!.price).toBeGreaterThan(0);
  });

  it("refuses to start without a key", () => {
    expect(() => createCmcClient({ apiKey: "" })).toThrow(CmcError);
  });
});

describe("evidence ledger", () => {
  it("records every successful call with endpoint, params, status and credits", async () => {
    const ledger = new EvidenceLedger();
    const client = createCmcClient({ apiKey: TEST_KEY, fetch: replay("quotes-latest"), ledger });

    const { evidence } = await client.get("/v3/cryptocurrency/quotes/latest", { symbol: "BTC,ETH,SOL" });

    expect(evidence).toMatchObject({
      id: "E1",
      endpoint: "/v3/cryptocurrency/quotes/latest",
      params: { symbol: "BTC,ETH,SOL" },
      httpStatus: 200,
      ok: true,
      creditCount: 1,
      cached: false,
    });
    expect(evidence.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ledger.entries()).toEqual([evidence]);
  });

  it("numbers entries E1, E2, ... in call order", async () => {
    const ledger = new EvidenceLedger();
    const quotes = createCmcClient({ apiKey: TEST_KEY, fetch: replay("quotes-latest"), ledger });
    const global = createCmcClient({ apiKey: TEST_KEY, fetch: replay("global-metrics-latest"), ledger });

    await quotes.get("/v3/cryptocurrency/quotes/latest", { symbol: "BTC" });
    await global.get("/v1/global-metrics/quotes/latest");

    expect(ledger.entries().map((e) => [e.id, e.endpoint])).toEqual([
      ["E1", "/v3/cryptocurrency/quotes/latest"],
      ["E2", "/v1/global-metrics/quotes/latest"],
    ]);
  });

  it("never stores the API key", async () => {
    const ledger = new EvidenceLedger();
    const client = createCmcClient({ apiKey: TEST_KEY, fetch: replay("quotes-latest"), ledger });

    await client.get("/v3/cryptocurrency/quotes/latest", { symbol: "BTC" });

    expect(JSON.stringify(ledger.entries())).not.toContain(TEST_KEY);
  });

  it("keeps the raw response so the UI can show it", async () => {
    const ledger = new EvidenceLedger();
    const client = createCmcClient({ apiKey: TEST_KEY, fetch: replay("fear-and-greed-latest"), ledger });

    await client.get("/v3/fear-and-greed/latest");

    expect(ledger.entries()[0]!.response).toEqual(sample("fear-and-greed-latest").response);
  });
});

describe("errors", () => {
  it("turns a real 403 plan error into kind 'plan' and still records evidence", async () => {
    const ledger = new EvidenceLedger();
    const client = createCmcClient({ apiKey: TEST_KEY, fetch: replay("trending-latest"), ledger });

    const err = await client.get("/v1/cryptocurrency/trending/latest").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CmcError);
    expect(err).toMatchObject({ kind: "plan", httpStatus: 403, errorCode: 1006 });
    expect((err as CmcError).message).toContain("subscription plan");
    expect(ledger.entries()[0]).toMatchObject({ ok: false, httpStatus: 403, errorKind: "plan" });
  });

  it.each([
    [401, 1002, "auth"],
    [429, 1008, "rate_limit"],
    [400, 400, "bad_request"],
    [500, 500, "server"],
    [503, 0, "server"],
  ] as const)("maps HTTP %i (code %i) to kind '%s'", async (httpStatus, errorCode, kind) => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ status: { error_code: errorCode, error_message: "boom", credit_count: 0 } }), { status: httpStatus }),
    );
    const client = createCmcClient({ apiKey: TEST_KEY, fetch: fetchFn });

    await expect(client.get("/v1/global-metrics/quotes/latest")).rejects.toMatchObject({ kind, httpStatus });
  });

  it("reports a network failure as kind 'network'", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createCmcClient({ apiKey: TEST_KEY, fetch: fetchFn });

    await expect(client.get("/v1/global-metrics/quotes/latest")).rejects.toMatchObject({ kind: "network" });
  });

  it("reports a non-JSON reply as kind 'server'", async () => {
    const fetchFn = vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const client = createCmcClient({ apiKey: TEST_KEY, fetch: fetchFn });

    await expect(client.get("/v1/global-metrics/quotes/latest")).rejects.toMatchObject({ kind: "server", httpStatus: 502 });
  });
});
