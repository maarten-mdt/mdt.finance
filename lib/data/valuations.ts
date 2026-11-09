import "server-only";
import { withContext, type DbContext } from "@/lib/db";
import { pricePerShareCents } from "@/lib/calc";

export const FIRST_VALUATION_YEAR = 2020;

export interface ValuationRow {
  year: number;
  ebitdaCents: bigint | null;
  debtCents: bigint | null;
  multipleX100: bigint | null;
  sharesOutstanding: bigint | null;
  priceCents: bigint | null;
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  /** Dividends declared in this calendar year. */
  dividendCount: number;
  dividendTotalCents: bigint;
}

export interface ValuationDefaults {
  multipleX100: bigint;
  sharesOutstanding: bigint;
}

/** Every year from 2020 to next year, with whatever has been entered so far. */
export async function listValuations(ctx: DbContext, thisYear: number): Promise<{ rows: ValuationRow[]; defaults: ValuationDefaults }> {
  return withContext(ctx, async (tx) => {
    const cycles = new Map(
      (
        await tx.query<{
          year: number;
          ebitda_cents: string;
          debt_cents: string;
          multiple_x100: string;
          shares_outstanding: string;
          price_per_share_cents: string;
          locked_at: string | null;
          locked_by: string | null;
          locked_by_name: string | null;
        }>(
          `SELECT c.year, c.ebitda_cents::text, c.debt_cents::text, c.multiple_x100::text, c.shares_outstanding::text,
                  c.price_per_share_cents::text, c.locked_at::text, c.locked_by, p.name AS locked_by_name
           FROM cycles c LEFT JOIN people p ON p.id::text = c.locked_by`,
        )
      ).rows.map((c) => [c.year, c]),
    );
    const divs = new Map(
      (
        await tx.query<{ year: number; n: number; total: string }>(
          `SELECT extract(year FROM declaration_date)::int AS year, count(*)::int AS n, sum(total_cents)::text AS total
           FROM dividends GROUP BY 1`,
        )
      ).rows.map((d) => [d.year, d]),
    );
    const s = new Map(
      (
        await tx.query<{ key: string; v: string }>(
          "SELECT key, int_value::text AS v FROM current_settings WHERE key IN ('valuation_multiple_x100','shares_outstanding_total')",
        )
      ).rows.map((r) => [r.key, BigInt(r.v)]),
    );
    const last = Math.max(thisYear + 1, ...cycles.keys());
    const rows: ValuationRow[] = [];
    for (let y = last; y >= FIRST_VALUATION_YEAR; y--) {
      const c = cycles.get(y);
      const d = divs.get(y);
      rows.push({
        year: y,
        ebitdaCents: c ? BigInt(c.ebitda_cents) : null,
        debtCents: c ? BigInt(c.debt_cents) : null,
        multipleX100: c ? BigInt(c.multiple_x100) : null,
        sharesOutstanding: c ? BigInt(c.shares_outstanding) : null,
        priceCents: c ? BigInt(c.price_per_share_cents) : null,
        locked: !!c?.locked_at,
        lockedAt: c?.locked_at ?? null,
        lockedBy: c ? (c.locked_by_name ?? c.locked_by) : null,
        dividendCount: d?.n ?? 0,
        dividendTotalCents: d ? BigInt(d.total) : 0n,
      });
    }
    return {
      rows,
      defaults: { multipleX100: s.get("valuation_multiple_x100") ?? 700n, sharesOutstanding: s.get("shares_outstanding_total") ?? 1n },
    };
  });
}

export interface ValuationInput {
  year: number;
  ebitdaCents: bigint;
  debtCents: bigint;
  multipleX100: bigint;
  sharesOutstanding: bigint;
}

/**
 * Save a year's inputs as a draft (or update the draft). The price is always recalculated
 * here from the inputs, never taken from the browser. Locked years can't change (the database
 * also refuses).
 */
export async function saveValuation(ctx: DbContext, v: ValuationInput): Promise<bigint> {
  const price = pricePerShareCents(v);
  await withContext(ctx, async (tx) => {
    const existing = (await tx.query<{ locked_at: string | null }>("SELECT locked_at FROM cycles WHERE year = $1 FOR UPDATE", [v.year])).rows[0];
    if (existing?.locked_at) throw new Error(`${v.year} is locked and can't be changed.`);
    const args = [v.year, v.ebitdaCents, v.debtCents, v.multipleX100, v.sharesOutstanding, price].map(String);
    if (existing) {
      await tx.query(
        `UPDATE cycles SET ebitda_cents = $2, debt_cents = $3, multiple_x100 = $4, shares_outstanding = $5, price_per_share_cents = $6
         WHERE year = $1`,
        args,
      );
    } else {
      await tx.query(
        `INSERT INTO cycles (year, ebitda_cents, debt_cents, multiple_x100, shares_outstanding, price_per_share_cents, settlement_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, make_date($1::int, 7, 1), 'draft')`,
        args,
      );
    }
  });
  return price;
}

/** Lock a saved year after board approval. Holders see its price from then on; it can't change. */
export async function lockValuation(ctx: DbContext, year: number): Promise<void> {
  await withContext(ctx, async (tx) => {
    const r = await tx.query(
      "UPDATE cycles SET status = 'locked', locked_at = now(), locked_by = app.current_actor() WHERE year = $1 AND locked_at IS NULL",
      [year],
    );
    if (r.rowCount !== 1) throw new Error(`Save ${year} before locking it.`);
  });
}
