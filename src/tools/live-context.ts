/**
 * Builds real tool contexts: a cached CMC client plus a fresh evidence ledger
 * per call. The cache store is shared across calls; the ledger is not, so each
 * answer's citations start at E1.
 */
import { createCachedClient, MemoryCacheStore } from "@/cmc/cache";
import { createCmcClient, EvidenceLedger } from "@/cmc/client";
import type { ToolContext } from "./types";

export function createLiveContextFactory(options: { apiKey: string | undefined; store?: MemoryCacheStore }): () => ToolContext {
  const store = options.store ?? new MemoryCacheStore();
  // Fail fast (throws CmcError "auth") if the key is missing.
  createCmcClient({ apiKey: options.apiKey });
  return () => {
    const ledger = new EvidenceLedger();
    const inner = createCmcClient({ apiKey: options.apiKey, ledger });
    return { client: createCachedClient(inner, { ledger, store }), ledger };
  };
}
