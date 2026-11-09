import { describe, expect, it } from "vitest";
import {
  addYears,
  balanceOf,
  costBasisCents,
  eligibilityDate,
  holdingsFromLedger,
  isEligible,
  formatShares,
  parseDollarsToCents,
  parseShares,
  pricePerShareCents,
  roundDiv,
  valueCents,
  type LedgerEntry,
} from "@/lib/calc";

// Test entries are written in WHOLE shares for readability; the ledger stores hundredths, and the
// amount paid defaults to shares × price.
const e = (p: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "from" | "to" | "shares">): LedgerEntry => ({
  date: "2026-07-01",
  priceCents: 0n,
  reversesId: null,
  ...p,
  shares: p.shares * 100n,
  amountCents: p.amountCents ?? p.shares * (p.priceCents ?? 0n),
});

describe("pricePerShareCents", () => {
  it("applies (multiple × EBITDA − debt) ÷ shares", () => {
    // (7 × $10,000,000 − $5,000,000) ÷ 1,000,000 = $65.00
    expect(
      pricePerShareCents({
        ebitdaCents: 1_000_000_000n,
        debtCents: 500_000_000n,
        multipleX100: 700n,
        sharesOutstanding: 1_000_000n,
      }),
    ).toBe(6500n);
  });

  it("rounds down to the cent, never up", () => {
    // (7 × $1.00 − 0) ÷ 3 = 233.33… cents → 233
    expect(
      pricePerShareCents({ ebitdaCents: 100n, debtCents: 0n, multipleX100: 700n, sharesOutstanding: 3n }),
    ).toBe(233n);
  });

  it("supports fractional multiples without floats", () => {
    // 6.5 × $100 ÷ 10 shares = $65.00
    expect(
      pricePerShareCents({ ebitdaCents: 10_000n, debtCents: 0n, multipleX100: 650n, sharesOutstanding: 10n }),
    ).toBe(6500n);
  });

  it("rejects zero shares and non-positive equity", () => {
    expect(() =>
      pricePerShareCents({ ebitdaCents: 1n, debtCents: 0n, multipleX100: 700n, sharesOutstanding: 0n }),
    ).toThrow(/shares outstanding/);
    expect(() =>
      pricePerShareCents({ ebitdaCents: 100n, debtCents: 700n, multipleX100: 700n, sharesOutstanding: 1n }),
    ).toThrow(/not positive/);
  });
});

describe("holdingsFromLedger", () => {
  const ledger = [
    e({ id: "1", from: "OPEN", to: "VRH", shares: 1000n }),
    e({ id: "2", from: "VRH", to: "A", shares: 100n }),
    e({ id: "3", from: "VRH", to: "B", shares: 50n }),
    e({ id: "4", from: "A", to: "B", shares: 10n }),
  ];

  it("computes every holder's balance as inflows minus outflows", () => {
    const h = holdingsFromLedger(ledger);
    expect(h.get("VRH")).toBe(85_000n);
    expect(h.get("A")).toBe(9_000n);
    expect(h.get("B")).toBe(6_000n);
    expect(h.get("OPEN")).toBe(-100_000n);
  });

  it("conserves shares: all balances sum to zero", () => {
    const total = [...holdingsFromLedger(ledger).values()].reduce((a, b) => a + b, 0n);
    expect(total).toBe(0n);
  });

  it("balanceOf returns 0 for an unknown holder", () => {
    expect(balanceOf(ledger, "Z")).toBe(0n);
  });
});

describe("valueCents", () => {
  it("is shares × price", () => {
    expect(valueCents(9_000n, 6500n)).toBe(585_000n);
  });

  it("rounds fractional holdings to the nearest cent", () => {
    // 26.05 shares × $959.72 = $25,000.706 → $25,000.71
    expect(valueCents(2605n, 95_972n)).toBe(2_500_071n);
  });
});

describe("two-decimal shares", () => {
  it("parses share quantities into hundredths", () => {
    expect(parseShares("75,106.22")).toBe(7_510_622n);
    expect(parseShares("26.05")).toBe(2605n);
    expect(parseShares("26.5")).toBe(2650n);
    expect(parseShares("399")).toBe(39_900n);
    for (const bad of ["", "1.234", "-5", "abc", "1,00"]) expect(() => parseShares(bad)).toThrow();
  });

  it("formats hundredths, dropping .00 on whole quantities", () => {
    expect(formatShares(7_510_622n)).toBe("75,106.22");
    expect(formatShares(2605n)).toBe("26.05");
    expect(formatShares(39_900n)).toBe("399");
    expect(formatShares(-2605n)).toBe("−26.05");
  });

  it("rounds half away from zero", () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(4n, 3n)).toBe(1n);
  });
});

