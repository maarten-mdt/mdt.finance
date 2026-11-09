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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Valuations</h1>
        <p className="text-sm text-muted">
          Price per share for each year = (multiple × audited EBITDA − debt) ÷ total shares outstanding. Enter a year&apos;s numbers and
          save it as a draft; lock it once the board approves. Locked prices are what shareholders see, are used for their returns,
          and can&apos;t be changed.
        </p>
      </div>
      <div className="space-y-3" data-testid="valuations">
        {rows.map((r) => (
          <ValuationRowForm
            key={r.year}
            year={r.year}
            locked={r.locked}
            lockedNote={r.locked ? `Locked ${r.lockedAt?.slice(0, 10)}${r.lockedBy ? ` by ${r.lockedBy}` : ""}` : null}
            saved={r.priceCents !== null}
            initial={{
              ebitda: dollarsInput(r.ebitdaCents),
              debt: dollarsInput(r.debtCents),
              multiple: multipleInput(r.multipleX100 ?? defaults.multipleX100),
              shares: formatShares(r.sharesOutstanding ?? defaults.sharesOutstanding),
            }}
            dividends={r.dividendCount ? `${r.dividendCount} declared, ${formatCents(r.dividendTotalCents)} total` : null}
          />
        ))}
      </div>
    </div>
  );
}
