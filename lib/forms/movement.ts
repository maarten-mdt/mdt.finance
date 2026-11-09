import { isValidDate, parseDollarsToCents, parseShares, valueCents } from "@/lib/calc";
import type { MovementInput } from "@/lib/data/transfers";

/**
 * Read a share-movement form: fromId, toId, shares (two decimals), price (per share),
 * amount (optional total paid; defaults to shares × price), date and memo.
 * Returns the movement or a readable error.
 */
export function parseMovementForm(form: FormData): MovementInput | string {
  const fromId = String(form.get("fromId") ?? "");
  const toId = String(form.get("toId") ?? "");
  const date = String(form.get("date") ?? "");
  const memo = String(form.get("memo") ?? "").trim() || null;
  if (!fromId || !toId) return "Choose who the shares come from and who gets them.";
  if (fromId === toId) return "The two holders must be different.";

  let shares: bigint;
  try {
    shares = parseShares(String(form.get("shares") ?? ""));
  } catch {
    return "Enter the number of shares, up to two decimals (like 26.05).";
  }
  if (shares <= 0n) return "The number of shares must be more than zero.";

  let priceCents: bigint;
  try {
    priceCents = parseDollarsToCents(String(form.get("price") ?? "") || "0");
  } catch {
    return "Enter the price per share in dollars, like 959.72 (0 for shares issued at no cost).";
  }
  if (priceCents < 0n) return "The price can't be negative.";

  const amountRaw = String(form.get("amount") ?? "").trim();
  let amountCents: bigint;
  try {
    amountCents = amountRaw ? parseDollarsToCents(amountRaw) : valueCents(shares, priceCents);
  } catch {
    return "Enter the total paid in dollars, like 25,000.00, or leave it blank.";
  }
  if (amountCents < 0n) return "The total paid can't be negative.";
  if (!isValidDate(date)) return "Enter the date.";
  return { fromId, toId, shares, priceCents, amountCents, date, memo };
}

/** Turn database errors from a movement into plain language. */
export function movementError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/cannot transfer/.test(msg)) return "The seller doesn't hold that many shares on the ledger.";
  return msg.replace(/^error: /i, "");
}