describe("costBasisCents (average cost)", () => {
  it("uses the amount actually paid, not shares × price", () => {
    const l = [e({ id: "1", from: "VRH", to: "A", shares: 26n, priceCents: 95_972n, amountCents: 2_500_000n })];
    expect(costBasisCents(l, "A")).toBe(2_500_000n);
  });

  it("sums acquisitions at their price", () => {
    const l = [
      e({ id: "1", from: "VRH", to: "A", shares: 100n, priceCents: 1000n }),
      e({ id: "2", from: "VRH", to: "A", shares: 50n, priceCents: 1600n, date: "2027-07-01" }),
    ];
    expect(costBasisCents(l, "A")).toBe(180_000n);
  });

  it("removes cost proportionally on a sale", () => {
    const l = [
      e({ id: "1", from: "VRH", to: "A", shares: 100n, priceCents: 1000n }),
      e({ id: "2", from: "VRH", to: "A", shares: 100n, priceCents: 2000n, date: "2027-07-01" }),
      e({ id: "3", from: "A", to: "B", shares: 50n, priceCents: 2500n, date: "2028-07-01" }),
    ];
    // avg cost $15.00 × 150 remaining = $2,250.00
    expect(costBasisCents(l, "A")).toBe(225_000n);
    // buyer's basis is what they paid
    expect(costBasisCents(l, "B")).toBe(125_000n);
  });

  it("goes to exactly zero when everything is sold", () => {
    const l = [
      e({ id: "1", from: "VRH", to: "A", shares: 3n, priceCents: 1001n }),
      e({ id: "2", from: "A", to: "VRH", shares: 3n, priceCents: 1200n, date: "2027-07-01" }),
    ];
    expect(costBasisCents(l, "A")).toBe(0n);
  });

  it("ignores an entry and its reversing correction entirely", () => {
    const l = [
      e({ id: "1", from: "VRH", to: "A", shares: 100n, priceCents: 1000n }),
      e({ id: "2", from: "VRH", to: "A", shares: 999n, priceCents: 1000n }),
      e({ id: "3", from: "A", to: "VRH", shares: 999n, priceCents: 1000n, reversesId: "2" }),
    ];
    expect(costBasisCents(l, "A")).toBe(100_000n);
    expect(balanceOf(l, "A")).toBe(10_000n);
  });
});

describe("eligibility", () => {
  it("adds whole calendar years", () => {
    expect(addYears("2022-03-15", 4)).toBe("2026-03-15");
  });

  it("maps Feb 29 to Feb 28 in a non-leap year", () => {
    expect(addYears("2020-02-29", 4)).toBe("2024-02-29");
    expect(addYears("2020-02-29", 3)).toBe("2023-02-28");
  });

  it("eligibilityDate uses the configured number of years", () => {
    expect(eligibilityDate("2023-01-10", 4)).toBe("2027-01-10");
    expect(eligibilityDate("2023-01-10", 5)).toBe("2028-01-10");
  });

  it("is eligible on and after the anniversary, not before", () => {
    expect(isEligible("2022-11-06", "2026-11-05", 4)).toBe(false);
    expect(isEligible("2022-11-06", "2026-11-06", 4)).toBe(true);
    expect(isEligible("2022-11-06", "2027-01-01", 4)).toBe(true);
  });

  it("rejects malformed dates", () => {
    expect(() => addYears("2022-13-01", 1)).toThrow();
    expect(() => addYears("22-1-1", 1)).toThrow();
  });
});

describe("parseDollarsToCents", () => {
  it.each([
    ["1000", 100_000n],
    ["$1,000", 100_000n],
    ["1,234.56", 123_456n],
    ["0.5", 50n],
    ["  $10,000.00 ", 1_000_000n],
    ["-25.10", -2510n],
  ])("parses %s", (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "1.234", "1,00", "$", "1e5", "12.3.4"])("rejects %s", (input) => {
    expect(() => parseDollarsToCents(input)).toThrow();
  });
});
