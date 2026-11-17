import { describe, expect, it } from "vitest";
import { attribute, type CoinFacts } from "@/engine/attribution";
import { computeBeta, dailyReturns } from "@/engine/beta";
import { chooseSector } from "@/engine/sector";

const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString();

describe("dailyReturns", () => {
  it("turns a price series into day-over-day % changes keyed by date", () => {
    const returns = dailyReturns([{ t: day(0), v: 100 }, { t: day(1), v: 110 }, { t: day(2), v: 99 }]);

    expect([...returns.keys()]).toEqual(["2026-10-02", "2026-10-03"]);
    expect(returns.get("2026-10-02")).toBeCloseTo(10, 9);
    expect(returns.get("2026-10-03")).toBeCloseTo(-10, 9);
  });
});

describe("computeBeta", () => {
  const market = [100, 102, 101, 104, 103, 106, 105, 108, 107, 110, 109, 112].map((v, i) => ({ t: day(i), v }));

  it("is ~2 for a coin that moves twice as much as the market", () => {
    let price = 50;
    const marketRet = dailyReturns(market);
    const coin = [{ t: day(0), v: price }];
    for (let i = 1; i < market.length; i++) {
      price *= 1 + (2 * marketRet.get(day(i).slice(0, 10))!) / 100;
      coin.push({ t: day(i), v: price });
    }

    const result = computeBeta(coin, market);

    expect(result?.beta).toBeCloseTo(2, 6);
    expect(result?.points).toBe(11);
  });

  it("returns null when there are too few overlapping days", () => {
    expect(computeBeta(market.slice(0, 4), market)).toBeNull();
  });

  it("returns null when the market did not move at all", () => {
    const flat = market.map((p) => ({ ...p, v: 100 }));
    expect(computeBeta(market, flat)).toBeNull();
  });
});

describe("chooseSector", () => {
  const cat = (name: string, numTokens: number, marketCap: number, change = 1) => ({
    id: name,
    name,
    numTokens,
    avgPriceChangePct: change,
    marketCapUsd: marketCap,
    marketCapChangePct: change,
    evidenceId: "E9",
  });

  const TOTAL_MARKET = 2_200e9;

  it("picks Tokenized Gold for PAXG from its real CMC categories", () => {
    // Real categories for PAXG (id 4705), 2026-11-17.
    const paxg = [
      cat("Binance Ecosystem", 1390, 2207.1e9, 1.1), // basically the whole market
      cat("Ethereum Ecosystem", 3895, 373.2e9, 1.28),
      cat("Real World Assets Protocols", 218, 32.3e9, 2.26),
      cat("Tokenized Assets", 2889, 12.8e9, -0.1),
      cat("Tokenized commodities", 48, 4.7e9, -0.41),
      cat("Tokenized Gold", 28, 4.7e9, -0.41),
    ];

    expect(chooseSector(paxg, { coinName: "PAX Gold", coinMarketCapUsd: 1.72e9, totalMarketCapUsd: TOTAL_MARKET })).toEqual({ name: "Tokenized Gold", changePct: -0.41, evidenceId: "E9" });
  });

  it("picks Solana Ecosystem for SOL, skipping market-sized lists and trivia", () => {
    // Real categories for SOL (id 5426), 2026-11-17 (trimmed).
    const sol = [
      cat("Binance Ecosystem", 1390, 2207.1e9),
      cat("Layer 1", 181, 1775.7e9),
      cat("SEC/CFTC Digital Commodities", 16, 1678.5e9),
      cat("US Strategic Crypto Reserve", 5, 1639.5e9),
      cat("Kenetic Capital Portfolio", 60, 282.4e9),
      cat("Made in America", 164, 262.1e9),
      cat("Solana Ecosystem", 2974, 200.4e9, 2.56),
      cat("Alleged SEC Securities", 63, 166.1e9),
      cat("Coinlist Launchpad", 70, 53.6e9),
      cat("CMC Crypto Awards 2024", 4, 47.6e9),
      cat("OKX Ventures Portfolio", 111, 45.9e9),
    ];

    expect(chooseSector(sol, { coinName: "Solana", coinMarketCapUsd: 43.7e9, totalMarketCapUsd: TOTAL_MARKET })?.name).toBe("Solana Ecosystem");
  });

  it("only counts an 'X Ecosystem' category for X's own coin", () => {
    const eth = [cat("Sophon Ecosystem", 12, 600e9, 0.48), cat("Smart Contract Platforms", 40, 900e9, 1.2)];

    expect(chooseSector(eth, { coinName: "Ethereum", coinMarketCapUsd: 220e9, totalMarketCapUsd: TOTAL_MARKET })?.name).toBe("Smart Contract Platforms");
  });

  it("skips a category the coin itself dominates", () => {
    expect(chooseSector([cat("Solo Coin Ecosystem", 12, 50e9)], { coinName: "Solo Coin", coinMarketCapUsd: 40e9, totalMarketCapUsd: TOTAL_MARKET })).toBeNull();
  });

  it("returns null when nothing qualifies or the change is missing", () => {
    expect(chooseSector([cat("Alleged SEC Securities", 63, 1e11)], { coinName: "X", coinMarketCapUsd: 1e9, totalMarketCapUsd: TOTAL_MARKET })).toBeNull();
    expect(chooseSector([{ ...cat("DeFi", 181, 1e11), marketCapChangePct: null }], { coinName: "X", coinMarketCapUsd: 1e9, totalMarketCapUsd: TOTAL_MARKET })).toBeNull();
  });
});

