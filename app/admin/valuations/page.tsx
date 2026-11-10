import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { listValuations } from "@/lib/data/valuations";
import { todayInVancouver } from "@/lib/data/holder";
import { formatCents, formatShares } from "@/lib/calc";
import { ValuationRowForm } from "./valuation-row";

const dollarsInput = (c: bigint | null) => (c === null ? "" : formatCents(c).replace("$", "").replace("−", "-"));
const multipleInput = (m: bigint) => `${(m / 100n).toString()}${m % 100n ? `.${(m % 100n).toString().padStart(2, "0").replace(/0$/, "")}` : ""}`;

export default async function ValuationsPage() {
  const viewer = await requireAdmin();
  const thisYear = Number(todayInVancouver().slice(0, 4));
  const { rows, defaults } = await listValuations(adminContext(viewer), thisYear);
  // The latest saved year is shown to shareholders even before it's locked, as an estimate.
  const latestSaved = rows.find((r) => r.priceCents !== null)?.year ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Valuations</h1>
        <p className="text-sm text-muted">
          Price per share for each year = (multiple × audited EBITDA − debt) ÷ total shares outstanding. Enter a year&apos;s numbers and
          save it. The latest year shows to shareholders as an estimate (marked &ldquo;not yet audited&rdquo;) until you lock it once the
          audit is done and the board approves. Locked prices can&apos;t be changed; older unlocked years stay hidden.
        </p>
      </div>
      <div className="space-y-3" data-testid="valuations">
        {rows.map((r) => (
          <ValuationRowForm
            key={r.year}
            year={r.year}
            isLatest={r.year === latestSaved}
            locked={r.locked}
            lockedNote={r.locked ? `Locked ${r.lockedAt?.slice(0, 10)}${r.lockedBy ? ` by ${r.lockedBy}` : ""}` : null}
            saved={r.priceCents !== null}
            initial={{
              ebitda: dollarsInput(r.ebitdaCents),
              debt: dollarsInput(r.debtCents),
              multiple: multipleInput(r.multipleX100 ?? defaults.multipleX100),
              // Whole shares here; formatShares takes hundredths.
              shares: formatShares((r.sharesOutstanding ?? defaults.sharesOutstanding) * 100n),
            }}
            dividends={r.dividendCount ? `${r.dividendCount} declared, ${formatCents(r.dividendTotalCents)} total` : null}
          />
        ))}
      </div>
    </div>
  );
}
