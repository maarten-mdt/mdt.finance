import "server-only";
import { withContext, type DbContext, type Tx } from "@/lib/db";
import { specialHolder, type LedgerRow } from "@/lib/ledger/csv";
import { insertMovement } from "./transfers";

export interface ResolvedRow extends LedgerRow {
  fromId: string | null;
  toId: string | null;
  fromName: string | null;
  toName: string | null;
}

/**
 * Match each row's from/to to a holder: special names first ("Issued by MDT", "VRH"), then an
 * exact name (ignoring case), then a company's contact person (e.g. "Nathan Neels" →
 * 1076844 BC Ltd.). Ambiguous or unknown names stay unresolved and are reported.
 */
async function resolve(tx: Tx, rows: LedgerRow[]): Promise<ResolvedRow[]> {
  const people = (
    await tx.query<{ id: string; name: string; contact_name: string | null; system_key: string | null }>(
      "SELECT id, name, contact_name, system_key FROM people WHERE merged_into IS NULL",
    )
  ).rows;
  const byKey = new Map(people.filter((p) => p.system_key).map((p) => [p.system_key!, p]));
  const lookup = (raw: string) => {
    const special = specialHolder(raw);
    if (special) return byKey.get(special) ?? null;
    const n = raw.trim().toLowerCase();
    const byName = people.filter((p) => p.name.trim().toLowerCase() === n);
    if (byName.length === 1) return byName[0]!;
    if (byName.length > 1) return null;
    const byContact = people.filter((p) => p.contact_name?.trim().toLowerCase() === n);
    return byContact.length === 1 ? byContact[0]! : null;
  };
  return rows.map((r) => {
    const f = lookup(r.from);
    const t = lookup(r.to);
    return { ...r, fromId: f?.id ?? null, toId: t?.id ?? null, fromName: f?.name ?? null, toName: t?.name ?? null };
  });
}

export function previewLedgerImport(ctx: DbContext, rows: LedgerRow[]): Promise<ResolvedRow[]> {
  return withContext(ctx, (tx) => resolve(tx, rows));
}

/**
 * Record every row, oldest first (file order within a day), in one transaction: if any row fails
 * (unknown holder, seller short of shares), nothing is recorded and the line is reported.
 */
export async function applyLedgerImport(ctx: DbContext, rows: LedgerRow[]): Promise<number> {
  return withContext(ctx, async (tx) => {
    const resolved = await resolve(tx, rows);
    const ordered = [...resolved].sort((a, b) => (a.date === b.date ? a.line - b.line : a.date < b.date ? -1 : 1));
    for (const r of ordered) {
      if (!r.fromId || !r.toId) throw new Error(`Line ${r.line}: “${!r.fromId ? r.from : r.to}” doesn't match a holder.`);
      try {
        await insertMovement(tx, {
          fromId: r.fromId,
          toId: r.toId,
          shares: r.shares,
          priceCents: r.priceCents,
          amountCents: r.amountCents,
          date: r.date,
          memo: r.memo,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        throw new Error(`Line ${r.line}: ${/cannot transfer/.test(m) ? `${r.from} doesn't hold enough shares on ${r.date}` : m}`);
      }
    }
    return ordered.length;
  });
}
