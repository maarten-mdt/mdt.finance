"use server";
import { revalidatePath } from "next/cache";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { formatCents, formatShares, isValidDate, parseDollarsToCents } from "@/lib/calc";
import { reverseShareEntry } from "@/lib/data/admin";
import { recordTransfer } from "@/lib/data/transfers";

export interface TransferState {
  ok?: string;
  error?: string;
}

export async function transferAction(_prev: TransferState, form: FormData): Promise<TransferState> {
  const viewer = await requireAdmin();
  const sellerId = String(form.get("sellerId") ?? "");
  const buyerId = String(form.get("buyerId") ?? "");
  const sharesRaw = String(form.get("shares") ?? "").replaceAll(",", "").trim();
  const date = String(form.get("date") ?? "");
  const memo = String(form.get("memo") ?? "").trim() || null;
  if (!sellerId || !buyerId) return { error: "Choose a seller and a buyer." };
  if (sellerId === buyerId) return { error: "The seller and buyer must be different." };
  if (!/^\d+$/.test(sharesRaw) || BigInt(sharesRaw) <= 0n) return { error: "Shares must be a whole number above zero." };
  if (!isValidDate(date)) return { error: "Enter the date of the sale." };
  let priceCents: bigint;
  try {
    priceCents = parseDollarsToCents(String(form.get("price") ?? ""));
  } catch {
    return { error: "Enter the price per share in dollars, like 25.90." };
  }
  if (priceCents <= 0n) return { error: "The price must be more than zero." };
  const shares = BigInt(sharesRaw);
  try {
    await recordTransfer(adminContext(viewer), { sellerId, buyerId, shares, priceCents, date, memo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: /cannot transfer/.test(msg) ? `The seller doesn't have ${formatShares(shares)} shares.` : msg };
  }
  revalidatePath("/admin/transfers");
  revalidatePath("/admin");
  return { ok: `Recorded: ${formatShares(shares)} shares at ${formatCents(priceCents)} (${formatCents(shares * priceCents)}).` };
}

export async function reverseTransferAction(form: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const entryId = String(form.get("entryId") ?? "");
  if (!/^\d+$/.test(entryId)) throw new Error("Invalid entry");
  await reverseShareEntry(adminContext(viewer), entryId, "Reversed by admin from the buy/sell screen");
  revalidatePath("/admin/transfers");
}
