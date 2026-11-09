import { floorDiv, type Cents, type Shares } from "./money";

/** One append-only share_ledger row, in the shape the calc module needs. */
export interface LedgerEntry {
  id: string;
  date: string; // YYYY-MM-DD
  from: string; // holder id
  to: string; // holder id
  shares: Shares; // hundredths of a share, always > 0
  priceCents: Cents; // per whole share
  /** What was actually paid for the whole entry (may differ from shares × price by rounding). */
  amountCents: Cents;
  /** Set on a correction: the id of the entry this one reverses. */
  reversesId: string | null;
}

/** Every holder's balance: shares in minus shares out. Balances across all holders sum to zero. */
export function holdingsFromLedger(entries: readonly LedgerEntry[]): Map<string, Shares> {
  const h = new Map<string, Shares>();
  for (const e of entries) {
    h.set(e.to, (h.get(e.to) ?? 0n) + e.shares);
    h.set(e.from, (h.get(e.from) ?? 0n) - e.shares);
  }
  return h;
}

export function balanceOf(entries: readonly LedgerEntry[], holderId: string): Shares {
  return holdingsFromLedger(entries).get(holderId) ?? 0n;
}

/** Drop every entry that has been reversed, together with its reversing entry. */
export function withoutReversed(entries: readonly LedgerEntry[]): LedgerEntry[] {
  const reversed = new Set(entries.flatMap((e) => (e.reversesId ? [e.reversesId] : [])));
  return entries.filter((e) => !reversed.has(e.id) && e.reversesId === null);
}

/**
 * Cost basis by the average-cost method (Canadian adjusted cost base).
 * Acquisitions add the amount paid. A disposal removes the average cost of the shares sold.
 * Reversed entries and their corrections cancel out and are ignored.
 */
export function costBasisCents(entries: readonly LedgerEntry[], holderId: string): Cents {
  const relevant = withoutReversed(entries)
    .filter((e) => e.to === holderId || e.from === holderId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let shares = 0n;
  let cost = 0n;
  for (const e of relevant) {
    if (e.to === holderId) {
      shares += e.shares;
      cost += e.amountCents;
    } else {
      if (e.shares > shares) throw new RangeError(`holder ${holderId} disposes more shares than held`);
      cost -= e.shares === shares ? cost : floorDiv(cost * e.shares, shares);
      shares -= e.shares;
    }
  }
  return cost;
}
