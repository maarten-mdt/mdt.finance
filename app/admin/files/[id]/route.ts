import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { adminFile } from "@/lib/data/documents";
import { pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const viewer = await requireAdmin();
  const f = await adminFile(adminContext(viewer), id);
  return f ? pdfResponse(f) : new Response("Not found", { status: 404 });
}
