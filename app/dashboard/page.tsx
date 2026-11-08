import { AppHeader } from "@/components/app-header";
import { Card, Stat } from "@/components/ui";
import { formatCents, formatShares } from "@/lib/calc";
import { holderContext, requireViewer } from "@/lib/auth/guards";
import { getDashboard, todayInVancouver } from "@/lib/data/holder";

export const dynamic = "force-dynamic";

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export default async function DashboardPage() {
  const viewer = await requireViewer();
  const d = await getDashboard(holderContext(viewer), todayInVancouver());
  if (!d) throw new Error("Your shareholder record could not be found.");

  return (
    <>
      <AppHeader name={d.name} isAdmin={viewer.isAdmin} area="holder" />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <h1 className="text-xl font-bold tracking-tight">Hi {d.name.split(" ")[0]}</h1>

        {d.eligibleOn && (
          <Card className="border-accent/40 bg-accent/5">
            <p className="text-sm">
              You become eligible to buy shares on <strong data-testid="eligible-on">{longDate(d.eligibleOn)}</strong>, after {d.eligibilityYears}{" "}
              years of service.
            </p>
          </Card>
        )}

        <Card>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
            <Stat label="Shares held" value={<span data-testid="shares">{formatShares(d.shares)}</span>} />
            <Stat
              label="Price per share"
              value={d.priceCents === null ? "Not set yet" : formatCents(d.priceCents)}
              sub={d.priceYear ? `${d.priceYear} valuation` : "Set after the annual valuation"}
            />
            <Stat label="Current value" value={<span data-testid="value">{d.valueCents === null ? "—" : formatCents(d.valueCents)}</span>} />
            <Stat label="Cost basis" value={<span data-testid="cost-basis">{formatCents(d.costBasisCents)}</span>} sub="What you paid in total" />
          </div>
        </Card>

        <p className="text-xs text-muted">
          Values use the most recent board-approved price. Buying, selling, dividends and returns arrive in later releases.
        </p>
      </main>
    </>
  );
}
