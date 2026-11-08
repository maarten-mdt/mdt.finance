import { costBasisCents, holdingsFromLedger, withoutReversed, type LedgerEntry } from "./ledger";
import { floorDiv, type Cents, type Shares } from "./money";
import { valueCents } from "./price";

/** Shares a holder had at the end of `date` (YYYY-MM-DD). */
export function balanceAt(entries: readonly LedgerEntry[], holderId: string, date: string): Shares {
  return holdingsFromLedger(entries.filter((e) => e.date <= date)).get(holderId) ?? 0n;
}

/** Average-cost basis at the end of `date`. */
export function costBasisAt(entries: readonly LedgerEntry[], holderId: string, date: string): Cents {
  return costBasisCents(entries.filter((e) => e.date <= date), holderId);
}

export interface PricePoint {
  date: string;
  priceCents: Cents;
}

export interface ValuePoint {
  date: string;
  shares: Shares;
  priceCents: Cents;
  valueCents: Cents;
  costBasisCents: Cents;
}

/**
 * The holder's position at each valuation date, starting from their first acquisition:
 * shares held, value at that price, and what they had paid (cost basis).
 */
export function valueHistory(entries: readonly LedgerEntry[], holderId: string, prices: readonly PricePoint[]): ValuePoint[] {
  const firstIn = withoutReversed(entries)
    .filter((e) => e.to === holderId)
    .map((e) => e.date)
    .sort()[0];
  if (!firstIn) return [];
  return [...prices]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .filter((p) => p.date >= firstIn)
    .map((p) => {
      const shares = balanceAt(entries, holderId, p.date);
      return {
        date: p.date,
        shares,
        priceCents: p.priceCents,
        valueCents: valueCents(shares, p.priceCents),
        costBasisCents: costBasisAt(entries, holderId, p.date),
      };
    });
}

// ---- Cash credit -----------------------------------------------------------------------------

export type CreditType =
  | "dividend"
  | "payroll_saving"
  | "leftover_cash"
  | "top_up"
  | "payout"
  | "applied_to_purchase"
  | "correction";

export interface CreditEntry {
  id: string;
  type: CreditType;
  amountCents: Cents; // positive in, negative out
  reversesId: string | null;
}

export interface CreditSummary {
  balanceCents: Cents;
  dividendsCents: Cents;
  payrollSavingsCents: Cents;
  leftoverCents: Cents;
  topUpCents: Cents;
  /** Paid out to the holder's bank (positive number). */
  paidOutCents: Cents;
  /** Used toward share purchases (positive number). */
  appliedCents: Cents;
}

/** Cash credit held for a holder, broken down by where it came from and where it went. */
export function creditSummary(entries: readonly CreditEntry[]): CreditSummary {
  const reversed = new Set(entries.flatMap((e) => (e.reversesId ? [e.reversesId] : [])));
  const live = entries.filter((e) => !reversed.has(e.id) && e.reversesId === null);
  const sum = (t: CreditType) => live.filter((e) => e.type === t).reduce((a, e) => a + e.amountCents, 0n);
  return {
    balanceCents: live.reduce((a, e) => a + e.amountCents, 0n),
    dividendsCents: sum("dividend"),
    payrollSavingsCents: sum("payroll_saving"),
    leftoverCents: sum("leftover_cash"),
    topUpCents: sum("top_up"),
    paidOutCents: -sum("payout"),
    appliedCents: -sum("applied_to_purchase"),
  };
}

// ---- Ratios -----------------------------------------------------------------------------------

/** numerator ÷ denominator in basis points (1% = 100), rounded down; null without a positive base. */
export function ratioBps(numerator: bigint, denominator: bigint): bigint | null {
  if (denominator <= 0n) return null;
  return floorDiv(numerator * 10_000n, denominator);
}

export function formatBps(bps: bigint): string {
  const sign = bps > 0n ? "+" : bps < 0n ? "−" : "";
  const abs = bps < 0n ? -bps : bps;
  return `${sign}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}%`;
}
