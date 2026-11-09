import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { addYears, formatCents, formatShares } from "@/lib/calc";
import { maskBank, maskSin } from "@/lib/crypto/fields";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { getIntSetting, getPerson, listPeople } from "@/lib/data/admin";
import { listDocumentsFor } from "@/lib/data/documents";
import { todayInVancouver } from "@/lib/data/holder";
import { latestPriceCents, listPersonMovements } from "@/lib/data/transfers";
import { reversePersonEntryAction } from "./actions";
import { AgreementSection } from "./agreement-section";
import { AdminRoleButton, InviteButton, RevealField } from "./person-actions";
import { PersonDetailsForm, ShareMoveForm } from "./person-editors";

const typeLabel: Record<string, string> = {
  employee: "Employee",
  outside_investor: "Outside investor",
  entity: "Company",
  system: "System",
};

const holderLabel = (name: string, key: string | null) =>
  key === "opening_balance" ? "Issued by MDT / pre-portal" : key === "vrh" ? `${name} (VRH)` : name;

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const viewer = await requireAdmin();
  const ctx = adminContext(viewer);
  const [p, eligibilityYears, docs, movements, people, price] = await Promise.all([
    getPerson(ctx, id),
    getIntSetting(ctx, "eligibility_years"),
    listDocumentsFor(ctx, id),
    listPersonMovements(ctx, id),
    listPeople(ctx),
    latestPriceCents(ctx),
  ]);
  if (!p) notFound();
  if (p.merged_into) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold tracking-tight">{p.name}</h1>
        <Card>
          This record was merged.{" "}
          <Link className="underline" href={`/admin/people/${p.merged_into}`}>
            Go to the record it was merged into
          </Link>
          .
        </Card>
      </div>
    );
  }
  const isOpening = p.system_key === "opening_balance";
  const canSignIn = !isOpening;

  const rows: [string, React.ReactNode][] = [
    ["Type", typeLabel[p.type] ?? p.type],
    ...(p.type === "entity" ? ([["Contact person", p.contact_name ?? "—"]] as [string, React.ReactNode][]) : []),
    ["Email", p.email ?? "—"],
    ...(p.type === "employee"
      ? ([
          ["Hire date", p.hire_date ?? "—"],
          ["Eligible from", p.hire_date ? addYears(p.hire_date, eligibilityYears) : "—"],
          ["Status", p.status.replace("_", " ")],
        ] as [string, React.ReactNode][])
      : []),
    ["Shares held", <span key="s" data-testid="person-shares">{formatShares(BigInt(p.shares))}</span>],
  ];

  const others = people.filter((o) => o.id !== p.id);
  const sources = others
    .filter((o) => o.system_key === "opening_balance" || BigInt(o.shares) > 0n)
    .map((o) => ({
      id: o.id,
      label: o.system_key === "opening_balance" ? "Issued by MDT / pre-portal" : `${holderLabel(o.name, o.system_key)} · ${formatShares(BigInt(o.shares))} shares`,
    }));
  const destinations = others.filter((o) => o.system_key !== "opening_balance").map((o) => ({ id: o.id, label: holderLabel(o.name, o.system_key) }));

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-muted hover:underline">
        ← People
      </Link>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{p.name}</h1>
        {p.type === "entity" && p.contact_name && <p className="text-sm text-muted">Contact: {p.contact_name}</p>}
      </div>

      <Card>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {!isOpening && (
        <PersonDetailsForm
          p={{
            id: p.id,
            name: p.name,
            type: p.type as "employee" | "outside_investor" | "entity" | "system",
            email: p.email,
            contactName: p.contact_name,
            hireDate: p.hire_date,
            status: p.status,
            isVrh: p.system_key === "vrh",
          }}
        />
      )}

      {/* Shares */}
      <Card flush>
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 sm:px-5">
          <h2 className="font-semibold">Shares</h2>
          <span className="text-sm text-muted">Every change is a ledger entry; mistakes are reversed, never edited.</span>
        </div>
        {movements.length === 0 ? (
          <p className="px-4 pb-4 pt-2 text-sm text-muted sm:px-5">No share history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm" data-testid="person-ledger">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">From / to</th>
                  <th className="px-4 py-2 text-right">Shares</th>
                  <th className="px-4 py-2 text-right">Price</th>
                  <th className="px-4 py-2 text-right">Paid</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const incoming = m.to_id === p.id;
                  const counterparty = incoming ? holderLabel(m.from_name, m.from_key) : holderLabel(m.to_name, m.to_key);
                  const struck = !!(m.reversed_by || m.reverses_entry_id);
                  return (
                    <tr key={m.id} className={`border-b border-line last:border-0 ${struck ? "text-muted" : ""}`}>
                      <td className="px-4 py-2.5 tabular-nums">{m.entry_date}</td>
                      <td className="px-4 py-2.5">
                        {incoming ? "From " : "To "}
                        {counterparty}
                        {(m.memo || m.reverses_entry_id) && (
                          <div className="text-xs text-muted">
                            {m.reverses_entry_id ? `Reverses #${m.reverses_entry_id}` : ""}
                            {m.reverses_entry_id && m.memo ? " · " : ""}
                            {m.memo}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {incoming ? "+" : "−"}
                        {formatShares(BigInt(m.shares))}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(BigInt(m.price_cents))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(BigInt(m.amount_cents))}</td>
                      <td className="px-4 py-2.5 text-right">
                        {m.reversed_by ? (
                          <span className="text-xs">Reversed</span>
                        ) : m.type !== "correction" ? (
                          <form action={reversePersonEntryAction}>
                            <input type="hidden" name="entryId" value={m.id} />
                            <input type="hidden" name="personId" value={p.id} />
                            <button className="text-xs text-danger hover:underline">Reverse</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isOpening && (
          <div className="border-t border-line p-4 sm:p-5">
            <ShareMoveForm
              personId={p.id}
              personName={p.name}
              sources={sources}
              destinations={destinations}
              defaultPrice={price === null ? "" : formatCents(price).replace("$", "")}
              today={todayInVancouver()}
            />
          </div>
        )}
      </Card>

      {canSignIn && (
        <>
          {p.email && (
            <AgreementSection
              personId={p.id}
              today={todayInVancouver()}
              docs={docs.map((d) => ({
                id: d.id,
                version: d.version,
                status: d.status,
                signedOn: d.signed_on,
                sentAt: d.sent_at,
                returnedAt: d.returned_at,
                note: d.note,
                signedFileId: d.signed_file_id,
                templateFileId: d.template_file_id,
              }))}
            />
          )}

          <Card className="space-y-3">
            <h2 className="font-semibold">Sensitive details</h2>
            <p className="text-xs text-muted">Shown masked. Every reveal is recorded in the audit log under your name.</p>
            <RevealField personId={p.id} field="sin" label="SIN" masked={maskSin(p.sin_last4)} available={p.has_sin} />
            <RevealField personId={p.id} field="bank" label="Banking" masked={maskBank(p.bank_last4)} available={p.has_bank} />
          </Card>

          <Card className="space-y-3">
            <h2 className="font-semibold">Portal access</h2>
            <p className="text-sm">
              {!p.has_account
                ? p.email
                  ? "No account yet."
                  : "No email yet: add one under Edit details to send an invite."
                : p.mfa_enabled
                  ? `Account active with two-step sign-in${p.passkeys ? ` and ${p.passkeys} passkey(s)` : ""}.`
                  : "Account created; two-step sign-in not set up yet."}
              {p.is_admin && " Administrator."}
            </p>
            {p.email && p.status !== "departed" && <InviteButton personId={p.id} hasAccount={p.has_account} />}
          </Card>

          {p.email && p.status !== "departed" && (
            <Card className="space-y-3">
              <h2 className="font-semibold">Admin access</h2>
              <p className="text-sm text-muted">
                {p.is_admin
                  ? "This person is an admin. Admins sign in to the console with a passkey."
                  : "Admins can see every record, reveal sensitive details and change people and balances."}
              </p>
              <AdminRoleButton personId={p.id} name={p.contact_name ?? p.name} isAdmin={p.is_admin} isSelf={p.id === viewer.personId} />
            </Card>
          )}
        </>
      )}

      <Link href={`/admin/audit?record=${p.id}`} className="inline-block text-sm text-muted hover:underline">
        View this person&apos;s audit history →
      </Link>
    </div>
  );
}
