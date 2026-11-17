/**
 * Thin, typed wrapper around the CoinMarketCap Pro API.
 *
 * Two jobs beyond fetching:
 * 1. Every call (success or failure) is written to an EvidenceLedger, so each
 *    number the app shows can be traced back to the exact request that
 *    produced it ([E1], [E2], ...).
 * 2. CMC's error replies are turned into a small set of error kinds the rest
 *    of the app can react to (e.g. "plan" means: hide that feature, carry on).
 *
 * The API key is only ever sent as the X-CMC_PRO_API_KEY header. It is never
 * put in a URL, an evidence entry, an error message or a log line.
 */

export const CMC_BASE_URL = "https://pro-api.coinmarketcap.com";

export type CmcErrorKind = "auth" | "plan" | "rate_limit" | "bad_request" | "server" | "network";

export type Params = Record<string, string | number | boolean | undefined>;

export class CmcError extends Error {
  readonly kind: CmcErrorKind;
  readonly httpStatus: number | null;
  readonly errorCode: number | null;
  readonly endpoint: string;

  constructor(opts: { kind: CmcErrorKind; message: string; endpoint: string; httpStatus?: number | null; errorCode?: number | null }) {
    super(opts.message);
    this.name = "CmcError";
    this.kind = opts.kind;
    this.endpoint = opts.endpoint;
    this.httpStatus = opts.httpStatus ?? null;
    this.errorCode = opts.errorCode ?? null;
  }
}

export interface EvidenceEntry {
  /** Short citation id used in explanations, e.g. "E3". */
  id: string;
  endpoint: string;
  params: Record<string, string>;
  /** Full request URL (never contains the key). */
  url: string;
  httpStatus: number | null;
  ok: boolean;
  errorKind?: CmcErrorKind;
  errorMessage?: string;
  /** Credits CMC charged for this call, from status.credit_count. */
  creditCount: number | null;
  /** When CMC produced the data (status.timestamp), or when we called. */
  timestamp: string;
  /** True when served from cache instead of a fresh call. */
  cached: boolean;
  /** True when a cached answer was used because the live call failed. */
  stale?: boolean;
  /** For cached answers: how old the data was when used, in milliseconds. */
  ageMs?: number;
  /** Raw JSON body, shown in the UI's evidence panel. */
  response: unknown;
}

export type NewEvidence = Omit<EvidenceEntry, "id">;

/** Append-only list of API calls made while answering one question. */
export class EvidenceLedger {
  private readonly list: EvidenceEntry[] = [];

  record(entry: NewEvidence): EvidenceEntry {
    const full: EvidenceEntry = { id: `E${this.list.length + 1}`, ...entry };
    this.list.push(full);
    return full;
  }

  entries(): EvidenceEntry[] {
    return [...this.list];
  }

  totalCredits(): number {
    return this.list.reduce((sum, e) => sum + (e.cached ? 0 : (e.creditCount ?? 0)), 0);
  }
}

export interface CmcResult<T> {
  data: T;
  evidence: EvidenceEntry;
}

export interface CmcClient {
  get<T = unknown>(endpoint: string, params?: Params): Promise<CmcResult<T>>;
}

/** The slice of `fetch` the client uses; easy to replace in tests. */
export type FetchLike = (url: URL, init: RequestInit) => Promise<Response>;

export interface CmcClientOptions {
  apiKey: string | undefined;
  fetch?: FetchLike;
  baseUrl?: string;
  ledger?: EvidenceLedger;
  now?: () => Date;
}

interface CmcStatus {
  timestamp?: string;
  error_code?: number | string | null;
  error_message?: string | null;
  credit_count?: number | null;
}

/** Map an HTTP status (and CMC error code) to an error kind. */
export function classifyError(httpStatus: number, errorCode: number | null): CmcErrorKind {
  if (httpStatus === 401) return "auth";
  if (httpStatus === 403) return errorCode === 1006 ? "plan" : "auth";
  if (httpStatus === 429) return "rate_limit";
  if (httpStatus >= 500) return "server";
  return "bad_request";
}

function cleanParams(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out[k] = String(v);
  return out;
}

export function createCmcClient(options: CmcClientOptions): CmcClient {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new CmcError({ kind: "auth", endpoint: "", message: "CMC_PRO_API_KEY is missing. Copy .env.example to .env and add your key." });
  }
  const fetchFn = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? CMC_BASE_URL;
  const ledger = options.ledger ?? new EvidenceLedger();
  const now = options.now ?? (() => new Date());

  return {
    async get<T>(endpoint: string, rawParams: Params = {}): Promise<CmcResult<T>> {
      const params = cleanParams(rawParams);
      const url = new URL(endpoint, baseUrl);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const base: Omit<NewEvidence, "httpStatus" | "ok" | "creditCount" | "timestamp" | "response"> = {
        endpoint,
        params,
        url: url.toString(),
        cached: false,
      };

      let res: Response;
      try {
        res = await fetchFn(url, { headers: { Accept: "application/json", "X-CMC_PRO_API_KEY": apiKey } });
      } catch (cause) {
        const message = `Could not reach CoinMarketCap (${cause instanceof Error ? cause.message : "network error"}).`;
        ledger.record({ ...base, httpStatus: null, ok: false, errorKind: "network", errorMessage: message, creditCount: null, timestamp: now().toISOString(), response: null });
        throw new CmcError({ kind: "network", endpoint, message });
      }

      const text = await res.text();
      let body: { status?: CmcStatus; data?: unknown } | null = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      const status = body?.status ?? {};
      const errorCode = status.error_code == null || status.error_code === "" ? null : Number(status.error_code) || null;
      const evidence: NewEvidence = {
        ...base,
        httpStatus: res.status,
        ok: res.ok && body !== null,
        creditCount: typeof status.credit_count === "number" ? status.credit_count : null,
        timestamp: status.timestamp ?? now().toISOString(),
        response: body,
      };

      if (!res.ok || body === null) {
        const kind = body === null ? "server" : classifyError(res.status, errorCode);
        const message = status.error_message || (body === null ? `CoinMarketCap returned a non-JSON reply (HTTP ${res.status}).` : `HTTP ${res.status}`);
        ledger.record({ ...evidence, ok: false, errorKind: kind, errorMessage: message });
        throw new CmcError({ kind, endpoint, message, httpStatus: res.status, errorCode });
      }

      return { data: body.data as T, evidence: ledger.record(evidence) };
    },
  };
}
