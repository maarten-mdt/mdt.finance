import Link from "next/link";
import { Card } from "@/components/ui";
import { formatCents, formatShares } from "@/lib/calc";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { listPeople } from "@/lib/data/admin";
import { todayInVancouver } from "@/lib/data/holder";
import { latestPriceCents, listMovements } from "@/lib/data/transfers";
import { reverseTransferAction } from "./actions";
import { TransferForm } from "./transfer-form";

const typeLabel: Record<string, string> = {
  vrh_sale: "VRH sale",
  vrh_buyback: "VRH buyback",
  holder_transfer: "Between holders",
  correction: "Correction",
};

export default async function TransfersPage() {
  const viewer = await requireAdmin();
  const ctx = adminContext(viewer);
  const [people, movements, price] = await Promise.all([listPeople(ctx), listMovements(ctx), latestPriceCents(ctx)]);
  const eligible = people.filter((p) => p.system_key !== "opening_balance" && (p.email || p.system_key === "vrh"));
  const sellers = eligible
    .filter((p) => BigInt(p.shares) > 0n)
    .map((p) => ({ id: p.id, label: `${p.name}${p.system_key === "vrh" ? " (VRH)" : ""} · ${formatShares(BigInt(p.shares))} shares` }));
  const buyers = eligible.filter((p) => p.status !== "departed").map((p) => ({ id: p.id, label: `${p.name}${p.system_key === "vrh" ? " (VRH)" : ""}` }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Buy / sell</h1>
        <p className="text-sm text-muted">
          Record a sale of shares from one shareholder to another, including sales by VRH and buybacks by VRH. Payment happens
          outside the system; this records the change of ownership.
        </p>
      </div>

      <Card className="space-y-3">
        <h2 className="font-semibold">Record a sale</h2>
        <TransferForm sellers={sellers} buyers={buyers} defaultPrice={price === null ? "" : formatCents(price).replace("$", "")} today={todayInVancouver()} />
      </Card>

      <Card flush className="overflow-x-auto">
        <h2 className="px-4 pt-4 font-semibold sm:px-5">Recent sales</h2>
        <table className="mt-2 w-full text-sm" data-testid="movements">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Seller → buyer</th>
              <th className="px-4 py-2 text-right">Shares</th>
              <th className="px-4 py-2 text-right">Price</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  No sales yet.
                </td>
              </tr>
            )}
            {movements.map((m) => {
              const struck = m.reversed_by || m.reverses_entry_id;
              return (
                <tr key={m.id} className={`border-b border-line last:border-0 ${struck ? "text-muted" : ""}`}>
                  <td className="px-4 py-2.5 tabular-nums">{m.entry_date}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/people/${m.from_id}`} className="hover:underline">
                      {m.from_name}
                    </Link>{" "}
                    →{" "}
                    <Link href={`/admin/people/${m.to_id}`} className="hover:underline">
                      {m.to_name}
                    </Link>
                    <div className="text-xs text-muted">
                      {typeLabel[m.type] ?? m.type}
                      {m.reverses_entry_id ? ` of #${m.reverses_entry_id}` : ""}
                      {m.memo ? ` · ${m.memo}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatShares(BigInt(m.shares))}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(BigInt(m.price_cents))}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(BigInt(m.amount_cents))}</td>
                  <td className="px-4 py-2.5 text-right">
                    {m.reversed_by ? (
                      <span className="text-xs">Reversed by #{m.reversed_by}</span>
                    ) : m.type !== "correction" ? (
                      <form action={reverseTransferAction}>
                        <input type="hidden" name="entryId" value={m.id} />
                        <button className="text-xs text-danger hover:underline">Reverse</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted">
        Entries are never edited or deleted. Reversing writes a correction that exactly cancels the original; then record the sale
        again with the right details.
      </p>
    </div>
  );
}
