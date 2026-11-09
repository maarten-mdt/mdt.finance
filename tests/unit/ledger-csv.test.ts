import { describe, expect, it } from "vitest";
import { parseLedgerCsv, specialHolder } from "@/lib/ledger/csv";

describe("parseLedgerCsv", () => {
  it("parses two-decimal shares, price and the amount actually paid", () => {
    const { rows, errors } = parseLedgerCsv(
      [
        "date,from,to,shares,price_per_share,amount,note",
        "2022-02-01,Issued by MDT,Van Ruitenburg Holdings,\"75,481.00\",0,0,Initial issuance",
        "2025-01-01,Van Ruitenburg Holdings,Joshua Anderson,26.05,959.72,\"25,000.00\",12/31/2024 pricing",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({
      line: 2, date: "2022-02-01", from: "Issued by MDT", to: "Van Ruitenburg Holdings",
      shares: 7_548_100n, priceCents: 0n, amountCents: 0n, memo: "Initial issuance",
    });
    expect(rows[1]).toMatchObject({ shares: 2605n, priceCents: 95_972n, amountCents: 2_500_000n });
  });

  it("defaults the amount to shares × price when blank", () => {
    const { rows } = parseLedgerCsv("date\tfrom\tto\tshares\tprice\n2024-10-01\tIssued by MDT\tJohn Neels\t78\t560\n");
    expect(rows[0]).toMatchObject({ shares: 7800n, priceCents: 56_000n, amountCents: 4_368_000n });
  });

  it("reports problems by line", () => {
    const { rows, errors } = parseLedgerCsv("date,from,to,shares\n2/1/2022,A,B,10\n2022-02-01,A,A,1.234\n2022-02-01,,B,0\n");
    expect(rows).toEqual([]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(errors[0]!.message).toMatch(/YYYY-MM-DD/);
    expect(errors[1]!.message).toMatch(/same.*two decimals/);
    expect(errors[2]!.message).toMatch(/from is empty.*more than zero/);
  });

  it("recognises the special holders by common names", () => {
    expect(specialHolder("Issued by MDT")).toBe("opening_balance");
    expect(specialHolder("  van ruitenburg holdings ")).toBe("vrh");
    expect(specialHolder("Van Ruitenburg Holdings Ltd.")).toBe("vrh");
    expect(specialHolder("Ryan Neels")).toBeNull();
  });
});
