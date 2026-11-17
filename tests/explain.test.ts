import { describe, expect, it } from "vitest";
import { createCmcClient, EvidenceLedger, type FetchLike } from "@/cmc/client";
import { explainPortfolio, parseHoldings } from "@/engine/explain";
import { writeNarrative } from "@/engine/narrative";
import { explainPortfolioMove, TOOLS } from "@/tools/registry";
import { cmcError, fakeCmc, TEST_KEY } from "./helpers";

function ctx(fetchFn: FetchLike = fakeCmc()) {
  const ledger = new EvidenceLedger();
  return { client: createCmcClient({ apiKey: TEST_KEY, fetch: fetchFn, ledger }), ledger };
}

describe("parseHoldings", () => {
  it("reads 'SYMBOL:amount' pairs separated by spaces, commas or new lines", () => {
    expect(parseHoldings("btc:0.5, SOL:20\nETH:1.25")).toEqual([
      { symbol: "BTC", amount: 0.5 },
      { symbol: "SOL", amount: 20 },
      { symbol: "ETH", amount: 1.25 },
    ]);
  });

  it("merges repeated symbols and rejects bad input with a clear message", () => {
    expect(parseHoldings("SOL:1 sol:2")).toEqual([{ symbol: "SOL", amount: 3 }]);
    expect(() => parseHoldings("SOL")).toThrow(/SOL.*SYMBOL:amount/);
    expect(() => parseHoldings("SOL:-1")).toThrow(/amount/);
    expect(() => parseHoldings("")).toThrow(/at least one/);
  });
});

describe("explainPortfolio (real saved CMC responses)", () => {
  it("explains a BTC + SOL + ETH bag with every figure cited", async () => {
    const c = ctx();
    const report = await explainPortfolio([{ symbol: "BTC", amount: 0.1 }, { symbol: "SOL", amount: 20 }, { symbol: "ETH", amount: 1 }], c);

    expect(report.attribution.rows.map((r) => r.symbol)).toEqual(["BTC", "SOL", "ETH"]);
    const sol = report.attribution.rows.find((r) => r.symbol === "SOL")!;
    expect(sol.name).toBe("Solana");
    expect(sol.betaSource).toBe("history"); // the saved history sample is SOL's
    expect(sol.sector?.name).toBeTruthy();
    expect(sol.marketUsd + sol.sectorUsd + sol.specificUsd).toBeCloseTo(sol.pnlUsd, 6);

    // BTC and ETH have no saved history, so they fall back to beta 1 and say so.
    expect(report.attribution.rows.find((r) => r.symbol === "BTC")!.betaSource).toBe("default");
    expect(report.warnings.join(" ")).toMatch(/beta 1/);

    // Every citation in the narrative points at a real ledger entry.
    const ids = new Set(c.ledger.entries().map((e) => e.id));
    const cited = report.narrative.lines.flatMap((l) => l.cites);
    expect(cited.length).toBeGreaterThan(3);
    for (const id of cited) expect(ids.has(id)).toBe(true);

    const endpoints = new Set(report.evidence.map((e) => e.endpoint));
    for (const e of [
      "/v3/cryptocurrency/quotes/latest",
      "/v1/global-metrics/quotes/latest",
      "/v3/cryptocurrency/quotes/historical",
      "/v1/global-metrics/quotes/historical",
      "/v1/cryptocurrency/categories",
    ]) {
      expect(endpoints.has(e)).toBe(true);
    }
  });

  it("still explains the move when optional data (history, sectors, sentiment) is unavailable", async () => {
    const report = await explainPortfolio(
      [{ symbol: "SOL", amount: 5 }],
      ctx(
        fakeCmc({
          "/v3/cryptocurrency/quotes/historical": cmcError(429, 1008),
          "/v1/global-metrics/quotes/historical": cmcError(429, 1008),
          "/v1/cryptocurrency/categories": cmcError(403, 1006),
          "/v3/fear-and-greed/latest": cmcError(403, 1006),
          "/v5/derivatives/liquidations/quotes/latest": cmcError(500, 500),
        }),
      ),
    );

    expect(report.attribution.rows[0]!.betaSource).toBe("default");
    expect(report.attribution.rows[0]!.sector).toBeNull();
    expect(report.narrative.headline).toMatch(/Your bag is (up|down)/);
  });

  it("reports symbols CMC does not know", async () => {
    const report = await explainPortfolio([{ symbol: "SOL", amount: 1 }, { symbol: "NOTACOIN", amount: 5 }], ctx());

    expect(report.notFound).toEqual(["NOTACOIN"]);
    expect(report.warnings.join(" ")).toMatch(/NOTACOIN/);
  });
});

describe("writeNarrative", () => {
  it("writes a headline and cited lines in plain English", async () => {
    const report = await explainPortfolio([{ symbol: "SOL", amount: 20 }], ctx());
    const n = writeNarrative(report);

    expect(n.headline).toMatch(/^Your bag is (up|down) \$[\d,]+\.\d{2} \([+-]\d+\.\d{2}%\) over 24h/);
    expect(n.lines.some((l) => /whole crypto market/i.test(l.text))).toBe(true);
    expect(n.lines.some((l) => /Fear & Greed/.test(l.text))).toBe(true);
    for (const l of n.lines) for (const id of l.cites) expect(l.text).toContain(`[${id}]`);
    expect(n.markdown).toContain(n.headline);
  });
});

describe("explain_portfolio_move tool", () => {
  it("is registered and returns the report with evidence", async () => {
    expect(TOOLS.map((t) => t.name)).toContain("explain_portfolio_move");

    const out = await explainPortfolioMove.run({ holdings: [{ symbol: "SOL", amount: 20 }] }, ctx());

    expect(out.data.narrative.headline).toMatch(/Your bag is/);
    expect(out.evidence.length).toBeGreaterThan(3);
  });
});
