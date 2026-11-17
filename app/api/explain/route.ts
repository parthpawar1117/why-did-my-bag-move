import { MemoryCacheStore } from "@/cmc/cache";
import { handleExplain, type ExplainDeps } from "@/web/explain-handler";
import { createRateLimiter } from "@/web/rate-limit";

// Shared across requests on this server instance: the CMC cache and the rate limits.
const deps: ExplainDeps = {
  get apiKey() {
    return process.env.CMC_PRO_API_KEY;
  },
  store: new MemoryCacheStore(),
  perVisitor: createRateLimiter({ limit: 6, windowMs: 60_000 }),
  global: createRateLimiter({ limit: 20, windowMs: 60_000 }),
};

export async function POST(request: Request): Promise<Response> {
  return handleExplain(request, deps);
}
