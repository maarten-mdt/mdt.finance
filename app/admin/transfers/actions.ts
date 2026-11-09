"use server";
import { revalidatePath } from "next/cache";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { formatCents, formatShares } from "@/lib/calc";
import { reverseShareEntry } from "@/lib/data/admin";
import { recordMovement } from "@/lib/data/transfers";
import { movementError, parseMovementForm } from "@/lib/forms/movement";

export interface TransferState {
  ok?: string;
  error?: string;
}

export async function transferAction(_prev: TransferState, form: FormData): Promise<TransferState> {
  const viewer = await requireAdmin();
  const m = parseMovementForm(form);
  if (typeof m === "string") return { error: m };
  try {
    await recordMovement(adminContext(viewer), m);
  } catch (e) {
    return { error: movementError(e) };
  }
  revalidatePath("/admin/transfers");
  revalidatePath("/admin");
  return { ok: `Recorded: ${formatShares(m.shares)} shares at ${formatCents(m.priceCents)} each, ${formatCents(m.amountCents)} in total.` };
}

export async function reverseTransferAction(form: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const entryId = String(form.get("entryId") ?? "");
  if (!/^\d+$/.test(entryId)) throw new Error("Invalid entry");
  await reverseShareEntry(adminContext(viewer), entryId, "Reversed by admin from the buy/sell screen");
  revalidatePath("/admin/transfers");
}
