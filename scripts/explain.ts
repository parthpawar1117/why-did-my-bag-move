/**
 * Explain a portfolio's 24h move from the command line, using live CMC data.
 *
 * Usage: npm run explain -- BTC:0.1 SOL:20 ETH:1
 *        npm run explain -- --json BTC:0.1 SOL:20   (full report as JSON)
 */
import "dotenv/config";
import { CmcError } from "../src/cmc/client";
import { explainPortfolio, parseHoldings } from "../src/engine/explain";
import { createLiveContextFactory } from "../src/tools/live-context";

const args = process.argv.slice(2);
const json = args.includes("--json");
const input = args.filter((a) => a !== "--json").join(" ") || "BTC:0.1 ETH:1 SOL:20";

try {
  const holdings = parseHoldings(input);
  const ctx = createLiveContextFactory({ apiKey: process.env.CMC_PRO_API_KEY })();
  const report = await explainPortfolio(holdings, ctx);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n${report.narrative.headline}\n`);
    for (const line of report.narrative.lines) console.log(`  - ${line.text}`);
    console.log("\nBreakdown (24h, USD):");
    console.table(
      report.attribution.rows.map((r) => ({
        coin: r.symbol,
        value: r.valueUsd.toFixed(2),
        "24h %": r.change24hPct?.toFixed(2) ?? "n/a",
        beta: `${r.beta.toFixed(2)}${r.betaSource === "default" ? "*" : ""}`,
        sector: r.sector?.name ?? "-",
        market: r.marketUsd.toFixed(2),
        "sector $": r.sectorUsd.toFixed(2),
        specific: r.specificUsd.toFixed(2),
        "P&L": r.pnlUsd.toFixed(2),
      })),
    );
    if (report.warnings.length) console.log(`Notes:\n${report.warnings.map((w) => `  * ${w}`).join("\n")}`);
    console.log("\nEvidence (every CoinMarketCap call behind these numbers):");
    for (const e of report.evidence) {
      const params = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join("&");
      const state = e.ok ? (e.cached ? (e.stale ? "stale cache" : "cache") : `HTTP ${e.httpStatus}`) : `FAILED ${e.errorKind}`;
      console.log(`  [${e.id}] GET ${e.endpoint}${params ? `?${params}` : ""}  ${state}, ${e.creditCount ?? 0} credit(s)`);
    }
    const credits = report.evidence.reduce((s, e) => s + (e.cached ? 0 : (e.creditCount ?? 0)), 0);
    console.log(`\nTotal: ${report.evidence.length} calls, ${credits} credits.`);
  }
} catch (err) {
  console.error(err instanceof CmcError ? `CoinMarketCap error (${err.kind}): ${err.message}` : err instanceof Error ? err.message : err);
  process.exit(1);
}
