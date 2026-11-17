/**
 * "Why did my bag move?": gathers the CoinMarketCap data, runs the attribution
 * and writes the explanation. Only the live quotes are required; history
 * (beta), sectors, sentiment and liquidations are optional extras that degrade
 * gracefully (with a warning) if a call is rate-limited or not on the plan.
 *
 * CMC calls per explanation (all Basic plan):
 *   /v3/cryptocurrency/quotes/latest        live price + 24h change   (required)
 *   /v1/global-metrics/quotes/latest        whole-market 24h change
 *   /v3/fear-and-greed/latest               sentiment
 *   /v1/altcoin-season-index/latest         altcoin season
 *   /v3/cryptocurrency/quotes/historical    30 days of coin prices (one call, all coins) -> beta
 *   /v1/global-metrics/quotes/historical    30 days of total market cap               -> beta
 *   /v1/cryptocurrency/categories           sectors, one call per coin
 *   /v5/derivatives/liquidations/quotes/latest  leverage context
 */
import { CmcError } from "@/cmc/client";
import type { Citation, ToolContext } from "@/tools/types";
import { getCoinSectors, getLiquidations, getMarketContext, getQuotes } from "@/tools/data-tools";
import { attribute, type Attribution, type CoinFacts } from "./attribution";
import { computeBeta, type Point } from "./beta";
import { writeNarrative, type Narrative } from "./narrative";
import { chooseSector } from "./sector";

export interface Holding {
  symbol: string;
  amount: number;
}

export interface Report {
  generatedAt: string;
  notFound: string[];
  attribution: Attribution;
  market: {
    change24hPct: number | null;
    evidenceId: string | null;
    totalMarketCapUsd: number | null;
    btcDominancePct: number | null;
    altcoinSeasonIndex: number | null;
    fearAndGreed: { value: number; classification: string; evidenceId: string | null } | null;
  };
  liquidations: { h24: { totalUsd: number; longUsd: number; shortUsd: number }; evidenceId: string | null } | null;
  /** Evidence ids of the two history calls used for beta. */
  historyEvidenceIds: string[];
  warnings: string[];
  narrative: Narrative;
  evidence: Citation[];
}

const MAX_HOLDINGS = 25;

/** Parses "BTC:0.5, SOL:20" (spaces, commas, semicolons or new lines between pairs). */
export function parseHoldings(text: string): Holding[] {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 0) throw new Error("Enter at least one holding, e.g. BTC:0.5 SOL:20.");
  const merged = new Map<string, number>();
  for (const token of tokens) {
    const match = /^([A-Za-z0-9.$_-]{1,20})[:=]([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)$/i.exec(token);
    if (!match) {
      if (/^[^:=]+[:=]-/.test(token)) throw new Error(`Invalid amount in "${token}": it must be a positive number.`);
      throw new Error(`"${token}" is not in SYMBOL:amount form (e.g. SOL:20).`);
    }
    const symbol = match[1]!.toUpperCase();
    const amount = Number(match[2]);
    if (!(amount > 0)) throw new Error(`Invalid amount for ${symbol}: it must be a positive number.`);
    merged.set(symbol, (merged.get(symbol) ?? 0) + amount);
  }
  if (merged.size > MAX_HOLDINGS) throw new Error(`At most ${MAX_HOLDINGS} different coins, please.`);
  return [...merged].map(([symbol, amount]) => ({ symbol, amount }));
}

/** Runs an optional step; data problems become a warning instead of an error. Bad keys still throw. */
async function optional<T>(label: string, warnings: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CmcError && err.kind !== "auth") {
      warnings.push(`${label} unavailable (${err.kind}), so it was skipped.`);
      return null;
    }
    throw err;
  }
}

/** Last successful (live or cached) evidence id for an endpoint. */
function idFor(evidence: Citation[], endpoint: string): string | null {
  return [...evidence].reverse().find((e) => e.endpoint === endpoint && e.ok)?.id ?? null;
}

interface HistoricalCoin {
  id: number;
  quotes: Array<{ timestamp: string; quote: Record<string, { price: number }> | Array<{ symbol: string; price: number }> }>;
}

/** v3 historical data can come keyed by id/symbol, as an object or an array; flatten to a list. */
function flattenHistorical(data: unknown): HistoricalCoin[] {
  const values = Array.isArray(data) ? data : Object.values((data ?? {}) as Record<string, unknown>);
  return values.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v): v is HistoricalCoin => !!v && typeof v === "object" && "quotes" in v);
}

function usdPrice(quote: HistoricalCoin["quotes"][number]["quote"]): number | undefined {
  return Array.isArray(quote) ? (quote.find((q) => q.symbol === "USD") ?? quote[0])?.price : quote.USD?.price;
}

