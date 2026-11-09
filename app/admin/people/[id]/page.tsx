import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { addYears, formatShares } from "@/lib/calc";
import { maskBank, maskSin } from "@/lib/crypto/fields";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { getIntSetting, getPerson } from "@/lib/data/admin";
import { listDocumentsFor } from "@/lib/data/documents";
import { todayInVancouver } from "@/lib/data/holder";
import { AgreementSection } from "./agreement-section";
import { AdminRoleButton, InviteButton, RevealField } from "./person-actions";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const viewer = await requireAdmin();
  const [p, eligibilityYears, docs] = await Promise.all([
    getPerson(adminContext(viewer), id),
    getIntSetting(adminContext(viewer), "eligibility_years"),
    listDocumentsFor(adminContext(viewer), id),
  ]);
  if (!p) notFound();

  const rows: [string, React.ReactNode][] = [
    ["Type", p.type.replace("_", " ")],
    ["Email", p.email ?? "—"],
    ["Hire date", p.hire_date ?? "—"],
    ["Eligible from", p.type === "employee" && p.hire_date ? addYears(p.hire_date, eligibilityYears) : "—"],
    ["Status", p.status.replace("_", " ")],
    ["Departure", p.departure_date ? `${p.departure_date} (${p.departure_reason ?? "no reason recorded"})` : "—"],
    ["Tax residency", p.tax_residency ?? "—"],
    ["Shares held", formatShares(BigInt(p.shares))],
  ];

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-muted hover:underline">
        ← People
      </Link>
      <h1 className="text-xl font-bold tracking-tight">{p.name}</h1>

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

      {!p.system_key && (
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
                ? "No account yet."
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
              <AdminRoleButton personId={p.id} name={p.name} isAdmin={p.is_admin} isSelf={p.id === viewer.personId} />
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
