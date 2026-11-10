import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Stat } from "@/components/ui";
import { formatCents, formatPerShareRate, formatShares, perShareRate } from "@/lib/calc";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { getDividend } from "@/lib/data/dividends";
import { todayInVancouver } from "@/lib/data/holder";
import { PayoutForm } from "./payout-form";
import { VoidForm } from "./void-form";

export default async function DividendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const viewer = await requireAdmin();
  const data = await getDividend(adminContext(viewer), id);
  if (!data) notFound();
  const { dividend: d, allocations } = data;

  const paid = allocations.filter((a) => a.disposition === "paid_out").reduce((s, a) => s + BigInt(a.amount_cents), 0n);
  const held = allocations.filter((a) => a.disposition !== "paid_out").reduce((s, a) => s + BigInt(a.amount_cents), 0n);
  const shares = allocations.reduce((s, a) => s + BigInt(a.shares_on_record_date), 0n);

  return (
    <div className="space-y-4">
      <Link href="/admin/dividends" className="text-sm text-muted hover:underline">
        ← Dividends
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dividend of {formatCents(BigInt(d.total_cents))}</h1>
          <p className="text-sm text-muted">
            Declared {d.declaration_date} · record date {d.record_date}
            {d.memo ? ` · ${d.memo}` : ""}
          </p>
        </div>
        <a href={`/admin/dividends/${d.id}/export`} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium">
          Download payout file (CSV)
        </a>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Per share"
            value={d.amount_per_share_cents ? formatCents(BigInt(d.amount_per_share_cents)) : formatPerShareRate(perShareRate(BigInt(d.total_cents), shares))}
            sub={d.input_mode === "total" ? "Total ÷ shares" : "As declared"}
          />
          <Stat label="Shareholders" value={allocations.length} sub={`${formatShares(shares)} shares`} />
          <Stat label="Paid out" value={<span data-testid="paid-total">{formatCents(paid)}</span>} />
          <Stat label="Held as cash" value={<span data-testid="held-total">{formatCents(held)}</span>} />
        </div>
      </Card>

      {d.voided_at && (
        <Card className="border-danger/30 bg-danger/5 text-sm" >
          <strong>Voided</strong> on {d.voided_at.slice(0, 10)}: {d.void_reason}. Everything it added to cash balances, and any payouts,
          has been reversed; it no longer counts in anyone&apos;s dividends or returns.
        </Card>
      )}

      {d.input_mode === "manual" && !d.voided_at && (
        <p className="text-xs text-muted">Amounts were entered per person (not calculated from the record date).</p>
      )}

      {!d.voided_at && <PayoutForm
        dividendId={d.id}
        today={todayInVancouver()}
        rows={allocations.map((a) => ({
          id: a.id,
          personId: a.person_id,
          name: a.name,
          isVrh: a.system_key === "vrh",
          bank: a.bank_last4 ? `•••• ${a.bank_last4}` : "No banking details",
          shares: formatShares(BigInt(a.shares_on_record_date)),
          amount: formatCents(BigInt(a.amount_cents)),
          paidOn: a.disposition === "paid_out" ? a.paid_on : null,
        }))}
      />}

      {!d.voided_at && <VoidForm dividendId={d.id} />}
    </div>
  );
}
