import Link from "next/link";
import { Button, Card, Stat } from "@/components/ui";
import { formatCents, formatShares } from "@/lib/calc";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { getSystemHolderIds, listOpeningBalances, listPeople } from "@/lib/data/admin";
import { ensureSystemHoldersAction, reverseEntryAction } from "../actions";
import { OpeningBalanceForm } from "./opening-form";
import { StartOver } from "./start-over";
import { withContext } from "@/lib/db";

export default async function HoldersPage() {
  const viewer = await requireAdmin();
  const ctx = adminContext(viewer);
  const ids = await getSystemHolderIds(ctx);

  if (!ids.vrh || !ids.opening) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">VRH & opening balances</h1>
        <Card className="space-y-3">
          <p className="text-sm">
            Set up the two holder records every share movement needs: <strong>Van Ruitenburg Holdings Ltd.</strong> (VRH), and{" "}
            <strong>Opening balance (pre-system)</strong>, the source of shares that existed before this system.
          </p>
          <form action={ensureSystemHoldersAction}>
            <Button type="submit">Create VRH and opening-balance holders</Button>
          </form>
        </Card>
      </div>
    );
  }

  const [people, allEntries, liveCount] = await Promise.all([
    listPeople(ctx),
    listOpeningBalances(ctx),
    withContext(ctx, (tx) =>
      tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM share_ledger l WHERE l.type <> 'correction'
         AND NOT EXISTS (SELECT 1 FROM share_ledger c WHERE c.reverses_entry_id = l.id)`,
      ),
    ).then((r) => r.rows[0]!.n),
  ]);
  // Reversed opening balances are history, not part of the current picture.
  const entries = allEntries.filter((e) => !e.reversed_by);
  const hiddenReversed = allEntries.length - entries.length;
  const vrh = people.find((p) => p.system_key === "vrh")!;
  const opening = people.find((p) => p.system_key === "opening_balance")!;
  const choices = people
    .filter((p) => p.system_key !== "opening_balance")
    .map((p) => ({ id: p.id, label: p.system_key === "vrh" ? `${p.name} (VRH)` : p.name }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">VRH & opening balances</h1>

      <Card>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="VRH shares" value={<span data-testid="vrh-shares">{formatShares(BigInt(vrh.shares))}</span>} />
          <Stat
            label="Recorded as opening balances"
            value={formatShares(-BigInt(opening.shares))}
            sub="Shares that existed before this system"
          />
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Record an opening balance</h2>
        <p className="text-sm text-muted">
          Use this for shares a holder (or VRH) already owned before the portal. The price is what they paid per share, which
          sets their cost basis.
        </p>
        <OpeningBalanceForm holders={choices} />
      </Card>

      <Card flush className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="opening-table">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Holder</th>
              <th className="px-4 py-3 text-right">Shares</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  No opening balances yet.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className={`border-b border-line last:border-0 ${e.reversed_by ? "text-muted line-through" : ""}`}>
                <td className="px-4 py-3 tabular-nums">{e.id}</td>
                <td className="px-4 py-3 tabular-nums">{e.entry_date}</td>
                <td className="px-4 py-3">
                  <Link href={`/admin/people/${e.holder_id}`} className="hover:underline">
                    {e.holder_name}
                  </Link>
                  {e.memo && <div className="text-xs text-muted no-underline">{e.memo}</div>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatShares(BigInt(e.shares))}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatCents(BigInt(e.price_cents))}</td>
                <td className="px-4 py-3 text-right">
                  {e.reversed_by ? (
                    <span className="text-xs no-underline">Reversed by #{e.reversed_by}</span>
                  ) : (
                    <form action={reverseEntryAction}>
                      <input type="hidden" name="entryId" value={e.id} />
                      <button className="text-xs text-danger hover:underline">Reverse</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {hiddenReversed > 0 && (
        <p className="text-xs text-muted">
          {hiddenReversed} reversed opening balance{hiddenReversed === 1 ? " is" : "s are"} hidden; they remain in each person&apos;s history
          and the audit log.
        </p>
      )}
      <StartOver live={liveCount} />
      <p className="text-xs text-muted">
        Ledger entries are never edited or deleted. Reversing writes a new correction entry that exactly cancels the original.
      </p>
    </div>
  );
}
