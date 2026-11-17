/**
 * CMC symbol lookups return every coin that shares a ticker: `symbol=SOL`
 * includes "Solcoin" and "Sola Token" (listed before Solana itself). This picks
 * the coin a holder almost certainly means: active, best CMC rank, and for
 * unranked ties the oldest listing (lowest id).
 */
export interface RankedCoin {
  id: number;
  symbol: string;
  cmc_rank?: number | null;
  is_active?: number | null;
}

export function pickBestMatch<T extends RankedCoin>(coins: T[], symbol: string): T | undefined {
  const wanted = symbol.trim().toUpperCase();
  const score = (c: T) => [c.is_active === 0 ? 1 : 0, c.cmc_rank ?? Number.MAX_SAFE_INTEGER, c.id] as const;
  return coins
    .filter((c) => c.symbol?.toUpperCase() === wanted)
    .sort((a, b) => {
      const [sa, sb] = [score(a), score(b)];
      return sa[0] - sb[0] || sa[1] - sb[1] || sa[2] - sb[2];
    })[0];
}
