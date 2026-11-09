import { describe, expect, it } from "vitest";
import { xirr, xirrBps, type CashFlow } from "@/lib/calc";

const f = (date: string, amountCents: bigint): CashFlow => ({ date, amountCents });

describe("xirr", () => {
  it("matches Excel's documented XIRR example (37.34%)", () => {
    // From Microsoft's XIRR documentation: =XIRR(values, dates) → 0.373362535
    const flows = [
      f("2008-01-01", -1_000_000n),
      f("2008-03-01", 275_000n),
      f("2008-10-30", 425_000n),
      f("2009-02-15", 325_000n),
      f("2009-04-01", 275_000n),
    ];
    expect(xirr(flows)!).toBeCloseTo(0.373362535, 6);
    expect(xirrBps(flows)).toBe(3734n);
  });

  it("is 100% for money that doubles in exactly one (365-day) year", () => {
    expect(xirr([f("2021-01-01", -100_000n), f("2022-01-01", 200_000n)])!).toBeCloseTo(1, 6);
  });

  it("handles losses", () => {
    expect(xirrBps([f("2021-07-01", -100_000n), f("2022-07-01", 80_000n)])).toBe(-2000n);
  });

  it("matches a typical holder: purchases, a dividend, today's value", () => {
    // Bought $2,280 (2021) and $2,242.50 (2023), $112 dividend, worth $5,180 on 2026-07-01.
    const flows = [
      f("2021-07-01", -228_000n),
      f("2023-07-01", -224_250n),
      f("2025-12-15", 11_200n),
      f("2026-07-01", 518_000n),
    ];
    const r = xirr(flows)!;
    // Present value at that rate is ~0, which is what XIRR means.
    const t0 = Date.parse("2021-07-01");
    const npv = flows.reduce((s, x) => s + Number(x.amountCents) / (1 + r) ** ((Date.parse(x.date) - t0) / 86_400_000 / 365), 0);
    expect(Math.abs(npv)).toBeLessThan(0.01);
    // $4,522.50 in, $5,292 back over ~4.3 years ≈ 4% a year.
    expect(r).toBeCloseTo(0.0399, 3);
  });

  it("has no answer without both money in and money out", () => {
    expect(xirr([f("2021-01-01", -100n)])).toBeNull();
    expect(xirr([f("2021-01-01", 100n), f("2022-01-01", 100n)])).toBeNull();
    expect(xirr([])).toBeNull();
  });
});
