/**
 * Data tools: each wraps one or a few CoinMarketCap endpoints and returns
 * `{ data, evidence }`, the answer plus a citation for each CMC call that
 * produced it. All work on CMC's free Basic plan.
 */
import { z } from "zod";
import { CmcError, type EvidenceEntry } from "@/cmc/client";
import { pickBestMatch } from "@/cmc/resolve";
import type { Citation, ToolContext, ToolDef, ToolOutput } from "./types";
import type { AltcoinSeason, Category, FearAndGreed, GlobalMetrics, Liquidations, RwaQuotes, V3Coin, V3Quote } from "@/cmc/types";

export function toCitation(entry: EvidenceEntry): Citation {
  const copy: Partial<EvidenceEntry> = { ...entry };
  delete copy.response;
  return copy as Citation;
}

/** Runs `body`, then attaches citations for every call it made. */
export async function withEvidence<D>(ctx: ToolContext, body: () => Promise<D>): Promise<ToolOutput<D>> {
  const start = ctx.ledger.entries().length;
  const data = await body();
  return { data, evidence: ctx.ledger.entries().slice(start).map(toCitation) };
}

function usd(quote: V3Quote[]): V3Quote | undefined {
  return quote.find((q) => q.symbol === "USD") ?? quote[0];
}

const symbolList = z
  .array(z.string().trim().min(1).max(20))
  .min(1)
  .max(30)
  .transform((list) => [...new Set(list.map((s) => s.toUpperCase()))]);

// ---------------------------------------------------------------- get_quotes

export const getQuotes: ToolDef<z.ZodObject<{ symbols: typeof symbolList }>, {
  coins: Array<{
    id: number;
    symbol: string;
    name: string;
    rank: number | null;
    priceUsd: number;
    percentChange1h: number | null;
    percentChange24h: number | null;
    percentChange7d: number | null;
    percentChange30d: number | null;
    marketCapUsd: number | null;
    volume24hUsd: number | null;
    lastUpdated: string;
    evidenceId: string;
  }>;
  notFound: string[];
}> = {
  name: "get_quotes",
  title: "Live coin quotes",
  description:
    "Latest USD price, 1h/24h/7d/30d % change, market cap and volume for crypto tickers (e.g. BTC, SOL). Resolves look-alike tickers to the top-ranked coin. Source: /v3/cryptocurrency/quotes/latest.",
  inputSchema: z.object({ symbols: symbolList }),
  run: ({ symbols }, ctx) =>
    withEvidence(ctx, async () => {
      const { data, evidence } = await ctx.client.get<V3Coin[]>("/v3/cryptocurrency/quotes/latest", {
        symbol: symbols.join(","),
        skip_invalid: true,
      });
      const coins = [];
      const notFound: string[] = [];
      for (const symbol of symbols) {
        const coin = pickBestMatch(data, symbol);
        const q = coin && usd(coin.quote);
        if (!coin || !q) {
          notFound.push(symbol);
          continue;
        }
        coins.push({
          id: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          rank: coin.cmc_rank,
          priceUsd: q.price,
          percentChange1h: q.percent_change_1h,
          percentChange24h: q.percent_change_24h,
          percentChange7d: q.percent_change_7d,
          percentChange30d: q.percent_change_30d,
          marketCapUsd: q.market_cap,
          volume24hUsd: q.volume_24h,
          lastUpdated: q.last_updated,
          evidenceId: evidence.id,
        });
      }
      return { coins, notFound };
    }),
};

// -------------------------------------------------------- get_market_context

type Part = "globalMetrics" | "fearAndGreed" | "altcoinSeason";

/** Fetches one optional part; plan/rate/server problems become "unavailable" instead of failing everything. */
async function optional<T>(part: Part, unavailable: Array<{ part: Part; reason: string }>, call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof CmcError && err.kind !== "auth") {
      unavailable.push({ part, reason: err.kind });
      return null;
    }
    throw err;
  }
}

export const getMarketContext: ToolDef<z.ZodObject<Record<string, never>>, {
  totalMarketCapUsd: number | null;
  totalMarketCapChange24hPct: number | null;
  totalVolume24hUsd: number | null;
  btcDominancePct: number | null;
  btcDominanceChange24hPct: number | null;
  fearAndGreed: { value: number; classification: string; updated: string } | null;
  altcoinSeasonIndex: number | null;
  unavailable: Array<{ part: Part; reason: string }>;
}> = {
  name: "get_market_context",
  title: "Whole-market context",
  description:
    "What the whole crypto market did: total market cap and its 24h % change, BTC dominance, the Fear & Greed index and the Altcoin Season index. Sources: /v1/global-metrics/quotes/latest, /v3/fear-and-greed/latest, /v1/altcoin-season-index/latest.",
  inputSchema: z.object({}),
  run: (_input, ctx) =>
    withEvidence(ctx, async () => {
      const unavailable: Array<{ part: Part; reason: string }> = [];
      const g = await optional("globalMetrics", unavailable, async () => (await ctx.client.get<GlobalMetrics>("/v1/global-metrics/quotes/latest")).data);
      const fg = await optional("fearAndGreed", unavailable, async () => (await ctx.client.get<FearAndGreed>("/v3/fear-and-greed/latest")).data);
      const alt = await optional("altcoinSeason", unavailable, async () => (await ctx.client.get<AltcoinSeason>("/v1/altcoin-season-index/latest")).data);
      return {
        totalMarketCapUsd: g?.quote.USD.total_market_cap ?? null,
        totalMarketCapChange24hPct: g?.quote.USD.total_market_cap_yesterday_percentage_change ?? null,
        totalVolume24hUsd: g?.quote.USD.total_volume_24h ?? null,
        btcDominancePct: g?.btc_dominance ?? null,
        btcDominanceChange24hPct: g?.btc_dominance_24h_percentage_change ?? null,
        fearAndGreed: fg ? { value: fg.value, classification: fg.value_classification, updated: fg.update_time } : null,
        altcoinSeasonIndex: alt?.altcoin_index ?? null,
        unavailable,
      };
    }),
};

