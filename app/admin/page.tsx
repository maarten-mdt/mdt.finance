import Link from "next/link";
import { Card } from "@/components/ui";
import { formatShares } from "@/lib/calc";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { listPeople } from "@/lib/data/admin";

const typeLabel: Record<string, string> = {
  employee: "Employee",
  outside_investor: "Investor",
  entity: "Company",
  system: "System",
};

export default async function PeoplePage() {
  const viewer = await requireAdmin();
  const people = await listPeople(adminContext(viewer));
  const holders = people.filter((p) => BigInt(p.shares) > 0n && p.system_key === null).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">People</h1>
          <p className="text-sm text-muted">
            {people.length} records · {holders} holding shares
          </p>
        </div>
        <Link href="/admin/import" className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">
          Import CSV
        </Link>
      </div>

      {/* Cards on phones, a table from the sm breakpoint up. */}
      <ul className="space-y-2 sm:hidden">
        {people.map((p) => (
          <li key={p.id}>
            <Link href={`/admin/people/${p.id}`}>
              <Card className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted">
                    {typeLabel[p.type]} · {p.status.replace("_", " ")}
                  </div>
                </div>
                <div className="text-right tabular-nums">{formatShares(BigInt(p.shares))}</div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <Card className="hidden overflow-x-auto p-0 sm:block">
        <table className="w-full text-sm" data-testid="people-table">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Hired</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3 text-right">Shares</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/admin/people/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  {p.email && <div className="text-xs text-muted">{p.email}</div>}
                </td>
                <td className="px-4 py-3">{typeLabel[p.type]}</td>
                <td className="px-4 py-3 capitalize">{p.status.replace("_", " ")}</td>
                <td className="px-4 py-3 tabular-nums">{p.hire_date ?? "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {p.system_key ? "—" : !p.has_account ? "Not invited" : p.mfa_enabled ? "Active" : "MFA pending"}
                  {p.is_admin && <span className="ml-1 rounded bg-ink px-1 text-[10px] text-white">ADMIN</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatShares(BigInt(p.shares))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
