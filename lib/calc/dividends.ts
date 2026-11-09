import { floorDiv, type Cents, type Shares } from "./money";

export interface HolderShares {
  holderId: string;
  shares: Shares;
}

export interface Allocation extends HolderShares {
  amountCents: Cents;
}

/**
 * Split a total dividend across holders in proportion to their shares, in whole cents, so the
 * amounts add up to exactly the total (largest-remainder method). Each holder first gets the
 * rounded-down amount; the leftover cents go one each to the largest fractional remainders, with
 * ties going to the earlier holder in the input order.
 */
export function allocateByShares(totalCents: Cents, holders: readonly HolderShares[]): Allocation[] {
  if (totalCents <= 0n) throw new RangeError("dividend total must be positive");
  const live = holders.filter((h) => h.shares > 0n);
  const totalShares = live.reduce((a, h) => a + h.shares, 0n);
  if (totalShares === 0n) throw new RangeError("no shares on the record date");

  const parts = live.map((h, i) => {
    const exact = totalCents * h.shares;
    return { holderId: h.holderId, shares: h.shares, i, amountCents: exact / totalShares, remainder: exact % totalShares };
  });
  let leftover = totalCents - parts.reduce((a, p) => a + p.amountCents, 0n);
  const order = [...parts].sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));
  for (const p of order) {
    if (leftover === 0n) break;
    p.amountCents += 1n;
    leftover -= 1n;
  }
  return parts.map(({ holderId, shares, amountCents }) => ({ holderId, shares, amountCents }));
}

/** A fixed amount per share. */
export function allocatePerShare(perShareCents: Cents, holders: readonly HolderShares[]): Allocation[] {
  if (perShareCents <= 0n) throw new RangeError("amount per share must be positive");
  return holders.filter((h) => h.shares > 0n).map((h) => ({ holderId: h.holderId, shares: h.shares, amountCents: h.shares * perShareCents }));
}

/** Total ÷ shares in hundredths of a cent (for display), rounded down. */
export function perShareRate(totalCents: Cents, totalShares: Shares): bigint {
  if (totalShares <= 0n) throw new RangeError("no shares");
  return floorDiv(totalCents * 100n, totalShares);
}

/** 333_333n → "$33.3333" */
export function formatPerShareRate(hundredthsOfCent: bigint): string {
  const whole = (hundredthsOfCent / 10_000n).toString();
  const frac = (hundredthsOfCent % 10_000n).toString().padStart(4, "0");
  let grouped = "";
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += ",";
    grouped += whole[i];
  }
  return `$${grouped}.${frac}`;
}
