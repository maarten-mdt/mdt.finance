import type { FileBody } from "@/lib/data/documents";

/** Serve a stored PDF inline, never cached, with a safe filename. */
export function pdfResponse(f: FileBody): Response {
  const name = f.fileName.replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(f.content), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
