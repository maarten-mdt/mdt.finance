import Link from "next/link";
import { Card } from "@/components/ui";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { listAudit } from "@/lib/data/admin";

const TABLES = ["people", "share_ledger", "credit_ledger", "dividends", "dividend_allocations", "documents", "files", "agreement_templates", "settings", "cycles", "user_roles", "invites", "user", "passkey", "session"];

function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  if (!before) return after ? Object.entries(after).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${JSON.stringify(v)}`) : [];
  if (!after) return ["(deleted)"];
  return Object.keys({ ...before, ...after })
    .filter((k) => k !== "updated_at" && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`);
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; record?: string; actor?: string; before?: string }>;
}) {
  const viewer = await requireAdmin();
  const q = await searchParams;
  const table = q.table && TABLES.includes(q.table) ? q.table : undefined;
  const before = q.before && /^\d+$/.test(q.before) ? q.before : undefined;
  const rows = await listAudit(adminContext(viewer), { table, record: q.record, actor: q.actor, before, limit: 50 });
  const last = rows.at(-1);
  const qs = (extra: Record<string, string | undefined>) =>
    "?" + new URLSearchParams(Object.entries({ table, record: q.record, actor: q.actor, ...extra }).filter(([, v]) => v) as [string, string][]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted">Every change and every sensitive read, newest first. Entries can&apos;t be edited or removed.</p>
      </div>
      <form className="flex flex-wrap gap-2 text-sm">
        <select name="table" defaultValue={table ?? ""} className="rounded-lg border border-line bg-white px-3 py-2">
          <option value="">All tables</option>
          {TABLES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        {q.record && <input type="hidden" name="record" value={q.record} />}
        <button className="rounded-lg border border-line bg-white px-3 py-2">Filter</button>
        {(table || q.record || q.actor) && (
          <Link href="/admin/audit" className="px-3 py-2 text-muted hover:underline">
            Clear
          </Link>
        )}
      </form>

      <ol className="space-y-2" data-testid="audit-list">
        {rows.map((r) => (
          <li key={r.id}>
            <Card className="text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-semibold">{r.action}</span>
                  {r.table_name && <span className="text-muted"> · {r.table_name}</span>}
                  {r.record_id && <span className="font-mono text-xs text-muted"> #{r.record_id.slice(0, 8)}</span>}
                </div>
                <time className="text-xs tabular-nums text-muted">{new Date(r.at).toLocaleString("en-CA", { timeZone: "America/Vancouver" })}</time>
              </div>
              <div className="text-xs text-muted">by {r.actor_name ?? r.actor}</div>
              {diff(r.before, r.after).length > 0 && (
                <ul className="mt-2 space-y-0.5 break-all font-mono text-xs">
                  {diff(r.before, r.after).slice(0, 12).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </Card>
          </li>
        ))}
      </ol>
      {rows.length === 50 && last && (
        <Link href={`/admin/audit${qs({ before: last.id })}`} className="inline-block text-sm hover:underline">
          Older entries →
        </Link>
      )}
    </div>
  );
}
