import { describe, expect, it } from "vitest";
import { allocateByShares, allocatePerShare, formatPerShareRate, perShareRate } from "@/lib/calc";

const h = (holderId: string, shares: bigint) => ({ holderId, shares });

describe("allocateByShares (total amount)", () => {
  it("splits an even total exactly by shares", () => {
    const r = allocateByShares(100_000n, [h("A", 100n), h("B", 300n)]);
    expect(r).toEqual([
      { holderId: "A", shares: 100n, amountCents: 25_000n },
      { holderId: "B", shares: 300n, amountCents: 75_000n },
    ]);
  });

  it("always adds up to exactly the total, giving leftover cents to the largest remainders", () => {
    // $100.00 over 3 equal holders: 33.33… each; the extra cent goes to the first in order.
    const r = allocateByShares(10_000n, [h("A", 1n), h("B", 1n), h("C", 1n)]);
    expect(r.map((x) => x.amountCents)).toEqual([3334n, 3333n, 3333n]);
    expect(r.reduce((a, x) => a + x.amountCents, 0n)).toBe(10_000n);
  });

  it("prefers the larger fractional remainder over input order", () => {
    // 1000 cents over 6 + 7 shares → 461.53… and 538.46…; the cent goes to A (.53 > .46).
    const r = allocateByShares(1000n, [h("A", 6n), h("B", 7n)]);
    expect(r.map((x) => x.amountCents)).toEqual([462n, 538n]);
  });

  it("keeps the sum exact for awkward real-world numbers", () => {
    const holders = Array.from({ length: 41 }, (_, i) => h(`H${i}`, BigInt(17 + i * 37)));
    const r = allocateByShares(1_234_567n, holders);
    expect(r.reduce((a, x) => a + x.amountCents, 0n)).toBe(1_234_567n);
    for (const x of r) expect(x.amountCents >= 0n).toBe(true);
  });

  it("skips holders with no shares and rejects bad input", () => {
    expect(allocateByShares(100n, [h("A", 0n), h("B", 5n)])).toEqual([{ holderId: "B", shares: 5n, amountCents: 100n }]);
    expect(() => allocateByShares(0n, [h("A", 1n)])).toThrow(/positive/);
    expect(() => allocateByShares(100n, [])).toThrow(/no shares/);
  });
});

describe("allocatePerShare", () => {
  it("pays the same amount on every whole share, rounding fractions to the cent", () => {
    // 100 shares and 3 shares at $0.35; 26.05 shares at $0.35 = $9.1175 → $9.12
    const r = allocatePerShare(35n, [h("A", 10_000n), h("B", 300n), h("C", 2605n)]);
    expect(r.map((x) => x.amountCents)).toEqual([3500n, 105n, 912n]);
  });
});

describe("perShareRate", () => {
  it("expresses total ÷ shares in hundredths of a cent, rounded down", () => {
    expect(perShareRate(10_000n, 300n)).toBe(333_333n); // $100.00 over 3 whole shares
    expect(formatPerShareRate(333_333n)).toBe("$33.3333");
    expect(formatPerShareRate(3_500n)).toBe("$0.3500");
  });
});
