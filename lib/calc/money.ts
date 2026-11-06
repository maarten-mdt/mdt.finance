/**
 * Money is always integer cents as bigint. Share counts are always whole shares as bigint.
 * Nothing in this module uses floating-point numbers.
 */
export type Cents = bigint;
export type Shares = bigint;

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

export function formatShares(shares: Shares): string {
  return (shares < 0n ? "−" : "") + groupThousands((shares < 0n ? -shares : shares).toString());
}
