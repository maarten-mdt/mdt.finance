"use server";
import { revalidatePath } from "next/cache";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { formatCents, parseDollarsToCents } from "@/lib/calc";
import { FIRST_VALUATION_YEAR, lockValuation, saveValuation } from "@/lib/data/valuations";
import { parseSettingInput } from "@/lib/settings";

export interface ValuationState {
  ok?: string;
  error?: string;
}

export async function valuationAction(_prev: ValuationState, form: FormData): Promise<ValuationState> {
  const viewer = await requireAdmin();
  const year = Number(form.get("year"));
  if (!Number.isInteger(year) || year < FIRST_VALUATION_YEAR || year > 2200) return { error: "Invalid year." };
  const ctx = adminContext(viewer);

  try {
    if (form.get("intent") === "lock") {
      await lockValuation(ctx, year);
      revalidatePath("/admin/valuations");
      revalidatePath("/dashboard");
      return { ok: `${year} locked. Shareholders now see this price.` };
    }
    let ebitdaCents: bigint, debtCents: bigint;
    try {
      ebitdaCents = parseDollarsToCents(String(form.get("ebitda") ?? ""));
      debtCents = parseDollarsToCents(String(form.get("debt") ?? ""));
    } catch {
      return { error: "Enter EBITDA and debt in dollars, like 4,200,000." };
    }
    if (debtCents < 0n) return { error: "Debt can't be negative." };
    const multipleX100 = parseSettingInput("valuation_multiple_x100", String(form.get("multiple") ?? ""));
    const sharesOutstanding = parseSettingInput("shares_outstanding_total", String(form.get("shares") ?? ""));
    const price = await saveValuation(ctx, { year, ebitdaCents, debtCents, multipleX100, sharesOutstanding });
    revalidatePath("/admin/valuations");
    return { ok: `${year} saved as a draft: ${formatCents(price)} per share. Lock it once the board approves.` };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { error: /not positive/.test(m) ? "With these numbers the company value isn't positive (debt is larger than the multiple × EBITDA)." : m };
  }
}
