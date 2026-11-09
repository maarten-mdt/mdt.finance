import { floorDiv, roundDiv, SHARE_UNITS, type Cents, type Shares } from "./money";

export interface ValuationInputs {
  ebitdaCents: Cents;
  debtCents: Cents;
  /** Valuation multiple × 100, so 7× is 700n and 6.5× is 650n. */
  multipleX100: bigint;
  /** Total shares outstanding, in WHOLE shares (the price-formula denominator). */
  sharesOutstanding: bigint;
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

/** Value of a holding: shares × price per share, rounded to the nearest cent. */
export function valueCents(shares: Shares, priceCents: Cents): Cents {
  return roundDiv(shares * priceCents, SHARE_UNITS);
}