export async function explainPortfolio(holdings: Holding[], ctx: ToolContext): Promise<Report> {
  const start = ctx.ledger.entries().length;
  const warnings: string[] = [];
  const amounts = new Map<string, number>();
  for (const h of holdings) amounts.set(h.symbol.toUpperCase(), (amounts.get(h.symbol.toUpperCase()) ?? 0) + h.amount);

  // 1. Live quotes (required).
  const quotes = await getQuotes.run({ symbols: [...amounts.keys()] }, ctx);
  for (const s of quotes.data.notFound) warnings.push(`CoinMarketCap did not recognise ${s}, so it was left out.`);
  if (quotes.data.coins.length === 0) {
    throw new CmcError({ kind: "bad_request", endpoint: "/v3/cryptocurrency/quotes/latest", message: "None of these symbols were found on CoinMarketCap." });
  }
  const coins = quotes.data.coins;

  // 2. Whole-market context.
  const market = await getMarketContext.run({}, ctx);
  for (const u of market.data.unavailable) warnings.push(`${u.part} unavailable (${u.reason}), so it was skipped.`);

  // 3. Beta from 30 days of daily history (one call for all coins + one for the market).
  const betas = new Map<number, { beta: number; points: number }>();
  const historyEvidenceIds: string[] = [];
  const marketSeries = await optional("Market history", warnings, async () => {
    const { data, evidence } = await ctx.client.get<{ quotes: Array<{ timestamp: string; quote: { USD: { total_market_cap: number } } }> }>(
      "/v1/global-metrics/quotes/historical",
      { count: 31, interval: "daily" },
    );
    historyEvidenceIds.push(evidence.id);
    return data.quotes.map((q): Point => ({ t: q.timestamp, v: q.quote.USD.total_market_cap }));
  });
  if (marketSeries) {
    await optional("Coin price history", warnings, async () => {
      const { data, evidence } = await ctx.client.get<unknown>("/v3/cryptocurrency/quotes/historical", {
        id: coins.map((c) => c.id).join(","),
        count: 31,
        interval: "daily",
      });
      historyEvidenceIds.push(evidence.id);
      for (const h of flattenHistorical(data)) {
        const series = h.quotes.map((q) => ({ t: q.timestamp, v: usdPrice(q.quote) ?? NaN }));
        const result = computeBeta(series, marketSeries);
        // Clamp to a sane range so one odd month cannot produce absurd figures.
        if (result) betas.set(h.id, { beta: Math.min(4, Math.max(-1, result.beta)), points: result.points });
      }
    });
  }

  // 4. Sector per coin.
  const sectors = new Map<number, CoinFacts["sector"]>();
  for (const c of coins) {
    const out = await optional(`Sectors for ${c.symbol}`, warnings, () => getCoinSectors.run({ id: c.id }, ctx));
    if (out) sectors.set(c.id, chooseSector(out.data.sectors, { coinName: c.name, coinMarketCapUsd: c.marketCapUsd, totalMarketCapUsd: market.data.totalMarketCapUsd }));
  }

  // 5. Leverage context.
  const liq = await optional("Liquidations", warnings, () => getLiquidations.run({}, ctx));

  // 6. Attribution.
  const facts = coins.map((c) => {
    const b = betas.get(c.id);
    if (!b) warnings.push(`Not enough price history for ${c.symbol}, so it is assumed to move one-for-one with the market (beta 1).`);
    const coin: CoinFacts = {
      symbol: c.symbol,
      name: c.name,
      id: c.id,
      priceUsd: c.priceUsd,
      change24hPct: c.percentChange24h,
      marketCapUsd: c.marketCapUsd,
      beta: b?.beta ?? 1,
      betaSource: b ? "history" : "default",
      betaPoints: b?.points ?? 0,
      sector: sectors.get(c.id) ?? null,
      quoteEvidenceId: c.evidenceId,
    };
    return { coin, amount: amounts.get(c.symbol.toUpperCase()) ?? 0 };
  });
  const marketEvidence = market.evidence;
  const attribution = attribute(facts, {
    change24hPct: market.data.totalMarketCapChange24hPct,
    evidenceId: idFor(marketEvidence, "/v1/global-metrics/quotes/latest"),
  });
  warnings.push(...attribution.warnings);

  const partial = {
    attribution,
    market: {
      change24hPct: market.data.totalMarketCapChange24hPct,
      evidenceId: idFor(marketEvidence, "/v1/global-metrics/quotes/latest"),
      totalMarketCapUsd: market.data.totalMarketCapUsd,
      btcDominancePct: market.data.btcDominancePct,
      altcoinSeasonIndex: market.data.altcoinSeasonIndex,
      fearAndGreed: market.data.fearAndGreed
        ? { value: market.data.fearAndGreed.value, classification: market.data.fearAndGreed.classification, evidenceId: idFor(marketEvidence, "/v3/fear-and-greed/latest") }
        : null,
    },
    liquidations: liq ? { h24: liq.data.h24, evidenceId: idFor(liq.evidence, "/v5/derivatives/liquidations/quotes/latest") } : null,
    historyEvidenceIds,
  };

  const evidence = ctx.ledger.entries().slice(start).map((e): Citation => {
    const copy: Partial<typeof e> = { ...e };
    delete copy.response;
    return copy as Citation;
  });

  return {
    generatedAt: new Date().toISOString(),
    notFound: quotes.data.notFound,
    ...partial,
    warnings: [...new Set(warnings)],
    narrative: writeNarrative(partial),
    evidence,
  };
}
