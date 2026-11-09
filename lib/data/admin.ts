import "server-only";
import { withContext, type DbContext } from "@/lib/db";
import type { PersonRow } from "@/lib/people/csv";

export const SYSTEM_HOLDERS = {
  vrh: { name: "Van Ruitenburg Holdings Ltd.", type: "entity" },
  opening_balance: { name: "Opening balance (pre-system)", type: "system" },
} as const;

export interface PersonListItem {
  id: string;
  type: string;
  name: string;
  email: string | null;
  hire_date: string | null;
  status: string;
  system_key: string | null;
  contact_name: string | null;
  shares: string;
  has_account: boolean;
  mfa_enabled: boolean;
  passkeys: number;
  is_admin: boolean;
}

export async function listPeople(ctx: DbContext): Promise<PersonListItem[]> {
  const r = await withContext(ctx, (tx) =>
    tx.query<PersonListItem>(
      `SELECT p.id, p.type, p.name, p.email, p.hire_date, p.status, p.system_key, p.contact_name,
              coalesce(h.shares, 0)::text AS shares,
              coalesce(a.has_account, false) AS has_account,
              coalesce(a.mfa_enabled, false) AS mfa_enabled,
              coalesce(a.passkeys, 0) AS passkeys,
              EXISTS (SELECT 1 FROM user_roles r WHERE r.person_id = p.id AND r.role = 'admin') AS is_admin
       FROM people p
       LEFT JOIN holdings h ON h.holder_id = p.id
       LEFT JOIN app.account_status() a ON a.person_id = p.id
       WHERE p.merged_into IS NULL
       ORDER BY p.system_key IS NULL, p.name`,
    ),
  );
  return r.rows;
}

export interface PersonDetail extends PersonListItem {
  departure_date: string | null;
  departure_reason: string | null;
  tax_residency: string | null;
  sin_last4: string | null;
  bank_last4: string | null;
  has_sin: boolean;
  has_bank: boolean;
  merged_into: string | null;
}

export async function getPerson(ctx: DbContext, id: string): Promise<PersonDetail | null> {
  const r = await withContext(ctx, (tx) =>
    tx.query<PersonDetail>(
      `SELECT p.id, p.type, p.name, p.email, p.hire_date, p.status, p.system_key, p.contact_name, p.merged_into,
              p.departure_date, p.departure_reason, p.tax_residency, p.sin_last4, p.bank_last4,
              p.sin_ciphertext IS NOT NULL AS has_sin, p.bank_ciphertext IS NOT NULL AS has_bank,
              coalesce(h.shares, 0)::text AS shares,
              coalesce(a.has_account, false) AS has_account,
              coalesce(a.mfa_enabled, false) AS mfa_enabled,
              coalesce(a.passkeys, 0) AS passkeys,
              EXISTS (SELECT 1 FROM user_roles r WHERE r.person_id = p.id AND r.role = 'admin') AS is_admin
       FROM people p
       LEFT JOIN holdings h ON h.holder_id = p.id
       LEFT JOIN app.account_status() a ON a.person_id = p.id
       WHERE p.id = $1`,
      [id],
    ),
  );
  return r.rows[0] ?? null;
}

