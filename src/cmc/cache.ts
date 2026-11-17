/**
 * Caching layer in front of the CMC client.
 *
 * - Fresh cache: identical requests within the TTL are answered from memory,
 *   saving credits and staying under the per-minute rate limit.
 * - Stale fallback: if CMC is rate-limiting (429), failing (5xx) or
 *   unreachable, the last good answer (up to maxStaleMs old) is used instead
 *   and clearly marked `stale` in the evidence ledger.
 * - Plan, auth and bad-request errors are never hidden: those mean the
 *   request itself is wrong, and old data would be misleading.
 * - Identical requests made at the same moment share one CMC call.
 */
import { CmcError, type CmcClient, type CmcResult, type EvidenceEntry, type EvidenceLedger, type NewEvidence, type Params } from "./client";

interface CacheEntry {
  data: unknown;
  evidence: NewEvidence;
  storedAt: number;
}

/** Shared between requests; each request brings its own evidence ledger. */
export class MemoryCacheStore {
  readonly entries = new Map<string, CacheEntry>();
  readonly inFlight = new Map<string, Promise<CmcResult<unknown>>>();
}

const FALLBACK_KINDS = new Set(["rate_limit", "server", "network"]);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long an answer stays fresh, per endpoint. CMC's Basic data refreshes about every minute. */
export function defaultTtlMs(endpoint: string): number {
  if (endpoint.includes("/historical")) return HOUR;
  if (endpoint.endsWith("/map") || endpoint.endsWith("/info")) return DAY;
  if (endpoint.includes("/categories") || endpoint.endsWith("/category")) return HOUR;
  return MINUTE;
}

export function cacheKey(endpoint: string, params: Params): string {
  const sorted = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort();
  return `${endpoint}?${sorted.join("&")}`;
}

function withoutId(entry: EvidenceEntry): NewEvidence {
  const copy: Partial<EvidenceEntry> = { ...entry };
  delete copy.id;
  return copy as NewEvidence;
}

export interface CachedClientOptions {
  ledger: EvidenceLedger;
  store?: MemoryCacheStore;
  ttlMs?: (endpoint: string) => number;
  maxStaleMs?: number;
  now?: () => Date;
}

export function createCachedClient(inner: CmcClient, options: CachedClientOptions): CmcClient {
  const store = options.store ?? new MemoryCacheStore();
  const ttlMs = options.ttlMs ?? defaultTtlMs;
  const maxStaleMs = options.maxStaleMs ?? DAY;
  const now = () => (options.now ?? (() => new Date()))().getTime();

  function serveFromCache<T>(entry: CacheEntry, stale: boolean): CmcResult<T> {
    const evidence = options.ledger.record({ ...entry.evidence, cached: true, stale, ageMs: now() - entry.storedAt });
    return { data: entry.data as T, evidence };
  }

  return {
    async get<T>(endpoint: string, params: Params = {}): Promise<CmcResult<T>> {
      const key = cacheKey(endpoint, params);
      const cached = store.entries.get(key);
      if (cached && now() - cached.storedAt < ttlMs(endpoint)) return serveFromCache<T>(cached, false);

      const fallBackOr = (err: unknown): CmcResult<T> => {
        const canFallBack = err instanceof CmcError && FALLBACK_KINDS.has(err.kind);
        if (canFallBack && cached && now() - cached.storedAt <= maxStaleMs) return serveFromCache<T>(cached, true);
        throw err;
      };

      const pending = store.inFlight.get(key);
      if (pending) {
        try {
          const shared = await pending;
          return serveFromCache<T>({ data: shared.data, evidence: withoutId(shared.evidence), storedAt: now() }, false);
        } catch (err) {
          return fallBackOr(err);
        }
      }

      const call = inner.get<unknown>(endpoint, params);
      store.inFlight.set(key, call);
      try {
        const result = await call;
        store.entries.set(key, { data: result.data, evidence: withoutId(result.evidence), storedAt: now() });
        return result as CmcResult<T>;
      } catch (err) {
        return fallBackOr(err);
      } finally {
        store.inFlight.delete(key);
      }
    },
  };
}
