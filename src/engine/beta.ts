/**
 * Beta: how strongly a coin moves with the whole market.
 * beta = covariance(coin daily returns, market daily returns) / variance(market daily returns)
 * A beta of 2 means "on average, when the market moves 1%, this coin moves 2%".
 */

export interface Point {
  /** ISO timestamp */
  t: string;
  v: number;
}

/** Day-over-day % change, keyed by the later day's date (YYYY-MM-DD). */
export function dailyReturns(series: Point[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const p of [...series].sort((a, b) => a.t.localeCompare(b.t))) {
    if (Number.isFinite(p.v) && p.v > 0) byDay.set(p.t.slice(0, 10), p.v);
  }
  const out = new Map<string, number>();
  let prev: number | undefined;
  for (const [date, v] of byDay) {
    if (prev !== undefined) out.set(date, (v / prev - 1) * 100);
    prev = v;
  }
  return out;
}

export interface BetaResult {
  beta: number;
  /** Number of overlapping daily returns used. */
  points: number;
}

export function computeBeta(coin: Point[], market: Point[], minPoints = 10): BetaResult | null {
  const c = dailyReturns(coin);
  const m = dailyReturns(market);
  const pairs: Array<[number, number]> = [];
  for (const [date, rc] of c) {
    const rm = m.get(date);
    if (rm !== undefined) pairs.push([rc, rm]);
  }
  if (pairs.length < minPoints) return null;

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const mc = mean(pairs.map(([x]) => x));
  const mm = mean(pairs.map(([, y]) => y));
  let cov = 0;
  let varM = 0;
  for (const [x, y] of pairs) {
    cov += (x - mc) * (y - mm);
    varM += (y - mm) ** 2;
  }
  if (varM < 1e-12) return null;
  return { beta: cov / varM, points: pairs.length };
}
