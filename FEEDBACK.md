# Feedback on the CoinMarketCap API

Notes from building *Why did my bag move?* on the free Basic plan, November 2026. Each point comes from a real call. The responses are saved in [`samples/`](samples/), and most points are also pinned down by a test in [`tests/`](tests/).

## What the API made possible

- **Portfolio attribution on a free key.** The Basic plan still includes `/v3/cryptocurrency/quotes/historical` and `/v1/global-metrics/quotes/historical` (daily, up to a year back). That is enough to compute each coin's 30-day beta against the total market cap, and beta is the core of splitting a move into "market" and "coin-specific".
- **Whole portfolios in one call.** Both `quotes/latest` and `quotes/historical` accept several ids in one request (`id=1,1027,5426,4705`). A 4-coin portfolio's live prices cost 1 credit and its 30-day history 2 credits.
- **Sector context that price-only APIs lack.** `/v1/cryptocurrency/categories?id=` returns each coin's categories with a market-cap-weighted 24h change. That turns "SOL is up" into "SOL's sector (Solana Ecosystem) is up 2.1% against a market up 1.4%".
- **Context beyond price.** Fear & Greed, the Altcoin Season index and derivatives liquidations (long vs short) let the explanation say *why* a drop might have been sharp, not just that it happened.
- **Real-world assets.** `/v5/real-world-assets/*` plus tokenized-gold tokens (PAXG, XAUt) in the normal quotes mean a crypto + gold portfolio can be explained with one API.
- **Cost transparency.** `status.credit_count` on every reply let us show users exactly what each explanation cost. `/v1/key/info` costing 0 credits makes a free "is my key OK?" check possible.
- **Clear plan errors.** Unsupported endpoints return a specific `403` with `error_code: 1006`, so the app can tell "not on your plan" apart from "bad key" and hide that feature instead of failing.

## Where it got in the way

1. **Ticker lookups are ambiguous, with impostors listed first.** `quotes/latest?symbol=BTC,ETH,SOL` returned 28 coins, not 3. For `SOL` it returned "Solcoin" (id 591) and "Sola Token" (id 3333) **before** Solana (id 5426, rank 7). Code that takes the first match silently prices the wrong asset. We resolve tickers ourselves (active coin, best `cmc_rank`) and switch to ids as soon as possible.
   *Suggestion:* a `symbol_match=best` option, or sorting matches by rank.
2. **v3 changed the quote shape, inconsistently.** In `/v3/cryptocurrency/quotes/latest`, `quote` is now an **array** of `{ symbol, price, ... }`. In `/v3/cryptocurrency/quotes/historical` it is still the v1/v2 **object** `quote.USD`. Most tutorials and older code break silently on one or the other.
3. **`status.error_code` changes type.** It is the string `"0"` on success but a number (`1006`) on errors.
4. **Category lists mix sectors, trivia and "the whole market".** For SOL, `/v1/cryptocurrency/categories` returns "Solana Ecosystem" alongside:
   - **trivia** such as "Alleged SEC Securities", "FTX Bankruptcy Estate" and about a dozen VC portfolios;
   - **lists that are effectively the whole market:** "Binance Ecosystem" has 1,390 tokens and $2.2T, about 100% of total market cap, and is attached to ETH, SOL and even PAXG;
   - **other chains' ecosystems:** ETH is listed in "Sophon Ecosystem".

   Several categories show a `last_updated` from 2023. Choosing a meaningful sector needed a filter of our own.
   *Suggestion:* a category `type` field (sector / ecosystem / portfolio / thematic), or a primary sector per coin.
5. **RWA quotes have no 24h change.** `/v5/real-world-assets/quotes/latest` returns price, tokenized market cap and volume but no `percent_change_24h`, so a 24h move has to come from a tracking token (PAXG) instead of the asset itself.
6. **The best "what moved" endpoints are paywalled.** `trending/latest`, `trending/gainers-losers` and `price-performance-stats/latest` all return `403 / 1006` on Basic. A Basic-only app has to compute movers itself.
7. **24h windows are not aligned.** A coin's `percent_change_24h` is rolling, while the global `total_market_cap_yesterday_percentage_change` compares against a "yesterday" snapshot. For attribution these should ideally cover the identical window.
   *Suggestion:* a rolling `percent_change_24h` on global metrics.
8. **The hackathon plan upgrade wasn't visible right away.** After registering with the CMC account email, the dashboard still showed Basic. That pushed us to design for Basic, which in the end made the app sturdier for the judging period anyway.

## Net

The free tier is surprisingly capable: history, sectors, sentiment, liquidations and RWAs are enough for real portfolio attribution. Most of the friction came from data hygiene (ambiguous tickers, mixed category types, inconsistent shapes), not missing data. A little more structure in the responses would remove most of the defensive code this project needed.
