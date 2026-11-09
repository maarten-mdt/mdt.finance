import "server-only";
import { withContext, type DbContext } from "@/lib/db";

export interface TransferInput {
  sellerId: string;
  buyerId: string;
  shares: bigint;
  priceCents: bigint;
  date: string;
  memo: string | null;
}

/**
 * Record a sale of shares from one holder to another. The ledger entry type follows from who is
 * involved: VRH selling is a vrh_sale, VRH buying is a vrh_buyback, anything else a holder
 * transfer. The database checks the seller has the shares.
 */
export async function recordTransfer(ctx: DbContext, t: TransferInput): Promise<string> {
  return withContext(ctx, async (tx) => {
    const keys = new Map(
      (
        await tx.query<{ id: string; system_key: string | null }>("SELECT id, system_key FROM people WHERE id = ANY($1::uuid[])", [
          [t.sellerId, t.buyerId],
        ])
      ).rows.map((r) => [r.id, r.system_key]),
    );
    if (keys.size !== 2) throw new Error("Choose a seller and a different buyer.");
    if ([...keys.values()].includes("opening_balance")) throw new Error("Use the opening balances screen for pre-portal shares.");
    const type = keys.get(t.sellerId) === "vrh" ? "vrh_sale" : keys.get(t.buyerId) === "vrh" ? "vrh_buyback" : "holder_transfer";
    const r = await tx.query<{ id: string }>(
      `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, memo, cycle_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               (SELECT id FROM cycles WHERE settlement_date = $1::date))
       RETURNING id::text`,
      [t.date, type, t.sellerId, t.buyerId, t.shares.toString(), t.priceCents.toString(), t.memo],
    );
    return r.rows[0]!.id;
  });
}

export interface MovementRow {
  id: string;
  entry_date: string;
  type: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  shares: string;
  price_cents: string;
  memo: string | null;
  reverses_entry_id: string | null;
  reversed_by: string | null;
}

export async function listMovements(ctx: DbContext, limit = 100): Promise<MovementRow[]> {
  const r = await withContext(ctx, (tx) =>
    tx.query<MovementRow>(
      `SELECT l.id::text, l.entry_date, l.type, l.from_holder_id AS from_id, f.name AS from_name,
              l.to_holder_id AS to_id, t.name AS to_name, l.shares::text, l.price_cents::text, l.memo,
              l.reverses_entry_id::text,
              (SELECT c.id::text FROM share_ledger c WHERE c.reverses_entry_id = l.id) AS reversed_by
       FROM share_ledger l JOIN people f ON f.id = l.from_holder_id JOIN people t ON t.id = l.to_holder_id
       WHERE l.type <> 'opening_balance'
       ORDER BY l.id DESC LIMIT $1`,
      [limit],
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
