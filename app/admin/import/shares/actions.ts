"use server";
import { revalidatePath } from "next/cache";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { formatCents, formatShares } from "@/lib/calc";
import { applyLedgerImport, previewLedgerImport } from "@/lib/data/ledger-import";
import { parseLedgerCsv } from "@/lib/ledger/csv";

export interface LedgerImportState {
  csv?: string;
  error?: string;
  done?: number;
  errors?: { line: number; message: string }[];
  preview?: { line: number; date: string; from: string; to: string; ok: boolean; shares: string; price: string; amount: string; note: string }[];
}

export async function ledgerImportAction(_prev: LedgerImportState, form: FormData): Promise<LedgerImportState> {
  const viewer = await requireAdmin();
  const ctx = adminContext(viewer);
  let csv = String(form.get("csv") ?? "");
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 1_000_000) return { error: "That file is over 1 MB." };
    csv = await file.text();
  } else if (String(form.get("pasted") ?? "").trim()) {
    csv = String(form.get("pasted"));
  }
  if (!csv.trim()) return { error: "Upload a CSV file or paste the rows first." };

  const { rows, errors } = parseLedgerCsv(csv);
  const resolved = await previewLedgerImport(ctx, rows);
  const unresolved = resolved
    .filter((r) => !r.fromId || !r.toId)
    .map((r) => ({ line: r.line, message: `“${!r.fromId ? r.from : r.to}” doesn't match a holder. Add them on the People page first (or check the spelling).` }));
  const allErrors = [...errors, ...unresolved].sort((a, b) => a.line - b.line);
  const preview = resolved.map((r) => ({
    line: r.line,
    date: r.date,
    from: r.fromName ?? r.from,
    to: r.toName ?? r.to,
    ok: !!(r.fromId && r.toId),
    shares: formatShares(r.shares),
    price: formatCents(r.priceCents),
    amount: formatCents(r.amountCents),
    note: r.memo ?? "",
  }));

  if (form.get("intent") !== "apply") return { csv, preview, errors: allErrors };
  if (allErrors.length) return { csv, preview, errors: allErrors, error: "Fix every error first; nothing was recorded." };
  try {
    const n = await applyLedgerImport(ctx, rows);
    revalidatePath("/admin");
    return { done: n };
  } catch (e) {
    return { csv, preview, errors: allErrors, error: `Nothing was recorded. ${e instanceof Error ? e.message : String(e)}` };
  }
}
