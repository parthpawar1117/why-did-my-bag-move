/**
 * The parts of CoinMarketCap responses this project reads, typed from real
 * replies saved in samples/. Only fields we use are listed.
 */

/** /v3/cryptocurrency/quotes/latest: note `quote` is an ARRAY in v3. */
export interface V3Coin {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  cmc_rank: number | null;
  is_active: number;
  last_updated: string;
  quote: V3Quote[];
}

export interface V3Quote {
  symbol: string;
  price: number;
  volume_24h: number | null;
  percent_change_1h: number | null;
  percent_change_24h: number | null;
  percent_change_7d: number | null;
  percent_change_30d: number | null;
  market_cap: number | null;
  last_updated: string;
}

/** /v1/global-metrics/quotes/latest */
export interface GlobalMetrics {
  btc_dominance: number;
  btc_dominance_24h_percentage_change: number | null;
  eth_dominance: number;
  last_updated: string;
  quote: {
    USD: {
      total_market_cap: number;
      total_market_cap_yesterday: number | null;
      total_market_cap_yesterday_percentage_change: number | null;
      total_volume_24h: number;
      total_volume_24h_yesterday_percentage_change: number | null;
      altcoin_market_cap: number | null;
      last_updated: string;
    };
  };
}

/** /v3/fear-and-greed/latest */
export interface FearAndGreed {
  value: number;
  value_classification: string;
  update_time: string;
}

/** /v1/altcoin-season-index/latest */
export interface AltcoinSeason {
  altcoin_index: number;
  snapshot_time: string;
}

/** /v1/cryptocurrency/categories (one item) */
export interface Category {
  id: string;
  name: string;
  title: string;
  num_tokens: number;
  avg_price_change: number | null;
  market_cap: number | null;
  market_cap_change: number | null;
  volume_change: number | null;
  last_updated: string;
}

/** /v5/derivatives/liquidations/quotes/latest */
export interface Liquidations {
  quotes: Array<{
    symbol: string;
    total_liquidations_1h: number;
    long_liquidations_1h: number;
    short_liquidations_1h: number;
    total_liquidations_4h: number;
    long_liquidations_4h: number;
    short_liquidations_4h: number;
    total_liquidations_24h: number;
    long_liquidations_24h: number;
    short_liquidations_24h: number;
    last_updated: string;
  }>;
}

/** /v5/real-world-assets/quotes/latest */
export interface RwaQuotes {
  rwa_assets: Array<{
    rwa_id: number;
    name: string;
    symbol: string;
    slug: string;
    asset_type: string;
    rwa_rank: number | null;
    average_tokenized_price: number | null;
    tokenized_market_cap: number | null;
    tokenized_volume_24h: number | null;
    last_updated: string;
    tokens?: Array<{ symbol: string; name: string; price: number; crypto_id: number; market_cap: number | null }>;
  }>;
}