export interface ImportResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Insert new people and sync existing ones in one transaction. People are matched by email, or by
 * name when the row has no email (a matched person without an email gets the row's email).
 * Existing people keep their id, ledger history and encrypted fields.
 */
export async function importPeople(ctx: DbContext, rows: PersonRow[]): Promise<ImportResult> {
  return withContext(ctx, async (tx) => {
    const result: ImportResult = { inserted: 0, updated: 0, unchanged: 0 };
    for (const row of rows) {
      const dbType = row.type === "company" ? "entity" : row.type;
      const match = (
        await tx.query<{ id: string }>(
          `SELECT id FROM people
           WHERE merged_into IS NULL AND system_key IS NULL
             AND (($1::text IS NOT NULL AND email = $1)
                  OR (lower(name) = lower($2) AND ($1::text IS NULL OR email IS NULL)))
           ORDER BY (email = $1) DESC NULLS LAST LIMIT 1`,
          [row.email, row.name],
        )
      ).rows[0];
      if (!match) {
        await tx.query(
          "INSERT INTO people (type, name, email, hire_date, status, contact_name) VALUES ($1, $2, $3, $4, $5, $6)",
          [dbType, row.name, row.email, row.hireDate, row.status, row.contactName],
        );
        result.inserted++;
        continue;
      }
      const r = await tx.query(
        `UPDATE people SET type = $2, name = $3, email = coalesce($4, email), hire_date = coalesce($5, hire_date),
                status = $6, contact_name = coalesce($7, contact_name)
         WHERE id = $1
           AND (type, name, email, hire_date, status, contact_name) IS DISTINCT FROM
               ($2::person_type, $3, coalesce($4, email), coalesce($5::date, hire_date), $6::employment_status, coalesce($7, contact_name))`,
        [match.id, dbType, row.name, row.email, row.hireDate, row.status, row.contactName],
      );
      if (r.rowCount) result.updated++;
      else result.unchanged++;
    }
    return result;
  });
}

export interface PersonUpdate {
  name: string;
  type: "employee" | "outside_investor" | "entity";
  email: string | null;
  contactName: string | null;
  hireDate: string | null;
  status: "active" | "leave" | "departed" | "not_applicable";
}

/** Edit a person's details. System holders (VRH, opening balance) keep their type. */
export async function updatePerson(ctx: DbContext, id: string, u: PersonUpdate): Promise<void> {
  await withContext(ctx, async (tx) => {
    const r = await tx.query(
      `UPDATE people SET name = $2,
              type = CASE WHEN system_key IS NULL THEN $3::person_type ELSE type END,
              email = $4, contact_name = $5, hire_date = $6, status = $7
       WHERE id = $1 AND merged_into IS NULL AND system_key IS DISTINCT FROM 'opening_balance'`,
      [id, u.name, u.type, u.email, u.contactName, u.hireDate, u.status],
    );
    if (r.rowCount !== 1) throw new Error("This record can't be edited.");
  });
}

/** Create VRH and the opening-balance holder if they don't exist yet. Idempotent. */
export async function ensureSystemHolders(ctx: DbContext): Promise<void> {
  await withContext(ctx, async (tx) => {
    for (const [key, h] of Object.entries(SYSTEM_HOLDERS)) {
      await tx.query(
        `INSERT INTO people (type, name, system_key) SELECT $1, $2, $3
         WHERE NOT EXISTS (SELECT 1 FROM people WHERE system_key = $3)`,
        [h.type, h.name, key],
      );
    }
  });
}

export async function getSystemHolderIds(ctx: DbContext): Promise<{ vrh: string | null; opening: string | null }> {
  const r = await withContext(ctx, (tx) =>
    tx.query<{ system_key: string; id: string }>("SELECT system_key, id FROM people WHERE system_key IS NOT NULL"),
  );
  const by = new Map(r.rows.map((x) => [x.system_key, x.id]));
  return { vrh: by.get("vrh") ?? null, opening: by.get("opening_balance") ?? null };
}

export interface OpeningEntry {
  id: string;
  entry_date: string;
  holder_id: string;
  holder_name: string;
  shares: string;
  price_cents: string;
  amount_cents: string;
  memo: string | null;
  created_by: string;
  created_at: string;
  reversed_by: string | null;
}

export async function listOpeningBalances(ctx: DbContext): Promise<OpeningEntry[]> {
  const r = await withContext(ctx, (tx) =>
    tx.query<OpeningEntry>(
      `SELECT l.id::text, l.entry_date, l.to_holder_id AS holder_id, p.name AS holder_name,
              l.shares::text, l.price_cents::text, l.amount_cents::text, l.memo, l.created_by, l.created_at::text,
              (SELECT c.id::text FROM share_ledger c WHERE c.reverses_entry_id = l.id) AS reversed_by
       FROM share_ledger l JOIN people p ON p.id = l.to_holder_id
       WHERE l.type = 'opening_balance'
       ORDER BY l.id DESC`,
    ),
  );
  return r.rows;
}

export async function recordOpeningBalance(
  ctx: DbContext,
  input: { holderId: string; shares: bigint; priceCents: bigint; amountCents: bigint; entryDate: string; memo: string | null },
): Promise<string> {
  return withContext(ctx, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents, memo)
       SELECT $1, 'opening_balance', o.id, $2, $3, $4, $5, $6
       FROM people o WHERE o.system_key = 'opening_balance'
       RETURNING id::text`,
      [input.entryDate, input.holderId, input.shares.toString(), input.priceCents.toString(), input.amountCents.toString(), input.memo],
    );
    if (r.rowCount !== 1) throw new Error("Create the system holders first.");
    return r.rows[0]!.id;
  });
}

/** Reverse a ledger entry with an exactly mirrored correction entry. */
export async function reverseShareEntry(ctx: DbContext, entryId: string, memo: string): Promise<void> {
  await withContext(ctx, (tx) =>
    tx.query(
      `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents, reverses_entry_id, memo)
       SELECT current_date, 'correction', to_holder_id, from_holder_id, shares, price_cents, amount_cents, id, $2
       FROM share_ledger WHERE id = $1`,
      [entryId, memo],
    ),
  );
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  actor_name: string | null;
  action: string;
  table_name: string | null;
  record_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export async function listAudit(
  ctx: DbContext,
  opts: { table?: string; actor?: string; record?: string; before?: string; limit?: number },
): Promise<AuditRow[]> {
  const r = await withContext(ctx, (tx) =>
    tx.query<AuditRow>(
      `SELECT a.id::text, a.at::text, a.actor, p.name AS actor_name, a.action, a.table_name, a.record_id, a.before, a.after
       FROM audit_log a
       LEFT JOIN people p ON p.id::text = a.actor
       WHERE ($1::text IS NULL OR a.table_name = $1)
         AND ($2::text IS NULL OR a.actor = $2)
         AND ($3::text IS NULL OR a.record_id = $3)
         AND ($4::bigint IS NULL OR a.id < $4)
       ORDER BY a.id DESC
       LIMIT $5`,
      [opts.table ?? null, opts.actor ?? null, opts.record ?? null, opts.before ?? null, opts.limit ?? 50],
    ),
  );
  return r.rows;
}

export async function logReveal(ctx: DbContext, field: "sin" | "bank", personId: string): Promise<{ ciphertext: string | null }> {
  return withContext(ctx, async (tx) => {
    // Log first, in the same transaction: if logging fails, nothing is revealed.
    await tx.query("SELECT app.log_event($1, 'people', $2)", [`reveal.${field}`, personId]);
    const col = field === "sin" ? "sin_ciphertext" : "bank_ciphertext";
    const r = await tx.query<{ ct: string | null }>(`SELECT ${col} AS ct FROM people WHERE id = $1`, [personId]);
    return { ciphertext: r.rows[0]?.ct ?? null };
  });
}

/** A numeric program rule from the settings table (never hard-coded). */
export async function getIntSetting(ctx: DbContext, key: string): Promise<number> {
  const r = await withContext(ctx, (tx) =>
    tx.query<{ v: string }>("SELECT int_value::text AS v FROM current_settings WHERE key = $1", [key]),
  );
  const v = r.rows[0]?.v;
  if (v === undefined) throw new Error(`Setting ${key} is missing`);
  return Number(v);
}

/** Grant or remove the admin role. The database blocks self-removal and removing the last admin. */
export async function setAdminRole(ctx: DbContext, personId: string, admin: boolean): Promise<void> {
  await withContext(ctx, (tx) =>
    admin
      ? tx.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING", [personId])
      : tx.query("DELETE FROM user_roles WHERE person_id = $1 AND role = 'admin'", [personId]),
  );
}
