"use server";
import { revalidatePath } from "next/cache";
import { holderContext, requireViewer } from "@/lib/auth/guards";
import { readPdf, returnSigned } from "@/lib/data/documents";

export interface ReturnState {
  ok?: string;
  error?: string;
}

/** A holder uploads the signed copy of an agreement they were sent. */
export async function returnSignedAction(_prev: ReturnState, form: FormData): Promise<ReturnState> {
  const viewer = await requireViewer();
  const documentId = String(form.get("documentId") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(documentId)) return { error: "Something went wrong. Reload the page and try again." };
  try {
    await returnSigned(holderContext(viewer), documentId, await readPdf(form.get("file")));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/dashboard");
  return { ok: "Uploaded. MDT will review it and confirm." };
}
