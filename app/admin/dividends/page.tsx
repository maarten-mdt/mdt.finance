import Link from "next/link";
import { Card } from "@/components/ui";
import { formatCents } from "@/lib/calc";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { listDividends } from "@/lib/data/dividends";
import { listPeople } from "@/lib/data/admin";
import { todayInVancouver } from "@/lib/data/holder";
import { DeclareForm } from "./declare-form";

export default async function DividendsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const viewer = await requireAdmin();
  const [dividends, people] = await Promise.all([listDividends(adminContext(viewer)), listPeople(adminContext(viewer))]);
  const holders = people.filter((p) => p.system_key !== "opening_balance").map((p) => ({ id: p.id, name: p.name }));
  const today = todayInVancouver();
  const { year } = await searchParams;
  // From the valuations page: default the dates to the end of that year (never in the future).
  const defaultDate = year && /^\d{4}$/.test(year) && `${year}-12-31` < today ? `${year}-12-31` : today;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Dividends</h1>
        <p className="text-sm text-muted">
          Declare a dividend and the system works out each shareholder&apos;s exact amount from the shares they held on the record
          date. The amount is added to their cash balance until you mark it as paid.
        </p>
      </div>

      <Card className="space-y-3">
        <h2 className="font-semibold">Declare a dividend</h2>
        <DeclareForm today={defaultDate} holders={holders} />
      </Card>

      <Card flush>
        <h2 className="px-4 pt-4 font-semibold sm:px-5">Declared</h2>
        {dividends.length === 0 ? (
          <p className="px-4 pb-4 pt-2 text-sm text-muted sm:px-5">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line" data-testid="dividend-list">
            {dividends.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/dividends/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-paper sm:px-5">
                  <div>
                    <div className={`font-medium tabular-nums ${d.voided_at ? "text-muted line-through" : ""}`}>
                      {formatCents(BigInt(d.total_cents))}
                      {d.voided_at && <span className="ml-2 text-xs font-normal no-underline">Voided</span>}
                    </div>
                    <div className="text-xs text-muted">
                      Declared {d.declaration_date} · record date {d.record_date} · {d.holders} shareholders
                      {d.memo ? ` · ${d.memo}` : ""}
                    </div>
                  </div>
                  <div className="text-right text-xs tabular-nums">
                    <div>Paid {formatCents(BigInt(d.paid_cents))}</div>
                    <div className="text-muted">Held as cash {formatCents(BigInt(d.held_cents))}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
