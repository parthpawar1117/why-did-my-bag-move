import { readFileSync } from "node:fs";
import { vi } from "vitest";
import type { FetchLike } from "@/cmc/client";

export const TEST_KEY = ["test", "key", "not", "real", "0000"].join("-");

/** Removes the `{ _truncated: "N more items omitted" }` notes the probe adds to shortened lists. */
function dropTruncationNotes(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => !(v && typeof v === "object" && "_truncated" in v)).map(dropTruncationNotes);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, dropTruncationNotes(v)]));
  }
  return value;
}

/** A real response captured by `npm run probe` (minus the probe's truncation notes). */
export function sample(name: string): { httpStatus: number; response: unknown } {
  const saved = JSON.parse(readFileSync(`samples/${name}.json`, "utf8")) as { httpStatus: number; response: unknown };
  return { httpStatus: saved.httpStatus, response: dropTruncationNotes(saved.response) };
}

/** Which saved sample answers which endpoint. */
const ROUTES: Record<string, string> = {
  "/v3/cryptocurrency/quotes/latest": "quotes-latest",
  "/v1/global-metrics/quotes/latest": "global-metrics-latest",
  "/v3/fear-and-greed/latest": "fear-and-greed-latest",
  "/v1/altcoin-season-index/latest": "altcoin-season-latest",
  "/v1/cryptocurrency/categories": "categories-for-sol",
  "/v5/derivatives/liquidations/quotes/latest": "liquidations-latest",
  "/v5/real-world-assets/quotes/latest": "rwa-quotes-latest",
  "/v3/cryptocurrency/quotes/historical": "quotes-historical-sol",
  "/v1/global-metrics/quotes/historical": "global-metrics-historical",
  "/v1/cryptocurrency/trending/latest": "trending-latest",
};

/**
 * A fake CoinMarketCap: answers each endpoint with its real saved response.
 * `overrides` replaces the reply for specific endpoints (e.g. to simulate a 403).
 */
export function fakeCmc(overrides: Record<string, () => Response> = {}) {
  return vi.fn<FetchLike>(async (url) => {
    const path = url.pathname;
    const override = overrides[path];
    if (override) return override();
    const name = ROUTES[path];
    if (!name) return new Response(JSON.stringify({ status: { error_code: 400, error_message: `no fixture for ${path}` } }), { status: 400 });
    const { httpStatus, response } = sample(name);
    return new Response(JSON.stringify(response), { status: httpStatus });
  });
}

export function cmcError(httpStatus: number, errorCode: number, message = "error"): () => Response {
  return () => new Response(JSON.stringify({ status: { error_code: errorCode, error_message: message, credit_count: 0 } }), { status: httpStatus });
}
