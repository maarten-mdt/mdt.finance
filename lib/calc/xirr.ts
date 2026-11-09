import type { Cents } from "./money";

export interface CashFlow {
  date: string; // YYYY-MM-DD
  /** Money out (purchases) is negative; money in (dividends, sales, current value) is positive. */
  amountCents: Cents;
}

const DAY_MS = 86_400_000;

/**
 * Annualized rate of return over irregular cash flows, the same definition as Excel's XIRR:
 * the rate r where Σ amount / (1 + r)^(days since first flow / 365) = 0.
 *
 * This is the one place a floating-point number appears: a rate of return is a ratio, not money.
 * No money or share amount is ever derived from it. Returns null when there is no answer
 * (all flows the same sign) or it doesn't converge.
 */
export function xirr(flows: readonly CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const hasOut = flows.some((x) => x.amountCents < 0n);
  const hasIn = flows.some((x) => x.amountCents > 0n);
  if (!hasOut || !hasIn) return null;

  const t0 = Math.min(...flows.map((x) => Date.parse(`${x.date}T00:00:00Z`)));
  const pts = flows.map((x) => ({ t: (Date.parse(`${x.date}T00:00:00Z`) - t0) / DAY_MS / 365, v: Number(x.amountCents) }));
  const npv = (r: number) => pts.reduce((s, p) => s + p.v / (1 + r) ** p.t, 0);
  const dnpv = (r: number) => pts.reduce((s, p) => s - (p.t * p.v) / (1 + r) ** (p.t + 1), 0);

  // Newton's method from Excel's default guess, then bisection as a fallback.
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const d = dnpv(r);
    if (!Number.isFinite(d) || d === 0) break;
    const next = r - npv(r) / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  let lo = -0.9999;
  let hi = 100;
  let flo = npv(lo);
  if (flo * npv(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-12) return mid;
    if (fm * flo < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return null;
}

/** XIRR in basis points (1% = 100), rounded to the nearest, for display with formatBps. */
export function xirrBps(flows: readonly CashFlow[]): bigint | null {
  const r = xirr(flows);
  return r === null ? null : BigInt(Math.round(r * 10_000));
}
