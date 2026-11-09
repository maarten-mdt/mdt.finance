"use server";
import { revalidatePath } from "next/cache";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { isValidDate, parseDollarsToCents } from "@/lib/calc";
import { decryptField, parseKey } from "@/lib/crypto/fields";
import {
  ensureSystemHolders,
  importPeople,
  logReveal,
  recordOpeningBalance,
  reverseShareEntry,
  setAdminRole,
  type ImportResult,
} from "@/lib/data/admin";
import { env } from "@/lib/env";
import { createInvite } from "@/lib/invites";
import { parsePeopleCsv, type ParsedImport } from "@/lib/people/csv";

// Every action re-checks the admin session itself: server actions are public endpoints.

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^error: /i, "");
}

// ---- People import ----------------------------------------------------------------------------

export interface ImportState {
  csv?: string;
  preview?: ParsedImport;
  result?: ImportResult;
  error?: string;
}

export async function importAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const viewer = await requireAdmin();
  const intent = form.get("intent");
  let csv = String(form.get("csv") ?? "");
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 1_000_000) return { error: "That file is over 1 MB. Split it up and import in parts." };
    csv = await file.text();
  }
  const pasted = String(form.get("pasted") ?? "");
  if (!(file instanceof File && file.size > 0) && pasted.trim()) csv = pasted;
  if (!csv.trim()) return { error: "Upload a CSV file or paste the rows first." };

  const preview = parsePeopleCsv(csv);
  if (intent !== "apply") return { csv, preview };
  if (preview.errors.length) return { csv, preview, error: "Fix every error before importing; nothing was imported." };
  try {
    const result = await importPeople(adminContext(viewer), preview.rows);
    revalidatePath("/admin");
    return { result };
  } catch (e) {
    return { csv, preview, error: friendly(e) };
  }
}

// ---- System holders and opening balances --------------------------------------------------------

export interface FormState {
  ok?: string;
  error?: string;
}

export async function ensureSystemHoldersAction(): Promise<void> {
  const viewer = await requireAdmin();
  await ensureSystemHolders(adminContext(viewer));
  revalidatePath("/admin/holders");
}

export async function openingBalanceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const viewer = await requireAdmin();
  const holderId = String(form.get("holderId") ?? "");
  const sharesRaw = String(form.get("shares") ?? "").replaceAll(",", "").trim();
  const entryDate = String(form.get("entryDate") ?? "");
  const memo = String(form.get("memo") ?? "").trim() || null;
  if (!holderId) return { error: "Choose a holder." };
  if (!/^\d+$/.test(sharesRaw) || BigInt(sharesRaw) <= 0n) return { error: "Shares must be a whole number above zero." };
  if (!isValidDate(entryDate)) return { error: "Enter the date as YYYY-MM-DD." };
  let priceCents: bigint;
  try {
    priceCents = parseDollarsToCents(String(form.get("price") ?? ""));
  } catch {
    return { error: "Enter the price per share in dollars, like 12.50." };
  }
  if (priceCents < 0n) return { error: "Price can't be negative." };
  try {
    await recordOpeningBalance(adminContext(viewer), { holderId, shares: BigInt(sharesRaw), priceCents, entryDate, memo });
  } catch (e) {
    return { error: friendly(e) };
  }
  revalidatePath("/admin/holders");
  return { ok: "Opening balance recorded." };
}

export async function reverseEntryAction(form: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const entryId = String(form.get("entryId") ?? "");
  if (!/^\d+$/.test(entryId)) throw new Error("Invalid entry");
  await reverseShareEntry(adminContext(viewer), entryId, `Reversed by admin from the opening balances screen`);
  revalidatePath("/admin/holders");
}

// ---- Invites and reveals -----------------------------------------------------------------------

export interface InviteState {
  link?: string;
  error?: string;
}

export async function inviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const viewer = await requireAdmin();
  try {
    return { link: await createInvite(adminContext(viewer), String(form.get("personId") ?? "")) };
  } catch (e) {
    return { error: friendly(e) };
  }
}

export interface RevealState {
  value?: string;
  error?: string;
}

export async function revealAction(_prev: RevealState, form: FormData): Promise<RevealState> {
  const viewer = await requireAdmin();
  const personId = String(form.get("personId") ?? "");
  const field = form.get("field") === "bank" ? "bank" : "sin";
  try {
    const { ciphertext } = await logReveal(adminContext(viewer), field, personId);
    if (!ciphertext) return { error: "Nothing on file." };
    return { value: decryptField(ciphertext, parseKey(env.fieldEncryptionKey), personId) };
  } catch (e) {
    return { error: friendly(e) };
  }
}

// ---- Admin role ---------------------------------------------------------------------------------

export async function adminRoleAction(_prev: FormState, form: FormData): Promise<FormState> {
  const viewer = await requireAdmin();
  const personId = String(form.get("personId") ?? "");
  const makeAdmin = form.get("admin") === "true";
  try {
    await setAdminRole(adminContext(viewer), personId, makeAdmin);
  } catch (e) {
    return { error: friendly(e) };
  }
  revalidatePath(`/admin/people/${personId}`);
  revalidatePath("/admin");
  return { ok: makeAdmin ? "Admin role granted. They'll be asked to add a passkey before the admin console opens." : "Admin role removed." };
}
