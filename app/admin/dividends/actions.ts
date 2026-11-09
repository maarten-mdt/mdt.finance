"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { formatCents, formatPerShareRate, formatShares, isValidDate, parseDollarsToCents } from "@/lib/calc";
import { declareDividend, markPaid, previewDividend, type DividendInput } from "@/lib/data/dividends";

export interface DeclareState {
  error?: string;
  /** Echo of the form, so the confirm step submits exactly what was previewed. */
  values?: { mode: string; amount: string; recordDate: string; declarationDate: string; memo: string };
  preview?: {
    lines: { name: string; isVrh: boolean; shares: string; amount: string }[];
    totalShares: string;
    total: string;
    rate: string;
    holders: number;
  };
}

function parse(form: FormData): { input: DividendInput & { declarationDate: string; memo: string | null }; values: NonNullable<DeclareState["values"]> } | string {
  const values = {
    mode: form.get("mode") === "per_share" ? "per_share" : "total",
    amount: String(form.get("amount") ?? "").trim(),
    recordDate: String(form.get("recordDate") ?? ""),
    declarationDate: String(form.get("declarationDate") ?? ""),
    memo: String(form.get("memo") ?? "").trim(),
  };
  let amountCents: bigint;
  try {
    amountCents = parseDollarsToCents(values.amount);
  } catch {
    return "Enter the amount in dollars, like 25,000 or 0.35.";
  }
  if (amountCents <= 0n) return "The amount must be more than zero.";
  if (!isValidDate(values.recordDate)) return "Enter the record date.";
  if (!isValidDate(values.declarationDate)) return "Enter the declaration date.";
  if (values.recordDate > values.declarationDate) return "The record date can't be after the declaration date.";
  return {
    values,
    input: {
      mode: values.mode as DividendInput["mode"],
      amountCents,
      recordDate: values.recordDate,
      declarationDate: values.declarationDate,
      memo: values.memo || null,
    },
  };
}

export async function declareAction(_prev: DeclareState, form: FormData): Promise<DeclareState> {
  const viewer = await requireAdmin();
  const parsed = parse(form);
  if (typeof parsed === "string") return { error: parsed };
  const ctx = adminContext(viewer);

  if (form.get("intent") === "confirm") {
    let id: string;
    try {
      id = await declareDividend(ctx, parsed.input);
    } catch (e) {
      return { values: parsed.values, error: e instanceof Error ? e.message : String(e) };
    }
    revalidatePath("/admin/dividends");
    redirect(`/admin/dividends/${id}`);
  }

  try {
    const p = await previewDividend(ctx, parsed.input);
    return {
      values: parsed.values,
      preview: {
        lines: p.lines.map((l) => ({ name: l.name, isVrh: l.isVrh, shares: formatShares(l.shares), amount: formatCents(l.amountCents) })),
        totalShares: formatShares(p.totalShares),
        total: formatCents(p.totalCents),
        rate: formatPerShareRate(p.rate),
        holders: p.lines.length,
      },
    };
  } catch (e) {
    return { values: parsed.values, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface PayState {
  ok?: string;
  error?: string;
}

export async function markPaidAction(_prev: PayState, form: FormData): Promise<PayState> {
  const viewer = await requireAdmin();
  const dividendId = String(form.get("dividendId") ?? "");
  const paidOn = String(form.get("paidOn") ?? "");
  const ids = form.getAll("allocationId").map(String).filter(Boolean);
  if (!isValidDate(paidOn)) return { error: "Enter the date the company paid it." };
  if (ids.length === 0) return { error: "Tick at least one shareholder." };
  try {
    const n = await markPaid(adminContext(viewer), dividendId, ids, paidOn);
    revalidatePath(`/admin/dividends/${dividendId}`);
    revalidatePath("/admin/dividends");
    return { ok: `Marked ${n} payment${n === 1 ? "" : "s"} as paid. Their cash balances are updated.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
