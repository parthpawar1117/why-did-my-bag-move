"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AttributionRow } from "@/engine/attribution";
import type { NarrativeLine } from "@/engine/narrative";
import { splitCitations } from "@/web/citations";
import type { ExplainResponse } from "@/web/explain-handler";
import { formatAgo, LIVE_INTERVAL_MS, LIVE_MAX_MS, liveStep, retryAfterMs, waitBeforeRequest } from "@/web/live";

const PRESETS = [
  { label: "Majors", value: "BTC:0.1 ETH:1 SOL:20" },
  { label: "Crypto + gold", value: "BTC:0.05 PAXG:0.5 ETH:0.5" },
  { label: "Altcoins", value: "SOL:15 LINK:40 AVAX:25 DOGE:2000" },
];

const money = (n: number, signed = false) =>
  `${signed ? (n < 0 ? "-" : "+") : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const compact = (n: number | null | undefined) =>
  n == null ? "n/a" : `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
const tone = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");

function focusEvidence(id: string) {
  const el = document.getElementById(`ev-${id}`);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

function Cited({ text }: { text: string }) {
  return (
    <>
      {splitCitations(text).map((part, i) =>
        "cite" in part ? (
          <button key={i} type="button" className="cite" onClick={() => focusEvidence(part.cite)} title={`Show CoinMarketCap call ${part.cite}`}>
            {part.cite}
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

const KIND_LABEL: Record<NarrativeLine["kind"], string> = {
  verdict: "Verdict",
  market: "Market",
  sector: "Sector",
  specific: "Coin-specific",
  driver: "Biggest driver",
  sentiment: "Sentiment",
  leverage: "Leverage",
};

function ComponentTiles({ components }: { components: { marketUsd: number; sectorUsd: number; specificUsd: number } }) {
  const items = [
    { key: "market", label: "Whole market", hint: "beta x market move", value: components.marketUsd },
    { key: "sector", label: "Sectors", hint: "sector vs market", value: components.sectorUsd },
    { key: "specific", label: "Coin-specific", hint: "news, flows, events", value: components.specificUsd },
  ];
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 0.01);
  return (
    <div className="tiles">
      {items.map((i) => (
        <div key={i.key} className={`tile ${i.key}`}>
          <span className="tile-label">{i.label}</span>
          <span className={`tile-value ${tone(i.value)}`}>{money(i.value, true)}</span>
          <span className="tile-bar" aria-hidden>
            <span style={{ width: `${(Math.abs(i.value) / max) * 100}%` }} />
          </span>
          <span className="tile-hint">{i.hint}</span>
        </div>
      ))}
    </div>
  );
}

/** One row's move split into market / sector / specific, drawn around a zero line. */
function SplitBar({ row, scale }: { row: AttributionRow; scale: number }) {
  const parts = [
    { key: "market", v: row.marketUsd },
    { key: "sector", v: row.sectorUsd },
    { key: "specific", v: row.specificUsd },
  ];
  const side = (positive: boolean) =>
    parts
      .filter((p) => (positive ? p.v > 0 : p.v < 0))
      .map((p) => <span key={p.key} className={`seg ${p.key}`} style={{ width: `${(Math.abs(p.v) / scale) * 50}%` }} />);
  return (
    <div className="splitbar" aria-label={`market ${money(row.marketUsd, true)}, sector ${money(row.sectorUsd, true)}, specific ${money(row.specificUsd, true)}`}>
      <div className="neg">{side(false)}</div>
      <div className="pos">{side(true)}</div>
    </div>
  );
}

function Breakdown({ rows }: { rows: AttributionRow[] }) {
  const scale = Math.max(...rows.map((r) => Math.max(r.marketUsd, 0) + Math.max(r.sectorUsd, 0) + Math.max(r.specificUsd, 0)), ...rows.map((r) => -(Math.min(r.marketUsd, 0) + Math.min(r.sectorUsd, 0) + Math.min(r.specificUsd, 0))), 0.01);
  return (
    <div className="table-wrap">
      <table className="breakdown">
        <thead>
          <tr>
            <th>Coin</th>
            <th className="num">Value</th>
            <th className="num">24h</th>
            <th className="num" title="How strongly the coin followed the market over 30 days">Beta</th>
            <th>Sector</th>
            <th className="bar-col">Where its move came from</th>
            <th className="num">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.symbol}</strong>
                <span className="muted small block">
                  {r.name} · {r.weightPct.toFixed(0)}%
                </span>
              </td>
              <td className="num">{money(r.valueUsd)}</td>
              <td className={`num ${tone(r.change24hPct ?? 0)}`}>{pct(r.change24hPct)}</td>
              <td className="num" title={r.betaSource === "history" ? `From ${r.betaPoints} days of history` : "Default: not enough history"}>
                {r.beta.toFixed(2)}
                {r.betaSource === "default" ? "*" : ""}
              </td>
              <td className="small">{r.sector ? `${r.sector.name} (${pct(r.sector.changePct)})` : <span className="muted">none</span>}</td>
              <td className="bar-col">
                <SplitBar row={r} scale={scale} />
                <span className="small muted">
                  mkt {money(r.marketUsd, true)} · sector {money(r.sectorUsd, true)} · specific {money(r.specificUsd, true)}
                </span>
              </td>
              <td className={`num ${tone(r.pnlUsd)}`}>
                <strong>{money(r.pnlUsd, true)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="legend small muted">
        <span className="dot market" /> market <span className="dot sector" /> sector <span className="dot specific" /> coin-specific · bars left of
        center lost money, right of center made money · * beta 1 assumed (not enough history)
      </p>
    </div>
  );
}

function EvidencePanel({ data }: { data: ExplainResponse }) {
  const evidence = data.report.evidence;
  const credits = evidence.reduce((s, e) => s + (e.cached ? 0 : (e.creditCount ?? 0)), 0);
  return (
    <section className="card" aria-labelledby="evidence-title">
      <h2 id="evidence-title">Evidence: every CoinMarketCap call behind these numbers</h2>
      <p className="muted small">
        {evidence.length} calls · {credits} credits · click a citation above to jump here. The API key is sent only as a server-side header and never
        reaches your browser.
      </p>
      <div className="evidence">
        {evidence.map((e) => {
          const query = new URLSearchParams(e.params).toString();
          const status = !e.ok ? `failed: ${e.errorKind}` : e.cached ? (e.stale ? "stale cache" : "cached") : `HTTP ${e.httpStatus}`;
          return (
            <details key={e.id} id={`ev-${e.id}`} className={`ev ${e.ok ? "" : "ev-failed"}`}>
              <summary>
                <span className="ev-id">{e.id}</span>
                <code className="ev-path">
                  GET {e.endpoint}
                  {query ? `?${decodeURIComponent(query)}` : ""}
                </code>
                <span className={`pill ${e.ok ? (e.cached ? "pill-cache" : "pill-ok") : "pill-fail"}`}>{status}</span>
                <span className="muted small">{e.cached ? "0 credits" : `${e.creditCount ?? 0} credit${e.creditCount === 1 ? "" : "s"}`}</span>
              </summary>
              <div className="ev-body">
                <p className="small muted">Request</p>
                <pre>{`GET ${e.url}\nAccept: application/json\nX-CMC_PRO_API_KEY: •••••• (server-side only)`}</pre>
                <p className="small muted">
                  Response{e.cached ? ` (from cache, ${Math.round((e.ageMs ?? 0) / 1000)}s old)` : ""} · data timestamp {e.timestamp}
                </p>
                <pre>{JSON.stringify(data.raw[e.id], null, 2)}</pre>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function Results({ data, liveBar }: { data: ExplainResponse; liveBar: React.ReactNode }) {
  const { report } = data;
  const a = report.attribution;
  const m = report.market;
  return (
    <div className="results">
      {liveBar}
      <section className="card headline-card">
        <p className={`headline ${tone(a.pnlUsd)}`}>
          <Cited text={report.narrative.headline} />
        </p>
        <ComponentTiles components={a.components} />
      </section>

      <section className="card" aria-labelledby="why-title">
        <h2 id="why-title">Why</h2>
        <ul className="lines">
          {report.narrative.lines.map((l, i) => (
            <li key={i} className={`line line-${l.kind}`}>
              <span className="line-kind">{KIND_LABEL[l.kind]}</span>
              <span>
                <Cited text={l.kind === "verdict" ? l.text.replace(/^Verdict:\s*/, "") : l.text} />
              </span>
            </li>
          ))}
        </ul>
        {report.warnings.length > 0 && (
          <div className="notes small">
            <strong>Notes</strong>
            <ul>
              {report.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="coins-title">
        <h2 id="coins-title">Coin by coin</h2>
        <Breakdown rows={a.rows} />
      </section>

      <section className="context">
        <div>
          <span className="muted small">Total market cap</span>
          <strong>{compact(m.totalMarketCapUsd)}</strong>
          <span className={`small ${tone(m.change24hPct ?? 0)}`}>{pct(m.change24hPct)} 24h</span>
        </div>
        <div>
          <span className="muted small">BTC dominance</span>
          <strong>{m.btcDominancePct == null ? "n/a" : `${m.btcDominancePct.toFixed(1)}%`}</strong>
        </div>
        <div>
          <span className="muted small">Fear &amp; Greed</span>
          <strong>{m.fearAndGreed ? m.fearAndGreed.value : "n/a"}</strong>
          <span className="small muted">{m.fearAndGreed?.classification ?? ""}</span>
        </div>
        <div>
          <span className="muted small">Altcoin season</span>
          <strong>{m.altcoinSeasonIndex ?? "n/a"}</strong>
          <span className="small muted">/ 100</span>
        </div>
      </section>

      <EvidencePanel data={data} />
    </div>
  );
}

function LiveBar(props: {
  live: boolean;
  onToggle: (on: boolean) => void;
  now: number;
  lastRunAt: number;
  startedAt: number;
  refreshing: boolean;
  deltaUsd: number | null;
  note: string | null;
}) {
  const nextIn = Math.max(0, LIVE_INTERVAL_MS - (props.now - props.lastRunAt));
  const leftMs = Math.max(0, LIVE_MAX_MS - (props.now - props.startedAt));
  return (
    <div className="livebar card">
      <label className="live-toggle">
        <input type="checkbox" checked={props.live} onChange={(e) => props.onToggle(e.target.checked)} />
        <span className={`live-dot ${props.live ? "on" : ""}`} aria-hidden />
        <strong>Live</strong>
        <span className="muted small">re-explain with fresh CoinMarketCap data every 2 min</span>
      </label>
      <span className="small muted" aria-live="polite">
        {props.refreshing ? "Refreshing..." : `Updated ${formatAgo(props.now - props.lastRunAt)}`}
        {props.live && !props.refreshing ? ` · next in ${Math.ceil(nextIn / 1000)}s · stops in ${Math.ceil(leftMs / 60_000)} min` : ""}
        {props.deltaUsd !== null && (
          <>
            {" · "}
            <span className={tone(props.deltaUsd)}>{money(props.deltaUsd, true)} since last update</span>
          </>
        )}
      </span>
      {props.note && <span className="small muted live-note">{props.note}</span>}
    </div>
  );
}

export function Explainer() {
  const [holdings, setHoldings] = useState(PRESETS[0]!.value);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExplainResponse | null>(null);
  const [live, setLive] = useState(false);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [deltaUsd, setDeltaUsd] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [lastRunAt, setLastRunAt] = useState(0);
  const [liveStartedAt, setLiveStartedAt] = useState(0);
  const [cooldownEnd, setCooldownEnd] = useState(0);
  // Refs so the 1-second timer always sees current values.
  const busy = useRef(false);
  const submitted = useRef(holdings);
  const lastPnl = useRef<number | null>(null);
  const lastRequestAt = useRef(0);
  const cooldownUntil = useRef(0);

  const run = useCallback(async (text: string, background: boolean) => {
    if (busy.current) return;
    const wait = waitBeforeRequest({ now: Date.now(), lastRequestAt: lastRequestAt.current, cooldownUntil: cooldownUntil.current });
    if (wait > 0) return; // the button shows the countdown; live mode retries on its own
    busy.current = true;
    lastRequestAt.current = Date.now();
    if (background) setRefreshing(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch("/api/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ holdings: text }) });
      const body = await res.json().catch(() => ({ error: `Unexpected reply (HTTP ${res.status}).` }));
      // Respect the server's cooldown instead of retrying straight away.
      if (res.status === 429 || res.status === 503) {
        cooldownUntil.current = Date.now() + retryAfterMs(res.headers.get("retry-after"));
        setCooldownEnd(cooldownUntil.current);
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const next = body as ExplainResponse;
      const pnl = next.report.attribution.pnlUsd;
      setDeltaUsd(background && lastPnl.current !== null ? pnl - lastPnl.current : null);
      lastPnl.current = pnl;
      setData(next);
      setError(null);
      setLiveNote(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      // In live mode keep showing the last good result and just note the failed refresh.
      if (background) setLiveNote(`Last refresh failed: ${message} Showing the previous result.`);
      else setError(message);
    } finally {
      busy.current = false;
      setLastRunAt(Date.now());
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Only a server cooldown (429) disables the button; the 2 s gap is invisible to normal use.
  const cooldownLeft = Math.max(0, cooldownEnd - now);

  async function explain(e?: React.FormEvent) {
    e?.preventDefault();
    submitted.current = holdings;
    lastPnl.current = null;
    setDeltaUsd(null);
    await run(holdings, false);
  }

  function toggleLive(on: boolean) {
    setLive(on);
    setLiveNote(null);
    if (on) {
      setLiveStartedAt(Date.now());
      void run(submitted.current, true);
    }
  }

  useEffect(() => {
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (!data) return;
      const blocked = busy.current || t < cooldownUntil.current;
      const step = liveStep({ enabled: live, hidden: document.hidden, busy: blocked, startedAt: liveStartedAt, lastRunAt, now: t });
      if (step === "refresh") void run(submitted.current, true);
      if (step === "expired") {
        setLive(false);
        setLiveNote("Live mode stopped after 10 minutes to save API credits. Switch it on again to continue.");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [data, live, liveStartedAt, lastRunAt, run]);

  return (
    <>
      <form className="card input-card" onSubmit={explain}>
        <label htmlFor="holdings">Your bag</label>
        <textarea
          id="holdings"
          value={holdings}
          onChange={(e) => setHoldings(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder="BTC:0.1 ETH:1 SOL:20 PAXG:0.5"
        />
        <div className="input-row">
          <div className="presets" role="group" aria-label="Example bags">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="chip" onClick={() => setHoldings(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
          <button type="submit" className="primary" disabled={loading || cooldownLeft > 0}>
            {loading ? "Asking CoinMarketCap..." : cooldownLeft > 0 ? `Wait ${Math.ceil(cooldownLeft / 1000)}s` : "Explain my move"}
          </button>
        </div>
        <p className="muted small">
          Format: <code>SYMBOL:amount</code>, separated by spaces or commas. Tokenized gold (PAXG, XAUt) works too. Nothing is stored.
        </p>
      </form>

      <div aria-live="polite">
        {error && (
          <p className="card error" role="alert">
            {error}
          </p>
        )}
        {data && !error && (
          <Results
            data={data}
            liveBar={
              <LiveBar
                live={live}
                onToggle={toggleLive}
                now={now}
                lastRunAt={lastRunAt}
                startedAt={liveStartedAt}
                refreshing={refreshing}
                deltaUsd={deltaUsd}
                note={liveNote}
              />
            }
          />
        )}
      </div>
    </>
  );
}