// ---------------------------------------------------------- get_coin_sectors

const sectorInput = z
  .object({
    symbol: z.string().trim().min(1).max(20).optional(),
    id: z.number().int().positive().optional(),
  })
  .refine((v) => v.symbol || v.id, { message: "Give a symbol or a CMC id" });

export const getCoinSectors: ToolDef<typeof sectorInput, {
  symbol: string | null;
  id: number | null;
  sectors: Array<{
    id: string;
    name: string;
    numTokens: number;
    avgPriceChangePct: number | null;
    marketCapUsd: number | null;
    marketCapChangePct: number | null;
    evidenceId: string;
  }>;
}> = {
  name: "get_coin_sectors",
  title: "Coin sectors",
  description:
    "The CoinMarketCap categories (sectors) a coin belongs to, with each sector's average price change and market-cap change. Pass a CMC id when you have one: tickers can be shared by several coins. Source: /v1/cryptocurrency/categories.",
  inputSchema: sectorInput,
  run: ({ symbol, id }, ctx) =>
    withEvidence(ctx, async () => {
      const { data, evidence } = await ctx.client.get<Category[]>("/v1/cryptocurrency/categories", id ? { id } : { symbol: symbol?.toUpperCase() });
      return {
        symbol: symbol?.toUpperCase() ?? null,
        id: id ?? null,
        sectors: data.map((c) => ({
          id: c.id,
          name: c.name.trim(),
          numTokens: c.num_tokens,
          avgPriceChangePct: c.avg_price_change,
          marketCapUsd: c.market_cap,
          marketCapChangePct: c.market_cap_change,
          evidenceId: evidence.id,
        })),
      };
    }),
};

// ---------------------------------------------------------- get_liquidations

interface Window {
  totalUsd: number;
  longUsd: number;
  shortUsd: number;
}

export const getLiquidations: ToolDef<z.ZodObject<Record<string, never>>, { h1: Window; h4: Window; h24: Window; lastUpdated: string }> = {
  name: "get_liquidations",
  title: "Derivatives liquidations",
  description:
    "Total, long and short derivatives liquidations across the market for the last 1h, 4h and 24h in USD. Heavy long liquidations often explain sharp drops. Source: /v5/derivatives/liquidations/quotes/latest.",
  inputSchema: z.object({}),
  run: (_input, ctx) =>
    withEvidence(ctx, async () => {
      const { data } = await ctx.client.get<Liquidations>("/v5/derivatives/liquidations/quotes/latest");
      const q = data.quotes.find((x) => x.symbol === "USD") ?? data.quotes[0];
      if (!q) throw new CmcError({ kind: "server", endpoint: "/v5/derivatives/liquidations/quotes/latest", message: "No liquidation data returned." });
      return {
        h1: { totalUsd: q.total_liquidations_1h, longUsd: q.long_liquidations_1h, shortUsd: q.short_liquidations_1h },
        h4: { totalUsd: q.total_liquidations_4h, longUsd: q.long_liquidations_4h, shortUsd: q.short_liquidations_4h },
        h24: { totalUsd: q.total_liquidations_24h, longUsd: q.long_liquidations_24h, shortUsd: q.short_liquidations_24h },
        lastUpdated: q.last_updated,
      };
    }),
};

// ------------------------------------------------------------ get_rwa_quotes

export const getRwaQuotes: ToolDef<z.ZodObject<{ symbols: typeof symbolList }>, {
  assets: Array<{
    rwaId: number;
    name: string;
    symbol: string;
    assetType: string;
    priceUsd: number | null;
    tokenizedMarketCapUsd: number | null;
    volume24hUsd: number | null;
    topTokens: Array<{ symbol: string; name: string; cmcId: number; priceUsd: number }>;
    lastUpdated: string;
    evidenceId: string;
  }>;
}> = {
  name: "get_rwa_quotes",
  title: "Real-world asset quotes",
  description:
    "Tokenized real-world asset prices (e.g. GOLD, SILVER): average tokenized price, tokenized market cap, volume and the main tokens that track it. Source: /v5/real-world-assets/quotes/latest.",
  inputSchema: z.object({ symbols: symbolList }),
  run: ({ symbols }, ctx) =>
    withEvidence(ctx, async () => {
      const { data, evidence } = await ctx.client.get<RwaQuotes>("/v5/real-world-assets/quotes/latest", { symbol: symbols.join(",") });
      return {
        assets: data.rwa_assets.map((a) => ({
          rwaId: a.rwa_id,
          name: a.name,
          symbol: a.symbol,
          assetType: a.asset_type,
          priceUsd: a.average_tokenized_price,
          tokenizedMarketCapUsd: a.tokenized_market_cap,
          volume24hUsd: a.tokenized_volume_24h,
          topTokens: (a.tokens ?? []).slice(0, 3).map((t) => ({ symbol: t.symbol, name: t.name, cmcId: t.crypto_id, priceUsd: t.price })),
          lastUpdated: a.last_updated,
          evidenceId: evidence.id,
        })),
      };
    }),
};
