import "server-only";
import { withContext, type DbContext, type Tx } from "@/lib/db";
import { allocateByShares, allocatePerShare, perShareRate, type Allocation } from "@/lib/calc";

export interface DividendInput {
  mode: "total" | "per_share";
  /** The total to pay out, or the amount per share, in cents. */
  amountCents: bigint;
  recordDate: string;
}

export interface DividendLine extends Allocation {
  name: string;
  isVrh: boolean;
}

export interface DividendPreview {
  lines: DividendLine[];
  totalShares: bigint;
  totalCents: bigint;
  /** Hundredths of a cent per share. */
  rate: bigint;
}

async function compute(tx: Tx, input: DividendInput): Promise<DividendPreview> {
  const holders = (
    await tx.query<{ holder_id: string; shares: string; name: string; system_key: string | null }>(
      `SELECT h.holder_id, h.shares::text, p.name, p.system_key
       FROM app.holdings_at($1) h JOIN people p ON p.id = h.holder_id
       WHERE p.system_key IS DISTINCT FROM 'opening_balance'
       ORDER BY h.shares DESC, p.name`,
      [input.recordDate],
    )
  ).rows;
  const shares = holders.map((h) => ({ holderId: h.holder_id, shares: BigInt(h.shares) }));
  const allocations = input.mode === "total" ? allocateByShares(input.amountCents, shares) : allocatePerShare(input.amountCents, shares);
  const meta = new Map(holders.map((h) => [h.holder_id, h]));
  const lines = allocations.map((a) => ({ ...a, name: meta.get(a.holderId)!.name, isVrh: meta.get(a.holderId)!.system_key === "vrh" }));
  const totalShares = shares.reduce((a, s) => a + s.shares, 0n);
  const totalCents = lines.reduce((a, l) => a + l.amountCents, 0n);
  return { lines, totalShares, totalCents, rate: perShareRate(totalCents, totalShares) };
}

export function previewDividend(ctx: DbContext, input: DividendInput): Promise<DividendPreview> {
  return withContext(ctx, (tx) => compute(tx, input));
}

/**
 * Declare a dividend: recompute the allocation in the same transaction, then record the
 * dividend, one allocation per holder, and a dividend credit on each holder's cash balance.
 */
export async function declareDividend(
  ctx: DbContext,
  input: DividendInput & { declarationDate: string; memo: string | null },
): Promise<string> {
  return withContext(ctx, async (tx) => {
    const p = await compute(tx, input);
    const id = (
      await tx.query<{ id: string }>(
        `INSERT INTO dividends (declaration_date, record_date, amount_per_share_cents, total_cents, input_mode, memo)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          input.declarationDate,
          input.recordDate,
          input.mode === "per_share" ? input.amountCents.toString() : null,
          p.totalCents.toString(),
          input.mode,
          input.memo,
        ],
      )
    ).rows[0]!.id;
    for (const l of p.lines) {
      if (l.amountCents === 0n) continue;
      await tx.query(
        `INSERT INTO dividend_allocations (dividend_id, person_id, shares_on_record_date, amount_cents) VALUES ($1, $2, $3, $4)`,
        [id, l.holderId, l.shares.toString(), l.amountCents.toString()],
      );
      await tx.query(
        `INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents, dividend_id) VALUES ($1, $2, 'dividend', $3, $4)`,
        [input.declarationDate, l.holderId, l.amountCents.toString(), id],
      );
    }
    return id;
  });
}

export interface DividendSummary {
  id: string;
  declaration_date: string;
  record_date: string;
  input_mode: "total" | "per_share";
  amount_per_share_cents: string | null;
  total_cents: string;
  memo: string | null;
  holders: number;
  paid_cents: string;
  held_cents: string;
}

export async function listDividends(ctx: DbContext): Promise<DividendSummary[]> {
  const r = await withContext(ctx, (tx) =>
    tx.query<DividendSummary>(
      `SELECT d.id, d.declaration_date, d.record_date, d.input_mode, d.amount_per_share_cents::text, d.total_cents::text, d.memo,
              count(a.id)::int AS holders,
              coalesce(sum(a.amount_cents) FILTER (WHERE a.disposition = 'paid_out'), 0)::text AS paid_cents,
              coalesce(sum(a.amount_cents) FILTER (WHERE a.disposition <> 'paid_out'), 0)::text AS held_cents
       FROM dividends d LEFT JOIN dividend_allocations a ON a.dividend_id = d.id
       GROUP BY d.id ORDER BY d.declaration_date DESC, d.created_at DESC`,
    ),
  );
  return r.rows;
}

export interface AllocationRow {
  id: string;
  person_id: string;
  name: string;
  email: string | null;
  system_key: string | null;
  bank_last4: string | null;
  shares_on_record_date: string;
  amount_cents: string;
  disposition: "pending" | "paid_out" | "applied_to_purchase";
  paid_on: string | null;
}

export async function getDividend(ctx: DbContext, id: string): Promise<{ dividend: DividendSummary; allocations: AllocationRow[] } | null> {
  return withContext(ctx, async (tx) => {
    const d = (
      await tx.query<DividendSummary>(
        `SELECT d.id, d.declaration_date, d.record_date, d.input_mode, d.amount_per_share_cents::text, d.total_cents::text, d.memo,
                (SELECT count(*)::int FROM dividend_allocations a WHERE a.dividend_id = d.id) AS holders,
                '0' AS paid_cents, '0' AS held_cents
         FROM dividends d WHERE d.id = $1`,
        [id],
      )
    ).rows[0];
    if (!d) return null;
    const allocations = (
      await tx.query<AllocationRow>(
        `SELECT a.id, a.person_id, p.name, p.email, p.system_key, p.bank_last4, a.shares_on_record_date::text,
                a.amount_cents::text, a.disposition, a.paid_on
         FROM dividend_allocations a JOIN people p ON p.id = a.person_id
         WHERE a.dividend_id = $1
         ORDER BY p.system_key IS NULL, p.name`,
        [id],
      )
    ).rows;
    return { dividend: d, allocations };
  });
}

/**
 * Mark allocations as paid out by the company on `paidOn`: each gets a payout entry that takes
 * the amount back out of the holder's cash balance. Allocations already paid are skipped.
 */
export async function markPaid(ctx: DbContext, dividendId: string, allocationIds: string[], paidOn: string): Promise<number> {
  return withContext(ctx, async (tx) => {
    let n = 0;
    for (const aid of allocationIds) {
      const a = (
        await tx.query<{ person_id: string; amount_cents: string }>(
          `SELECT person_id, amount_cents::text FROM dividend_allocations
           WHERE id = $1 AND dividend_id = $2 AND disposition = 'pending' FOR UPDATE`,
          [aid, dividendId],
        )
      ).rows[0];
      if (!a) continue;
      const entry = (
        await tx.query<{ id: string }>(
          `INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents, dividend_id, memo)
           VALUES ($1, $2, 'payout', $3, $4, 'Dividend paid out') RETURNING id::text`,
          [paidOn, a.person_id, (-BigInt(a.amount_cents)).toString(), dividendId],
        )
      ).rows[0]!.id;
      await tx.query(
        "UPDATE dividend_allocations SET disposition = 'paid_out', paid_on = $2, payout_entry_id = $3 WHERE id = $1",
        [aid, paidOn, entry],
      );
      n++;
    }
    return n;
  });
}
