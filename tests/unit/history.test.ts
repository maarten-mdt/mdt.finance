import { describe, expect, it } from "vitest";
import {
  balanceAt,
  costBasisAt,
  creditSummary,
  formatBps,
  ratioBps,
  valueHistory,
  type CreditEntry,
  type LedgerEntry,
} from "@/lib/calc";

// Whole shares here; the ledger stores hundredths and the amount paid defaults to shares × price.
const e = (p: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "date" | "from" | "to" | "shares" | "priceCents">): LedgerEntry => ({
  reversesId: null,
  ...p,
  shares: p.shares * 100n,
  amountCents: p.amountCents ?? p.shares * p.priceCents,
});

const ledger: LedgerEntry[] = [
  e({ id: "1", date: "2023-07-01", from: "VRH", to: "A", shares: 100n, priceCents: 1500n }),
  e({ id: "2", date: "2024-07-01", from: "VRH", to: "A", shares: 50n, priceCents: 2000n }),
  e({ id: "3", date: "2025-07-01", from: "A", to: "VRH", shares: 30n, priceCents: 2400n }),
];

describe("balanceAt / costBasisAt", () => {
  it("counts only movements on or before the date", () => {
    expect(balanceAt(ledger, "A", "2023-06-30")).toBe(0n);
    expect(balanceAt(ledger, "A", "2023-07-01")).toBe(10_000n);
    expect(balanceAt(ledger, "A", "2024-12-31")).toBe(15_000n);
    expect(balanceAt(ledger, "A", "2026-01-01")).toBe(12_000n);
  });

  it("cost basis follows average cost as of the date", () => {
    expect(costBasisAt(ledger, "A", "2024-07-01")).toBe(250_000n);
    // after selling 30 of 150, 4/5 of $2,500 remains
    expect(costBasisAt(ledger, "A", "2025-07-01")).toBe(200_000n);
  });
});

describe("valueHistory", () => {
  const prices = [
    { date: "2022-07-01", priceCents: 1200n },
    { date: "2023-07-01", priceCents: 1500n },
    { date: "2025-07-01", priceCents: 2400n },
    { date: "2024-07-01", priceCents: 2000n },
  ];

  it("gives one point per valuation from the first purchase, in date order", () => {
    const h = valueHistory(ledger, "A", prices);
    expect(h.map((p) => p.date)).toEqual(["2023-07-01", "2024-07-01", "2025-07-01"]);
    expect(h[1]).toEqual({ date: "2024-07-01", shares: 15_000n, priceCents: 2000n, valueCents: 300_000n, costBasisCents: 250_000n });
    expect(h[2]).toMatchObject({ shares: 12_000n, valueCents: 288_000n, costBasisCents: 200_000n });
  });

  it("is empty for someone who never held shares", () => {
    expect(valueHistory(ledger, "Z", prices)).toEqual([]);
  });
});

describe("creditSummary", () => {
  const c = (p: Partial<CreditEntry> & Pick<CreditEntry, "id" | "type" | "amountCents">): CreditEntry => ({ reversesId: null, ...p });

  it("splits the balance by source and use", () => {
    const s = creditSummary([
      c({ id: "1", type: "dividend", amountCents: 4_000n }),
      c({ id: "2", type: "dividend", amountCents: 5_000n }),
      c({ id: "3", type: "payout", amountCents: -4_000n }),
      c({ id: "4", type: "leftover_cash", amountCents: 1_234n }),
      c({ id: "5", type: "payroll_saving", amountCents: 20_000n }),
      c({ id: "6", type: "applied_to_purchase", amountCents: -10_000n }),
    ]);
    expect(s).toEqual({
      balanceCents: 16_234n,
      dividendsCents: 9_000n,
      payrollSavingsCents: 20_000n,
      leftoverCents: 1_234n,
      topUpCents: 0n,
      paidOutCents: 4_000n,
      appliedCents: 10_000n,
    });
  });

  it("ignores reversed entries and their corrections", () => {
    const s = creditSummary([
      c({ id: "1", type: "dividend", amountCents: 9_999n }),
      c({ id: "2", type: "correction", amountCents: -9_999n, reversesId: "1" }),
      c({ id: "3", type: "dividend", amountCents: 100n }),
    ]);
    expect(s.balanceCents).toBe(100n);
    expect(s.dividendsCents).toBe(100n);
  });
});

describe("ratioBps / formatBps", () => {
  it("expresses a ratio in basis points, rounded down", () => {
    expect(ratioBps(50_000n, 200_000n)).toBe(2500n);
    expect(ratioBps(1n, 3n)).toBe(3333n);
    expect(ratioBps(-1n, 3n)).toBe(-3334n);
  });

  it("has no ratio without a positive base", () => {
    expect(ratioBps(5n, 0n)).toBeNull();
  });

  it("formats basis points as a signed percent", () => {
    expect(formatBps(2500n)).toBe("+25.00%");
    expect(formatBps(-3334n)).toBe("−33.34%");
    expect(formatBps(0n)).toBe("0.00%");
  });
});

describe("reversals dated later cancel the original for past dates too", () => {
  // Bought 176 in 2024; "Start over" reversed it in Nov 2026; re-entered with the original date.
  const restarted: LedgerEntry[] = [
    e({ id: "1", date: "2024-10-01", from: "VRH", to: "D", shares: 176n, priceCents: 56_900n }),
    e({ id: "2", date: "2026-11-10", from: "D", to: "VRH", shares: 176n, priceCents: 56_900n, reversesId: "1" }),
    e({ id: "3", date: "2024-10-01", from: "VRH", to: "D", shares: 176n, priceCents: 56_900n }),
  ];

  it("balanceAt and costBasisAt count the holding once, at every date", () => {
    expect(balanceAt(restarted, "D", "2025-07-01")).toBe(17_600n);
    expect(costBasisAt(restarted, "D", "2025-07-01")).toBe(10_014_400n);
    expect(balanceAt(restarted, "D", "2026-12-31")).toBe(17_600n);
  });

  it("valueHistory isn't doubled", () => {
    const h = valueHistory(restarted, "D", [{ date: "2025-07-01", priceCents: 121_890n }]);
    expect(h[0]).toMatchObject({ shares: 17_600n, costBasisCents: 10_014_400n });
  });
});
