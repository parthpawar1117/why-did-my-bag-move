/**
 * Calls every CoinMarketCap endpoint this project uses, with your own key,
 * and saves the real responses to samples/. This is the project's
 * "visible evidence of a real API call" and tells us which endpoints the
 * current plan (Basic / Startup) can reach.
 *
 * Usage: npm run probe        (reads CMC_PRO_API_KEY from .env)
 *
 * The key is only ever sent as the X-CMC_PRO_API_KEY header. It is never
 * printed, logged, or written to disk.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://pro-api.coinmarketcap.com";
const apiKey = process.env.CMC_PRO_API_KEY;
if (!apiKey) {
  console.error("CMC_PRO_API_KEY is missing. Copy .env.example to .env and add your key.");
  process.exit(1);
}

interface ProbeResult {
  name: string;
  path: string;
  params: Record<string, string>;
  httpStatus: number;
  errorCode: number | null;
  errorMessage: string | null;
  creditCount: number | null;
  ok: boolean;
  file: string;
}

/** Keep samples readable: very long arrays are cut (40 items keeps a full month of daily history). */
const KEEP = 40;
function trim(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const kept = value.slice(0, KEEP).map((v) => trim(v, depth + 1));
    return value.length > KEEP ? [...kept, { _truncated: `${value.length - KEEP} more items omitted` }] : kept;
  }
  if (value && typeof value === "object" && depth < 12) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trim(v, depth + 1)]));
  }
  return value;
}

async function probe(name: string, path: string, params: Record<string, string> = {}): Promise<{ result: ProbeResult; body: unknown }> {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Accept: "application/json", "X-CMC_PRO_API_KEY": apiKey! } });
  const body = (await res.json().catch(() => null)) as { status?: Record<string, unknown> } | null;
  const status = body?.status ?? {};
  const file = `samples/${name}.json`;
  const result: ProbeResult = {
    name,
    path,
    params,
    httpStatus: res.status,
    errorCode: typeof status.error_code === "number" ? status.error_code : Number(status.error_code ?? NaN) || null,
    errorMessage: (status.error_message as string | null) ?? null,
    creditCount: typeof status.credit_count === "number" ? status.credit_count : null,
    ok: res.ok,
    file,
  };
  const request = { method: "GET", url: `${BASE}${path}`, params, headers: { "X-CMC_PRO_API_KEY": "<your key>" } };
  writeFileSync(file, JSON.stringify({ request, httpStatus: res.status, response: trim(body) }, null, 2) + "\n");
  console.log(`${res.ok ? "OK  " : "FAIL"} ${res.status} ${path} ${result.errorMessage ? `- ${result.errorMessage}` : ""}`);
  return { result, body };
}

function firstOf(body: unknown, pick: (data: unknown) => unknown): string | undefined {
  try {
    const v = pick((body as { data?: unknown })?.data);
    return v == null ? undefined : String(v);
  } catch {
    return undefined;
  }
}

async function main() {
  mkdirSync("samples", { recursive: true });
  const results: ProbeResult[] = [];
  const run = async (name: string, path: string, params?: Record<string, string>) => {
    const out = await probe(name, path, params);
    results.push(out.result);
    // Stay well under the Basic plan's per-minute limit.
    await new Promise((r) => setTimeout(r, 1500));
    return out.body;
  };

  await run("key-info", "/v1/key/info");
  await run("crypto-map", "/v1/cryptocurrency/map", { symbol: "BTC,ETH,SOL" });
  await run("quotes-latest", "/v3/cryptocurrency/quotes/latest", { symbol: "BTC,ETH,SOL" });
  await run("global-metrics-latest", "/v1/global-metrics/quotes/latest");
  await run("fear-and-greed-latest", "/v3/fear-and-greed/latest");
  await run("altcoin-season-latest", "/v1/altcoin-season-index/latest");
  const categories = await run("categories-for-sol", "/v1/cryptocurrency/categories", { symbol: "SOL" });
  const categoryId = firstOf(categories, (d) => (d as Array<{ id: string }>)[0]?.id);
  if (categoryId) await run("category-detail", "/v1/cryptocurrency/category", { id: categoryId, limit: "10" });
  await run("quotes-historical-sol", "/v3/cryptocurrency/quotes/historical", { symbol: "SOL", count: "31", interval: "daily" });
  await run("global-metrics-historical", "/v1/global-metrics/quotes/historical", { count: "31", interval: "daily" });
  await run("liquidations-latest", "/v5/derivatives/liquidations/quotes/latest");
  const rwaMap = await run("rwa-map", "/v5/real-world-assets/map", { limit: "20" });
  const rwaSymbol = firstOf(rwaMap, (d) => {
    const list = Array.isArray(d) ? d : ((d as Record<string, unknown>)?.rwa_assets as unknown[]);
    return (list?.[0] as { symbol?: string })?.symbol;
  });
  if (rwaSymbol) await run("rwa-quotes-latest", "/v5/real-world-assets/quotes/latest", { symbol: rwaSymbol });
  // Startup-and-above endpoints: expected to return 403 on the free Basic plan.
  await run("trending-latest", "/v1/cryptocurrency/trending/latest", { limit: "10" });
  await run("gainers-losers", "/v1/cryptocurrency/trending/gainers-losers", { limit: "10" });
  await run("price-performance-sol", "/v2/cryptocurrency/price-performance-stats/latest", { symbol: "SOL" });

  const lines = [
    "# CoinMarketCap endpoints used by this project",
    "",
    `Generated by \`npm run probe\` on ${new Date().toISOString()}. Each row links to the real request and response saved in this folder.`,
    "",
    "| Endpoint | HTTP | Works on this key's plan | Credits used | Saved response |",
    "|---|---|---|---|---|",
    ...results.map(
      (r) =>
        `| \`${r.path}\` | ${r.httpStatus} | ${r.ok ? "Yes" : `No (${r.errorMessage ?? "error"})`} | ${r.creditCount ?? "-"} | [${r.name}.json](./${r.name}.json) |`,
    ),
    "",
  ];
  writeFileSync("samples/ENDPOINTS.md", lines.join("\n"));
  console.log(`\nSaved ${results.length} responses to samples/ and a summary to samples/ENDPOINTS.md`);
}

main().catch((err) => {
  console.error("Probe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
