import { holderContext, requireViewer } from "@/lib/auth/guards";
import { myFile } from "@/lib/data/documents";
import { pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

/** A holder's own agreement: the copy they were sent ("template") or their signed copy ("signed"). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; which: string }> }) {
  const { id, which } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || (which !== "template" && which !== "signed")) return new Response("Not found", { status: 404 });
  const viewer = await requireViewer();
  const f = await myFile(holderContext(viewer), id, which);
  return f ? pdfResponse(f) : new Response("Not found", { status: 404 });
}
