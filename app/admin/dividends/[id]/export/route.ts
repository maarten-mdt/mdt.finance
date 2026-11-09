import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { formatCents } from "@/lib/calc";
import { getDividend } from "@/lib/data/dividends";

export const dynamic = "force-dynamic";

const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/** Payout file: one row per shareholder, for whoever sends the payments. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const viewer = await requireAdmin();
  const data = await getDividend(adminContext(viewer), id);
  if (!data) return new Response("Not found", { status: 404 });

  const lines = [
    ["Shareholder", "Email", "Bank account (last 4)", "Shares on record date", "Amount", "Status", "Paid on"].join(","),
    ...data.allocations.map((a) =>
      [
        a.name,
        a.email ?? "",
        a.bank_last4 ?? "",
        a.shares_on_record_date,
        formatCents(BigInt(a.amount_cents)).replace("$", "").replaceAll(",", ""),
        a.disposition === "paid_out" ? "Paid" : "Held as cash",
        a.paid_on ?? "",
      ]
        .map(csv)
        .join(","),
    ),
  ];
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dividend-${data.dividend.declaration_date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
