/**
 * Turns the numbers into plain-English sentences. Rule-based (no AI model):
 * every sentence is built from computed figures and carries [E#] citations to
 * the CoinMarketCap calls those figures came from.
 */
import type { Report } from "./explain";

export interface NarrativeLine {
  /** Which part of the explanation this is (handy for UI styling). */
  kind: "verdict" | "market" | "sector" | "specific" | "driver" | "sentiment" | "leverage";
  text: string;
  /** Evidence ids cited in `text`, e.g. ["E1", "E4"]. */
  cites: string[];
}

export interface Narrative {
  headline: string;
  lines: NarrativeLine[];
  markdown: string;
}

const money = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (n: number) => `${n < 0 ? "-" : "+"}${money(n)}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const compactMoney = (n: number) => `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
const tag = (id: string | null | undefined) => (id ? ` [${id}]` : "");

function line(kind: NarrativeLine["kind"], text: string): NarrativeLine {
  const cites = [...new Set([...text.matchAll(/\[(E\d+)\]/g)].map((m) => m[1]!))];
  return { kind, text, cites };
}

const DOMINANT_TEXT = {
  market: "mostly a market-wide move",
  sector: "mostly a sector move",
  specific: "mostly coin-specific (news, flows or events around your coins)",
  flat: "basically flat",
} as const;

export function writeNarrative(report: Pick<Report, "attribution" | "market" | "liquidations" | "historyEvidenceIds">): Narrative {
  const a = report.attribution;
  const m = report.market;
  const headline = `Your bag is ${a.pnlUsd < 0 ? "down" : "up"} ${money(a.pnlUsd)} (${pct(a.pnlPct)}) over 24h, now worth ${money(a.totalValueUsd)}.`;
  const lines: NarrativeLine[] = [];
  const quoteIds = [...new Set(a.rows.map((r) => r.quoteEvidenceId))];

  lines.push(line("verdict", `Verdict: ${DOMINANT_TEXT[a.dominant]}.${quoteIds.map(tag).join("")}`));

  // Market
  if (m.change24hPct !== null) {
    const betaCites = a.rows.some((r) => r.betaSource === "history") ? report.historyEvidenceIds.map(tag).join("") : "";
    lines.push(
      line(
        "market",
        `The whole crypto market moved ${pct(m.change24hPct)} in 24h${tag(m.evidenceId)}. Given how strongly your coins follow it (value-weighted beta ${a.portfolioBeta.toFixed(2)}${betaCites}), that explains ${signedMoney(a.components.marketUsd)} of your move.`,
      ),
    );
  } else {
    lines.push(line("market", "Whole-market data was unavailable, so none of the move is attributed to the market."));
  }

  // Sector
  const withSector = a.rows.filter((r) => r.sector).sort((x, y) => Math.abs(y.sectorUsd) - Math.abs(x.sectorUsd));
  if (withSector.length > 0) {
    const parts = withSector
      .slice(0, 3)
      .map((r) => `${r.symbol}'s sector "${r.sector!.name}" moved ${pct(r.sector!.changePct)}${tag(r.sector!.evidenceId)}`);
    const vs = m.change24hPct !== null ? ` against the market's ${pct(m.change24hPct)}` : "";
    lines.push(line("sector", `Sector moves account for ${signedMoney(a.components.sectorUsd)}: ${parts.join("; ")}${vs}.`));
  }

  // Coin-specific
  const topSpecific = [...a.rows].sort((x, y) => Math.abs(y.specificUsd) - Math.abs(x.specificUsd))[0];
  if (topSpecific) {
    let text = `${signedMoney(a.components.specificUsd)} is specific to your coins, beyond what the market and sectors explain.`;
    if (Math.abs(topSpecific.specificUsd) >= 0.01 && topSpecific.change24hPct !== null) {
      text += ` Biggest gap: ${topSpecific.symbol} moved ${pct(topSpecific.change24hPct)}${tag(topSpecific.quoteEvidenceId)} versus ${pct(topSpecific.expectedPct)} expected from market and sector, so check ${topSpecific.name}-specific news.`;
    }
    lines.push(line("specific", text));
  }

  // Biggest driver
  if (a.rows.length > 1 && a.biggestDriver && Math.abs(a.pnlUsd) > 0) {
    const d = a.biggestDriver;
    const share = Math.abs((d.pnlUsd / a.pnlUsd) * 100);
    lines.push(
      line(
        "driver",
        `${d.symbol} moved your bag the most: ${signedMoney(d.pnlUsd)} (${share.toFixed(0)}% of the net move), at ${d.weightPct.toFixed(0)}% of the bag${tag(d.quoteEvidenceId)}.`,
      ),
    );
  }

  // Sentiment
  if (m.fearAndGreed) {
    lines.push(line("sentiment", `Sentiment: the Fear & Greed index is ${m.fearAndGreed.value}/100 ("${m.fearAndGreed.classification}")${tag(m.fearAndGreed.evidenceId)}.`));
  }

  // Leverage
  const liq = report.liquidations;
  if (liq && liq.h24.totalUsd > 0) {
    const longShare = (liq.h24.longUsd / liq.h24.totalUsd) * 100;
    let text = `Leverage: ${compactMoney(liq.h24.totalUsd)} of positions were liquidated in 24h, ${longShare.toFixed(0)}% of them longs${tag(liq.evidenceId)}`;
    if (longShare >= 60) text += ", so forced selling likely deepened any drop";
    else if (longShare <= 40) text += ", so a short squeeze likely added to any rise";
    lines.push(line("leverage", `${text}.`));
  }

  const markdown = [`**${headline}**`, "", ...lines.map((l) => `- ${l.text}`)].join("\n");
  return { headline, lines, markdown };
}