describe("attribute", () => {
  const coin = (over: Partial<CoinFacts>): CoinFacts => ({
    symbol: "X",
    name: "X",
    id: 1,
    priceUsd: 100,
    change24hPct: 10,
    beta: 1,
    betaSource: "history",
    betaPoints: 30,
    sector: null,
    quoteEvidenceId: "E1",
    ...over,
  });

  it("splits a coin's move into market, sector and coin-specific parts that add up exactly", () => {
    // Coin +10%, market +2% with beta 1.5 => market part 3%; sector +6% vs market 2% => sector part 4%; rest 3%.
    const result = attribute(
      [{ coin: coin({ symbol: "SOL", priceUsd: 110, change24hPct: 10, beta: 1.5, sector: { name: "Layer 1", changePct: 6, evidenceId: "E5" } }), amount: 10 }],
      { change24hPct: 2, evidenceId: "E2" },
    );

    expect(result.totalValueUsd).toBeCloseTo(1100);
    expect(result.previousValueUsd).toBeCloseTo(1000);
    expect(result.pnlUsd).toBeCloseTo(100);
    expect(result.pnlPct).toBeCloseTo(10);
    const row = result.rows[0]!;
    expect(row.marketUsd).toBeCloseTo(30);
    expect(row.sectorUsd).toBeCloseTo(40);
    expect(row.specificUsd).toBeCloseTo(30);
    expect(row.marketUsd + row.sectorUsd + row.specificUsd).toBeCloseTo(row.pnlUsd);
    expect(result.components).toMatchObject({ marketUsd: expect.closeTo(30), sectorUsd: expect.closeTo(40), specificUsd: expect.closeTo(30) });
    expect(result.dominant).toBe("sector");
  });

  it("weights coins by value and sums the portfolio", () => {
    const result = attribute(
      [
        { coin: coin({ symbol: "A", priceUsd: 100, change24hPct: 0 }), amount: 3 },
        { coin: coin({ symbol: "B", priceUsd: 100, change24hPct: -50 }), amount: 1 },
      ],
      { change24hPct: 0, evidenceId: "E2" },
    );

    expect(result.rows.map((r) => r.weightPct)).toEqual([75, 25]);
    expect(result.pnlUsd).toBeCloseTo(-100); // B was worth 200, now 100
    expect(result.biggestDriver?.symbol).toBe("B");
  });

  it("treats a missing market change as zero market effect and says so", () => {
    const result = attribute([{ coin: coin({ change24hPct: 5 }), amount: 1 }], { change24hPct: null, evidenceId: null });

    expect(result.components.marketUsd).toBe(0);
    expect(result.warnings).toContain("Whole-market change was unavailable, so no part of the move is attributed to the market.");
  });

  it("treats a missing coin change as flat and says so", () => {
    const result = attribute([{ coin: coin({ symbol: "Z", change24hPct: null }), amount: 1 }], { change24hPct: 1, evidenceId: "E2" });

    expect(result.pnlUsd).toBe(0);
    expect(result.warnings).toContain("No 24h change for Z, treated as flat.");
  });
});
