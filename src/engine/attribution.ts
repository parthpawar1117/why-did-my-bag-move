/**
 * Splits a portfolio's 24h move into three parts, per coin:
 *
 *   market   = beta x (whole-market 24h change)
 *   sector   = (sector 24h change) - (whole-market 24h change)   [0 if no sector]
 *   specific = coin's 24h change - market - sector               [what's left]
 *
 * In dollars each part is (value 24h ago) x part / 100, so the three parts add
 * up exactly to the coin's profit or loss. Pure function: no network.
 */
import type { ChosenSector } from "./sector";

export interface CoinFacts {
  symbol: string;
  name: string;
  id: number;
  priceUsd: number;
  change24hPct: number | null;
  beta: number;
  betaSource: "history" | "default";
  betaPoints: number;
  sector: ChosenSector | null;
  quoteEvidenceId: string;
  marketCapUsd?: number | null;
}

export interface MarketMove {
  change24hPct: number | null;
  evidenceId: string | null;
}

export interface AttributionRow extends CoinFacts {
  amount: number;
  valueUsd: number;
  previousValueUsd: number;
  weightPct: number;
  pnlUsd: number;
  marketUsd: number;
  sectorUsd: number;
  specificUsd: number;
  /** % move expected from market + sector alone. */
  expectedPct: number;
}

export type Component = "market" | "sector" | "specific";

export interface Attribution {
  totalValueUsd: number;
  previousValueUsd: number;
  pnlUsd: number;
  pnlPct: number;
  components: { marketUsd: number; sectorUsd: number; specificUsd: number };
  /** Which part explains the most, or "flat" if nothing moved. */
  dominant: Component | "flat";
  /** Value-weighted beta of the whole bag. */
  portfolioBeta: number;
  biggestDriver: AttributionRow | null;
  rows: AttributionRow[];
  warnings: string[];
}

export function attribute(holdings: Array<{ coin: CoinFacts; amount: number }>, market: MarketMove): Attribution {
  const warnings: string[] = [];
  if (market.change24hPct === null) warnings.push("Whole-market change was unavailable, so no part of the move is attributed to the market.");
  const m = market.change24hPct ?? 0;

  const partial = holdings.map(({ coin, amount }) => {
    if (coin.change24hPct === null) warnings.push(`No 24h change for ${coin.symbol}, treated as flat.`);
    const r = coin.change24hPct ?? 0;
    const valueUsd = amount * coin.priceUsd;
    const previousValueUsd = r > -100 ? valueUsd / (1 + r / 100) : valueUsd;
    const marketPct = market.change24hPct === null ? 0 : coin.beta * m;
    const sectorPct = coin.sector ? coin.sector.changePct - m : 0;
    const specificPct = r - marketPct - sectorPct;
    return {
      ...coin,
      amount,
      valueUsd,
      previousValueUsd,
      pnlUsd: valueUsd - previousValueUsd,
      marketUsd: (previousValueUsd * marketPct) / 100,
      sectorUsd: (previousValueUsd * sectorPct) / 100,
      specificUsd: (previousValueUsd * specificPct) / 100,
      expectedPct: marketPct + sectorPct,
    };
  });

  const sum = (f: (r: (typeof partial)[number]) => number) => partial.reduce((s, r) => s + f(r), 0);
  const totalValueUsd = sum((r) => r.valueUsd);
  const previousValueUsd = sum((r) => r.previousValueUsd);
  const pnlUsd = sum((r) => r.pnlUsd);
  const components = { marketUsd: sum((r) => r.marketUsd), sectorUsd: sum((r) => r.sectorUsd), specificUsd: sum((r) => r.specificUsd) };
  const rows: AttributionRow[] = partial.map((r) => ({ ...r, weightPct: totalValueUsd > 0 ? (r.valueUsd / totalValueUsd) * 100 : 0 }));

  const ranked = (
    [
      ["market", components.marketUsd],
      ["sector", components.sectorUsd],
      ["specific", components.specificUsd],
    ] as Array<[Component, number]>
  ).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const dominant = Math.abs(ranked[0]![1]) < 0.005 ? "flat" : ranked[0]![0];

  const biggest = [...rows].sort((a, b) => Math.abs(b.pnlUsd) - Math.abs(a.pnlUsd))[0];

  return {
    totalValueUsd,
    previousValueUsd,
    pnlUsd,
    pnlPct: previousValueUsd > 0 ? (pnlUsd / previousValueUsd) * 100 : 0,
    components,
    dominant,
    portfolioBeta: rows.reduce((s, r) => s + (r.weightPct / 100) * r.beta, 0),
    biggestDriver: biggest && Math.abs(biggest.pnlUsd) > 0 ? biggest : null,
    rows,
    warnings,
  };
}
