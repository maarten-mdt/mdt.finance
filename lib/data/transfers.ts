import "server-only";
import { withContext, type DbContext, type Tx } from "@/lib/db";

export interface MovementInput {
  fromId: string;
  toId: string;
  /** Hundredths of a share. */
  shares: bigint;
  /** Per whole share. */
  priceCents: bigint;
  /** What was actually paid for the whole movement. */
  amountCents: bigint;
  date: string;
  memo: string | null;
}

/** The ledger entry type follows from who's involved. */
export function movementType(fromKey: string | null, toKey: string | null): "opening_balance" | "vrh_sale" | "vrh_buyback" | "holder_transfer" {
  if (fromKey === "opening_balance") return "opening_balance";
  if (fromKey === "vrh") return "vrh_sale";
  if (toKey === "vrh") return "vrh_buyback";
  return "holder_transfer";
}

/** Insert one share movement inside an existing transaction. */
export async function insertMovement(tx: Tx, m: MovementInput): Promise<string> {
  const keys = new Map(
    (
      await tx.query<{ id: string; system_key: string | null; merged_into: string | null }>(
        "SELECT id, system_key, merged_into FROM people WHERE id = ANY($1::uuid[])",
        [[m.fromId, m.toId]],
      )
    ).rows.map((r) => [r.id, r]),
  );
  const from = keys.get(m.fromId);
  const to = keys.get(m.toId);
  if (!from || !to || m.fromId === m.toId) throw new Error("Choose two different holders.");
  if (from.merged_into || to.merged_into) throw new Error("That holder was merged into another record.");
  if (to.system_key === "opening_balance") throw new Error("Shares can't be returned to “Issued by MDT”; reverse the entry instead.");
  const r = await tx.query<{ id: string }>(
    `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents, memo, cycle_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT id FROM cycles WHERE settlement_date = $1::date))
     RETURNING id::text`,
    [m.date, movementType(from.system_key, to.system_key), m.fromId, m.toId, m.shares.toString(), m.priceCents.toString(), m.amountCents.toString(), m.memo],
  );
  return r.rows[0]!.id;
}

/** Record a sale, purchase or issuance of shares. The database checks the seller has the shares. */
export async function recordMovement(ctx: DbContext, m: MovementInput): Promise<string> {
  return withContext(ctx, (tx) => insertMovement(tx, m));
}

export interface MovementRow {
  id: string;
  entry_date: string;
  type: string;
  from_id: string;
  from_name: string;
  from_key: string | null;
  to_id: string;
  to_name: string;
  to_key: string | null;
  shares: string;
  price_cents: string;
  amount_cents: string;
  memo: string | null;
  reverses_entry_id: string | null;
  reversed_by: string | null;
}

const MOVEMENT_SQL = `
  SELECT l.id::text, l.entry_date, l.type, l.from_holder_id AS from_id, f.name AS from_name, f.system_key AS from_key,
         l.to_holder_id AS to_id, t.name AS to_name, t.system_key AS to_key,
         l.shares::text, l.price_cents::text, l.amount_cents::text, l.memo, l.reverses_entry_id::text,
         (SELECT c.id::text FROM share_ledger c WHERE c.reverses_entry_id = l.id) AS reversed_by
  FROM share_ledger l JOIN people f ON f.id = l.from_holder_id JOIN people t ON t.id = l.to_holder_id`;

export async function listMovements(ctx: DbContext, limit = 100): Promise<MovementRow[]> {
  const r = await withContext(ctx, (tx) =>
    tx.query<MovementRow>(`${MOVEMENT_SQL} WHERE l.type <> 'opening_balance' ORDER BY l.id DESC LIMIT $1`, [limit]),
  );
  return r.rows;
}

/** Every movement in or out of one holder, oldest first. */
export async function listPersonMovements(ctx: DbContext, personId: string): Promise<MovementRow[]> {
  const r = await withContext(ctx, (tx) =>
    tx.query<MovementRow>(
      `${MOVEMENT_SQL} WHERE l.from_holder_id = $1 OR l.to_holder_id = $1 ORDER BY l.entry_date, l.id`,
      [personId],
    ),
  );
  return r.rows;
}

export async function latestPriceCents(ctx: DbContext): Promise<bigint | null> {
  const r = await withContext(ctx, (tx) =>
    tx.query<{ p: string }>("SELECT price_per_share_cents::text AS p FROM cycles WHERE locked_at IS NOT NULL ORDER BY year DESC LIMIT 1"),
  );
  return r.rows[0] ? BigInt(r.rows[0].p) : null;
}
