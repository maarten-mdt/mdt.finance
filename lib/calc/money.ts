/**
 * Money is always integer cents as bigint. Share quantities are integer hundredths of a share
 * as bigint (26.05 shares = 2605n), because MDT's records hold shares to two decimals.
 * Nothing in this module uses floating-point numbers.
 */
export type Cents = bigint;
/** Hundredths of a share. */
export type Shares = bigint;

/** Hundredths per whole share. */
export const SHARE_UNITS = 100n;

/** Integer division rounding half away from zero (12.5 → 13, −12.5 → −13). */
export function roundDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError("division by zero");
  const neg = a < 0n !== b < 0n;
  const aa = a < 0n ? -a : a;
  const bb = b < 0n ? -b : b;
  const q = (2n * aa + bb) / (2n * bb);
  return neg ? -q : q;
}

/** Integer division rounding toward negative infinity (bigint `/` truncates toward zero). */
export function floorDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError("division by zero");
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

const DOLLARS = /^(-)?\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** Parse "$1,234.56" / "1234.5" / "-25" into cents. Throws on anything ambiguous. */
export function parseDollarsToCents(input: string): Cents {
  const m = DOLLARS.exec(input.trim());
  if (!m) throw new Error(`Not a valid dollar amount: "${input}"`);
  const neg = m[1];
  const whole = m[2] ?? "";
  const frac = m[3] ?? "";
  const cents = BigInt(whole.replaceAll(",", "")) * 100n + BigInt(frac.padEnd(2, "0") || "0");
  return neg ? -cents : cents;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Display helper: 123456n → "$1,234.56". */
export function formatCents(cents: Cents): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = groupThousands((abs / 100n).toString());
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "−" : ""}$${whole}.${frac}`;
}

/** 750_6122n → "75,106.22"; whole quantities print without decimals: 39_900n → "399". */
export function formatShares(units: Shares): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = groupThousands((abs / SHARE_UNITS).toString());
  const frac = abs % SHARE_UNITS;
  return `${neg ? "−" : ""}${whole}${frac === 0n ? "" : `.${frac.toString().padStart(2, "0")}`}`;
}

const SHARES = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** Parse "75,106.22" / "26.05" / "399" into hundredths of a share. Throws on anything else. */
export function parseShares(input: string): Shares {
  const m = SHARES.exec(input.trim());
  if (!m) throw new Error(`Not a valid number of shares: "${input}"`);
  return BigInt((m[1] ?? "").replaceAll(",", "")) * SHARE_UNITS + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}
