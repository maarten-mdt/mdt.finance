"use server";
import { revalidatePath } from "next/cache";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { isValidDate } from "@/lib/calc";
import {
  addTemplate,
  cancelRequest,
  confirmReturned,
  makeTemplateCurrent,
  readPdf,
  rejectReturned,
  sendAgreement,
  uploadSignedAgreement,
} from "@/lib/data/documents";

export interface DocState {
  ok?: string;
  error?: string;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function addTemplateAction(_prev: DocState, form: FormData): Promise<DocState> {
  const viewer = await requireAdmin();
  const version = String(form.get("version") ?? "").trim();
  if (!version) return { error: "Give this version a name, like “v1 — March 2027”." };
  try {
    const pdf = await readPdf(form.get("file"));
    await addTemplate(adminContext(viewer), version, pdf, form.get("current") === "on");
  } catch (e) {
    const m = msg(e);
    return { error: /duplicate key/.test(m) ? "A version with that name already exists." : m };
  }
  revalidatePath("/admin/agreements");
  return { ok: "Agreement uploaded." };
}

export async function makeCurrentAction(form: FormData): Promise<void> {
  const viewer = await requireAdmin();
  await makeTemplateCurrent(adminContext(viewer), String(form.get("templateId") ?? ""));
  revalidatePath("/admin/agreements");
}

export async function sendAgreementAction(_prev: DocState, form: FormData): Promise<DocState> {
  const viewer = await requireAdmin();
  const personId = String(form.get("personId") ?? "");
  try {
    await sendAgreement(adminContext(viewer), personId);
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath(`/admin/people/${personId}`);
  return { ok: "Sent. They'll see it on their dashboard the next time they sign in." };
}

export async function uploadSignedAction(_prev: DocState, form: FormData): Promise<DocState> {
  const viewer = await requireAdmin();
  const personId = String(form.get("personId") ?? "");
  const version = String(form.get("version") ?? "").trim();
  const signedOn = String(form.get("signedOn") ?? "");
  if (!version) return { error: "Enter which version of the agreement this is." };
  if (!isValidDate(signedOn)) return { error: "Enter the date it was signed." };
  try {
    await uploadSignedAgreement(adminContext(viewer), personId, { version, signedOn, pdf: await readPdf(form.get("file")) });
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath(`/admin/people/${personId}`);
  return { ok: "Signed agreement saved." };
}

export async function reviewAction(_prev: DocState, form: FormData): Promise<DocState> {
  const viewer = await requireAdmin();
  const personId = String(form.get("personId") ?? "");
  const documentId = String(form.get("documentId") ?? "");
  const intent = form.get("intent");
  try {
    if (intent === "confirm") {
      const signedOn = String(form.get("signedOn") ?? "");
      if (!isValidDate(signedOn)) return { error: "Enter the date shown on the signature." };
      await confirmReturned(adminContext(viewer), documentId, signedOn);
    } else if (intent === "reject") {
      const note = String(form.get("note") ?? "").trim();
      if (!note) return { error: "Tell them what to fix." };
      await rejectReturned(adminContext(viewer), documentId, note);
    } else if (intent === "cancel") {
      await cancelRequest(adminContext(viewer), documentId);
    }
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath(`/admin/people/${personId}`);
  return { ok: intent === "confirm" ? "Agreement confirmed." : intent === "reject" ? "Sent back to them with your note." : "Request withdrawn." };
}
