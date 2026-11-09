"use server";
import { revalidatePath } from "next/cache";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { formatCents, formatShares, isValidDate } from "@/lib/calc";
import { reverseShareEntry, updatePerson, type PersonUpdate } from "@/lib/data/admin";
import { recordMovement } from "@/lib/data/transfers";
import { movementError, parseMovementForm } from "@/lib/forms/movement";

export interface PersonFormState {
  ok?: string;
  error?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updatePersonAction(_prev: PersonFormState, form: FormData): Promise<PersonFormState> {
  const viewer = await requireAdmin();
  const id = String(form.get("personId") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const typeIn = String(form.get("type") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase() || null;
  const contactName = String(form.get("contactName") ?? "").trim() || null;
  const hireDate = String(form.get("hireDate") ?? "").trim() || null;
  const statusIn = String(form.get("status") ?? "");
  if (!name) return { error: "Enter a name." };
  if (email && !EMAIL.test(email)) return { error: "That email doesn't look right." };
  if (hireDate && !isValidDate(hireDate)) return { error: "Enter the hire date as a date." };
  const type = (["employee", "outside_investor", "entity"].includes(typeIn) ? typeIn : "employee") as PersonUpdate["type"];
  const status = (
    type === "employee" ? (["active", "leave", "departed"].includes(statusIn) ? statusIn : "active") : "not_applicable"
  ) as PersonUpdate["status"];
  try {
    await updatePerson(adminContext(viewer), id, {
      name,
      type,
      email,
      contactName: type === "entity" ? contactName : null,
      hireDate: type === "employee" ? hireDate : null,
      status,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { error: /people_email_key|duplicate key/.test(m) ? "Another person already uses that email." : m };
  }
  revalidatePath(`/admin/people/${id}`);
  revalidatePath("/admin");
  return { ok: "Saved." };
}

/** Add shares to, or remove shares from, the person whose page this is. */
export async function personMovementAction(_prev: PersonFormState, form: FormData): Promise<PersonFormState> {
  const viewer = await requireAdmin();
  const personId = String(form.get("personId") ?? "");
  const other = String(form.get("otherId") ?? "");
  const adding = form.get("direction") !== "remove";
  form.set("fromId", adding ? other : personId);
  form.set("toId", adding ? personId : other);
  const m = parseMovementForm(form);
  if (typeof m === "string") return { error: m };
  try {
    await recordMovement(adminContext(viewer), m);
  } catch (e) {
    return { error: movementError(e) };
  }
  revalidatePath(`/admin/people/${personId}`);
  revalidatePath("/admin");
  return {
    ok: `${adding ? "Added" : "Removed"} ${formatShares(m.shares)} shares at ${formatCents(m.priceCents)} (${formatCents(m.amountCents)} total).`,
  };
}

export async function reversePersonEntryAction(form: FormData): Promise<void> {
  const viewer = await requireAdmin();
  const entryId = String(form.get("entryId") ?? "");
  const personId = String(form.get("personId") ?? "");
  if (!/^\d+$/.test(entryId)) throw new Error("Invalid entry");
  await reverseShareEntry(adminContext(viewer), entryId, "Reversed by admin from the person's share history");
  revalidatePath(`/admin/people/${personId}`);
}
