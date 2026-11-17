/**
 * Picks one meaningful "sector" for a coin out of CMC's category list.
 *
 * CMC categories mix real sectors ("Solana Ecosystem", "Tokenized Gold") with
 * trivia ("Alleged SEC Securities", "FTX Bankruptcy Estate", VC portfolios)
 * and with lists so broad they are the market itself ("Binance Ecosystem"
 * holds ~100% of total market cap). We skip all of those, plus tiny
 * categories and ones the coin itself dominates (comparing a coin with itself
 * would be circular), then take the MOST SPECIFIC remaining one: the smallest
 * by market cap, ties broken by fewer tokens.
 */

export interface SectorCandidate {
  name: string;
  numTokens: number;
  marketCapUsd: number | null;
  marketCapChangePct: number | null;
  evidenceId: string;
}

export interface ChosenSector {
  name: string;
  /** Market-cap-weighted 24h change of the sector, from CMC. */
  changePct: number;
  evidenceId: string;
}

const TRIVIA =
  /portfolio|bankruptcy|alleged|launchpad|estate|holdings|capital|ventures|labs|fund\b|incubat|accelerat|listing|made in|airdrop|testnet|sec\/cftc|\bsec\b|reserve|award/i;
const MIN_TOKENS = 5;
/** A coin worth more than half its category makes the comparison circular. */
const MAX_COIN_SHARE = 0.5;
/** A category holding more than this share of the whole market is just "the market". */
const MAX_MARKET_SHARE = 0.5;

/**
 * "Solana Ecosystem" is a real sector for Solana, but "Sophon Ecosystem" is not
 * one for Ethereum (it just lists ETH as a bridged asset).
 */
function isForeignEcosystem(categoryName: string, coinName: string): boolean {
  const m = /^(.*)\s+ecosystem$/i.exec(categoryName.trim());
  if (!m) return false;
  const chain = m[1]!.toLowerCase();
  const coin = coinName.toLowerCase();
  return !(coin.startsWith(chain) || chain.startsWith(coin));
}

export interface ChooseSectorOptions {
  coinName: string;
  coinMarketCapUsd: number | null;
  totalMarketCapUsd: number | null;
}

export function chooseSector(candidates: SectorCandidate[], { coinName, coinMarketCapUsd, totalMarketCapUsd }: ChooseSectorOptions): ChosenSector | null {
  const usable = candidates.filter(
    (c) =>
      !TRIVIA.test(c.name) &&
      !isForeignEcosystem(c.name, coinName) &&
      c.numTokens >= MIN_TOKENS &&
      c.marketCapChangePct !== null &&
      Number.isFinite(c.marketCapChangePct) &&
      (c.marketCapUsd ?? 0) > 0 &&
      (coinMarketCapUsd ?? 0) / (c.marketCapUsd as number) <= MAX_COIN_SHARE &&
      (!totalMarketCapUsd || (c.marketCapUsd as number) / totalMarketCapUsd <= MAX_MARKET_SHARE),
  );
  const best = usable.sort((a, b) => (a.marketCapUsd ?? 0) - (b.marketCapUsd ?? 0) || a.numTokens - b.numTokens)[0];
  return best ? { name: best.name.trim(), changePct: best.marketCapChangePct as number, evidenceId: best.evidenceId } : null;
}
