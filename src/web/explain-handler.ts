/**
 * POST /api/explain. Framework-agnostic (plain Request -> Response) so it can
 * be unit-tested without Next.js. The CMC key stays on the server; visitors
 * only ever see results and the (key-free) evidence.
 */
import { z } from "zod";
import { createCachedClient, type MemoryCacheStore } from "@/cmc/cache";
import { CmcError, createCmcClient, EvidenceLedger, type FetchLike } from "@/cmc/client";
import { trimForDisplay } from "@/cmc/trim";
import { explainPortfolio, parseHoldings, type Holding, type Report } from "@/engine/explain";
import type { RateLimiter } from "./rate-limit";

export interface ExplainDeps {
  apiKey: string | undefined;
  store: MemoryCacheStore;
  perVisitor: RateLimiter;
  global: RateLimiter;
  fetch?: FetchLike;
}

export interface ExplainResponse {
  report: Report;
  /** Raw CMC response for each evidence id, shortened for display. */
  raw: Record<string, unknown>;
}

const MAX_BODY_CHARS = 5_000;

const bodySchema = z.object({
  holdings: z.union([
    z.string().max(2_000),
    z.array(z.object({ symbol: z.string().trim().min(1).max(20), amount: z.number().positive() })).min(1).max(25),
  ]),
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function visitorKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function errorResponse(err: unknown): Response {
  if (err instanceof CmcError) {
    switch (err.kind) {
      case "auth":
        console.error("CMC auth error (check CMC_PRO_API_KEY)");
        return json(500, { error: "The server's CoinMarketCap key is not working. Please try again later." });
      case "rate_limit":
        return json(503, { error: "CoinMarketCap is rate-limiting right now. Please try again in a minute." }, { "retry-after": "60" });
      case "plan":
        return json(502, { error: "Part of this data needs a paid CoinMarketCap plan." });
      case "bad_request":
        return json(400, { error: err.message });
      default:
        return json(502, { error: "Could not reach CoinMarketCap. Please try again shortly." });
    }
  }
  console.error("Unexpected error in /api/explain:", err);
  return json(500, { error: "Something went wrong on our side." });
}

export async function handleExplain(request: Request, deps: ExplainDeps): Promise<Response> {
  if (!deps.apiKey) return json(500, { error: "CoinMarketCap API key is not configured on the server (set CMC_PRO_API_KEY)." });

  const visitor = deps.perVisitor.check(visitorKey(request));
  if (!visitor.ok) {
    return json(429, { error: `Too many requests. Try again in ${visitor.retryAfterSec}s.` }, { "retry-after": String(visitor.retryAfterSec) });
  }
  const global = deps.global.check("all");
  if (!global.ok) {
    return json(429, { error: `The demo is busy. Try again in ${global.retryAfterSec}s.` }, { "retry-after": String(global.retryAfterSec) });
  }

  let holdings: Holding[];
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return json(413, { error: "Request too large." });
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return json(400, { error: "Send { holdings: \"BTC:0.5 SOL:20\" }." });
    holdings = typeof parsed.data.holdings === "string" ? parseHoldings(parsed.data.holdings) : parsed.data.holdings;
  } catch (err) {
    return json(400, { error: err instanceof SyntaxError ? "Request body must be JSON." : err instanceof Error ? err.message : "Bad request." });
  }

  try {
    const ledger = new EvidenceLedger();
    const inner = createCmcClient({ apiKey: deps.apiKey, ledger, fetch: deps.fetch });
    const client = createCachedClient(inner, { ledger, store: deps.store });
    const report = await explainPortfolio(holdings, { client, ledger });
    const raw: Record<string, unknown> = {};
    for (const e of ledger.entries()) raw[e.id] = trimForDisplay(e.response, { maxItems: 8, maxString: 240 });
    return json(200, { report, raw } satisfies ExplainResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
