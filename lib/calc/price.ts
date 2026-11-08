import { floorDiv, type Cents, type Shares } from "./money";

export interface ValuationInputs {
  ebitdaCents: Cents;
  debtCents: Cents;
  /** Valuation multiple × 100, so 7× is 700n and 6.5× is 650n. */
  multipleX100: bigint;
  /** Total shares outstanding across all classes. */
  sharesOutstanding: Shares;
}

/**
 * Price per share = (multiple × audited EBITDA − debt) ÷ shares outstanding,
 * rounded DOWN to the cent.
 */
export function pricePerShareCents(v: ValuationInputs): Cents {
  if (v.sharesOutstanding <= 0n) throw new RangeError("shares outstanding must be positive");
  if (v.multipleX100 <= 0n) throw new RangeError("multiple must be positive");
  // Work in hundredths of a cent so the multiple stays an integer.
  const equityX100 = v.multipleX100 * v.ebitdaCents - 100n * v.debtCents;
  if (equityX100 <= 0n) throw new RangeError("equity value is not positive");
  return floorDiv(equityX100, 100n * v.sharesOutstanding);
}

/** Market value of a holding: shares × price per share. */
export function valueCents(shares: Shares, priceCents: Cents): Cents {
  return shares * priceCents;
}
