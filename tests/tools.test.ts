import { describe, expect, it } from "vitest";
import { createCmcClient, EvidenceLedger, type FetchLike } from "@/cmc/client";
import { getCoinSectors, getLiquidations, getMarketContext, getQuotes, getRwaQuotes, TOOLS, type ToolContext } from "@/tools/registry";
import { cmcError, fakeCmc, TEST_KEY } from "./helpers";

function ctx(fetchFn: FetchLike = fakeCmc()): ToolContext {
  const ledger = new EvidenceLedger();
  return { client: createCmcClient({ apiKey: TEST_KEY, fetch: fetchFn, ledger }), ledger };
}


describe("tool registry", () => {
  it("has unique snake_case names and a description for every tool", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.description.length).toBeGreaterThan(30);
    }
  });
});

describe("get_quotes", () => {
  it("returns the right coin for each symbol with live price and % changes", async () => {
    const out = await getQuotes.run({ symbols: ["btc", "SOL", "ETH"] }, ctx());

    expect(out.data.coins.map((c) => [c.symbol, c.name])).toEqual([
      ["BTC", "Bitcoin"],
      ["SOL", "Solana"],
      ["ETH", "Ethereum"],
    ]);
    const btc = out.data.coins[0]!;
    expect(btc.priceUsd).toBeGreaterThan(0);
    expect(typeof btc.percentChange24h).toBe("number");
    expect(btc.evidenceId).toBe("E1");
    expect(out.data.notFound).toEqual([]);
  });

  it("lists symbols CMC did not recognise instead of failing", async () => {
    const out = await getQuotes.run({ symbols: ["BTC", "NOTACOIN"] }, ctx());

    expect(out.data.notFound).toEqual(["NOTACOIN"]);
  });

  it("sends skip_invalid so one bad symbol does not break the request", async () => {
    const fetchFn = fakeCmc();
    await getQuotes.run({ symbols: ["BTC"] }, ctx(fetchFn));

    expect(fetchFn.mock.calls[0]![0].searchParams.get("skip_invalid")).toBe("true");
  });

  it("rejects bad input via its schema", () => {
    expect(getQuotes.inputSchema.safeParse({ symbols: [] }).success).toBe(false);
  });
});

describe("get_market_context", () => {
  it("combines global metrics, fear & greed and altcoin season, citing each", async () => {
    const out = await getMarketContext.run({}, ctx());

    expect(out.data.totalMarketCapUsd).toBeGreaterThan(0);
    expect(typeof out.data.totalMarketCapChange24hPct).toBe("number");
    expect(out.data.btcDominancePct).toBeGreaterThan(0);
    expect(out.data.fearAndGreed).toMatchObject({ value: 13, classification: "Extreme fear" });
    expect(out.data.altcoinSeasonIndex).toBe(50);
    expect(out.evidence.map((e) => e.endpoint)).toEqual([
      "/v1/global-metrics/quotes/latest",
      "/v3/fear-and-greed/latest",
      "/v1/altcoin-season-index/latest",
    ]);
    expect(out.data.unavailable).toEqual([]);
  });

  it("keeps going when one part is not on the plan", async () => {
    const out = await getMarketContext.run({}, ctx(fakeCmc({ "/v3/fear-and-greed/latest": cmcError(403, 1006, "plan") })));

    expect(out.data.fearAndGreed).toBeNull();
    expect(out.data.totalMarketCapUsd).toBeGreaterThan(0);
    expect(out.data.unavailable).toEqual([{ part: "fearAndGreed", reason: "plan" }]);
  });
});

describe("get_coin_sectors", () => {
  it("lists the CMC categories a coin belongs to with their average move", async () => {
    const out = await getCoinSectors.run({ symbol: "SOL" }, ctx());

    expect(out.data.symbol).toBe("SOL");
    expect(out.data.sectors[0]).toMatchObject({ name: "Solana Ecosystem", numTokens: 2974 });
    expect(typeof out.data.sectors[0]!.avgPriceChangePct).toBe("number");
  });
});

describe("get_liquidations", () => {
  it("returns long and short liquidations for 1h, 4h and 24h", async () => {
    const out = await getLiquidations.run({}, ctx());

    expect(out.data.h24.totalUsd).toBeGreaterThan(0);
    expect(out.data.h24.longUsd + out.data.h24.shortUsd).toBeCloseTo(out.data.h24.totalUsd, 0);
    expect(out.data.h1).toBeDefined();
    expect(out.data.h4).toBeDefined();
  });
});

describe("get_rwa_quotes", () => {
  it("returns tokenized real-world asset prices", async () => {
    const out = await getRwaQuotes.run({ symbols: ["GOLD"] }, ctx());

    expect(out.data.assets[0]).toMatchObject({ name: "Gold", symbol: "GOLD", assetType: "commodity" });
    expect(out.data.assets[0]!.priceUsd).toBeGreaterThan(0);
  });
});
