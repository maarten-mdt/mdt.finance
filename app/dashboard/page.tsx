import { AppHeader } from "@/components/app-header";
import { LineChart, type ChartSeries } from "@/components/line-chart";
import { Card, Stat } from "@/components/ui";
import { formatBps, formatCents, formatShares, ratioBps } from "@/lib/calc";
import { holderContext, requireViewer } from "@/lib/auth/guards";
import { listMyDocuments } from "@/lib/data/documents";
import { getDashboard, todayInVancouver, type Movement } from "@/lib/data/holder";
import { AgreementCard } from "./agreement-card";

export const dynamic = "force-dynamic";

// Categorical slots 1 and 2 (validated pair: CVD ΔE 24.7, normal 33.6 on white).
const BLUE = "#2a78d6";
const ORANGE = "#eb6834";

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function movementLabel(m: Movement): string {
  if (m.kind === "opening_balance") return "Opening balance";
  if (m.kind === "vrh_buyback") return "Bought back by VRH";
  return m.direction === "in" ? "Bought" : "Sold";
}

function signedCents(c: bigint): string {
  return c > 0n ? `+${formatCents(c)}` : formatCents(c);
}

export default async function DashboardPage() {
  const viewer = await requireViewer();
  const [d, docs] = await Promise.all([getDashboard(holderContext(viewer), todayInVancouver()), listMyDocuments(holderContext(viewer))]);
  if (!d) throw new Error("Your shareholder record could not be found.");

  const gain = d.valueCents === null ? null : d.valueCents - d.costBasisCents;
  const gainPct = gain === null ? null : ratioBps(gain, d.costBasisCents);
  const totalReturn = gain === null ? null : gain + d.credit.dividendsCents;
  const totalPct = totalReturn === null ? null : ratioBps(totalReturn, d.costBasisCents);
  const holdsAnything = d.movements.length > 0;

  // Chart 1: value vs. amount invested at each valuation.
  const historyDates = d.history.map((h) => shortDate(h.date));
  const valueSeries: ChartSeries[] = [
    {
      key: "value",
      name: "Value",
      color: BLUE,
      kind: "line",
      points: d.history.map((h, i) => ({
        x: i,
        y: Number(h.valueCents),
        label: formatCents(h.valueCents),
        note: `${formatShares(h.shares)} shares × ${formatCents(h.priceCents)}`,
      })),
    },
    {
      key: "invested",
      name: "Invested",
      color: ORANGE,
      kind: "line",
      points: d.history.map((h, i) => ({ x: i, y: Number(h.costBasisCents), label: formatCents(h.costBasisCents) })),
    },
  ];

  // Chart 2: price per share by year, with this holder's purchases marked.
  const buys = d.movements.filter((m) => m.direction === "in");
  const years = [...new Set([...d.prices.map((p) => p.year), ...buys.map((b) => Number(b.date.slice(0, 4)))])].sort();
  const yearIndex = new Map(years.map((y, i) => [y, i]));
  const priceSeries: ChartSeries[] = [
    {
      key: "price",
      name: "Price per share",
      color: BLUE,
      kind: "line",
      points: d.prices.map((p) => ({ x: yearIndex.get(p.year)!, y: Number(p.priceCents), label: formatCents(p.priceCents) })),
    },
    {
      key: "buys",
      name: "Your purchases",
      color: ORANGE,
      kind: "markers",
      points: buys.map((b) => ({
        x: yearIndex.get(Number(b.date.slice(0, 4)))!,
        y: Number(b.priceCents),
        label: formatCents(b.priceCents),
        note: `${formatShares(b.shares)} shares on ${shortDate(b.date)}`,
      })),
    },
  ];

  return (
    <>
      <AppHeader name={d.name} isAdmin={viewer.isAdmin} area="holder" />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <h1 className="text-xl font-bold tracking-tight">Hi {d.name.split(" ")[0]}</h1>

        {d.eligibleOn && (
          <Card className="border-accent/40 bg-accent/5">
            <p className="text-sm">
              You become eligible to buy shares on <strong data-testid="eligible-on">{longDate(d.eligibleOn)}</strong>, after{" "}
              {d.eligibilityYears} years of service.
            </p>
          </Card>
        )}

        <AgreementCard
          docs={docs.map((x) => ({ id: x.id, version: x.version, status: x.status, signedOn: x.signed_on, note: x.note }))}
        />

        {/* Position */}
        <Card>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
            <Stat label="Shares held" value={<span data-testid="shares">{formatShares(d.shares)}</span>} />
            <Stat
              label="Price per share"
              value={d.priceCents === null ? "Not set yet" : formatCents(d.priceCents)}
              sub={d.priceYear ? `${d.priceYear} valuation` : "Set after the annual valuation"}
            />
            <Stat label="Current value" value={<span data-testid="value">{d.valueCents === null ? "—" : formatCents(d.valueCents)}</span>} />
            <Stat label="Invested" value={<span data-testid="cost-basis">{formatCents(d.costBasisCents)}</span>} sub="What you paid (cost basis)" />
          </div>
          {holdsAnything && gain !== null && (
            <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 border-t border-line pt-5 sm:grid-cols-4">
              <Stat label="Value gain" value={signedCents(gain)} sub={gainPct === null ? undefined : formatBps(gainPct)} />
              <Stat label="Dividends earned" value={formatCents(d.credit.dividendsCents)} sub="All time" />
              <Stat
                label="Annualized return"
                value={<span data-testid="annualized">{d.annualizedBps === null ? "—" : `${formatBps(d.annualizedBps)}`}</span>}
                sub={d.annualizedBps === null ? "Shown after your first year" : "Per year, like a savings rate"}
              />
              <Stat
                label="Total return"
                value={<span data-testid="total-return">{signedCents(totalReturn!)}</span>}
                sub={totalPct === null ? "Value gain + dividends" : `${formatBps(totalPct)} · gain + dividends`}
              />
            </div>
          )}
        </Card>

        {/* Cash */}
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Stat label="Cash balance" value={<span data-testid="cash-balance">{formatCents(d.credit.balanceCents)}</span>} />
            <p className="max-w-sm text-xs text-muted">
              Money MDT is holding for you, such as dividends not yet paid out. You&apos;ll be able to have it paid to your bank or
              put toward your next share purchase.
            </p>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 border-t border-line pt-3 text-sm sm:grid-cols-2" data-testid="cash-breakdown">
            {(
              [
                ["Dividends earned", d.credit.dividendsCents, 1],
                ["Payroll savings", d.credit.payrollSavingsCents, 1],
                ["Left over from purchases", d.credit.leftoverCents, 1],
                ["Top-ups", d.credit.topUpCents, 1],
                ["Paid out to you", d.credit.paidOutCents, -1],
                ["Used for purchases", d.credit.appliedCents, -1],
              ] as const
            )
              .filter(([, v]) => v !== 0n)
              .map(([label, v, sign]) => (
                <div key={label} className="flex justify-between py-1">
                  <dt className="text-muted">{label}</dt>
                  <dd className="tabular-nums">{sign < 0 ? `−${formatCents(v)}` : formatCents(v)}</dd>
                </div>
              ))}
            {d.credit.balanceCents === 0n && d.credit.dividendsCents === 0n && <p className="py-1 text-muted">Nothing held for you right now.</p>}
          </dl>
        </Card>

        {/* Charts */}
        {d.history.length === 1 && (
          <Card className="space-y-1">
            <h2 className="font-semibold">How your investment is doing</h2>
            <p className="text-sm text-muted">
              A chart of your value over time appears after your second annual valuation. Your next one is July 1,{" "}
              {Number(d.history[0]!.date.slice(0, 4)) + 1}.
            </p>
          </Card>
        )}

        {d.history.length > 1 && (
          <Card className="space-y-2">
            <h2 className="font-semibold">How your investment is doing</h2>
            <p className="text-xs text-muted">Value of your shares at each annual valuation, compared with what you paid.</p>
            <LineChart
              title="Value of your shares and amount invested at each valuation"
              categories={historyDates}
              series={valueSeries}
              table={{
                headers: ["Valuation", "Shares", "Price", "Value", "Invested"],
                rows: d.history.map((h) => [
                  shortDate(h.date),
                  formatShares(h.shares),
                  formatCents(h.priceCents),
                  formatCents(h.valueCents),
                  formatCents(h.costBasisCents),
                ]),
              }}
            />
          </Card>
        )}

        {d.prices.length > 0 && (
          <Card className="space-y-2">
            <h2 className="font-semibold">Price per share by year</h2>
            <p className="text-xs text-muted">The board-approved price each year{buys.length ? ", with the prices you paid marked" : ""}.</p>
            <LineChart
              title="Price per share by year"
              categories={years.map(String)}
              series={buys.length ? priceSeries : priceSeries.slice(0, 1)}
              table={{
                headers: ["Year", "Price per share"],
                rows: d.prices.map((p) => [String(p.year), formatCents(p.priceCents)]),
              }}
            />
          </Card>
        )}

        {/* History */}
        <Card flush>
          <h2 className="px-4 pt-4 font-semibold sm:px-5">Share history</h2>
          {!holdsAnything ? (
            <p className="px-4 pb-4 pt-2 text-sm text-muted sm:px-5">No shares yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-line sm:hidden" data-testid="history-list">
                {[...d.movements].reverse().map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div>
                      <div className="font-medium">
                        {movementLabel(m)} {formatShares(m.shares)} shares
                      </div>
                      <div className="text-xs text-muted">
                        {shortDate(m.date)} · {formatCents(m.priceCents)} each
                      </div>
                    </div>
                    <div className="tabular-nums">{formatCents(m.amountCents)}</div>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="mt-2 w-full text-sm" data-testid="history-table">
                  <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-5 py-2">Date</th>
                      <th className="px-5 py-2">What happened</th>
                      <th className="px-5 py-2 text-right">Shares</th>
                      <th className="px-5 py-2 text-right">Price each</th>
                      <th className="px-5 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.movements].reverse().map((m) => (
                      <tr key={m.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-2.5 tabular-nums">{shortDate(m.date)}</td>
                        <td className="px-5 py-2.5">{movementLabel(m)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          {m.direction === "out" ? "−" : ""}
                          {formatShares(m.shares)}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatCents(m.priceCents)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatCents(m.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </main>
    </>
  );
}
