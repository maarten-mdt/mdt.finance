import "server-only";
import { withContext, type DbContext } from "@/lib/db";
import {
  costBasisCents,
  creditSummary,
  eligibilityDate,
  isEligible,
  valueCents,
  valueHistory,
  withoutReversed,
  type Cents,
  type CreditEntry,
  type CreditSummary,
  type CreditType,
  type LedgerEntry,
  type PricePoint,
  type Shares,
  type ValuePoint,
} from "@/lib/calc";

export type MovementKind = "vrh_sale" | "holder_transfer" | "vrh_buyback" | "opening_balance" | "correction";

export interface Movement {
  id: string;
  date: string;
  kind: MovementKind;
  direction: "in" | "out";
  shares: Shares;
  priceCents: Cents;
  amountCents: Cents;
}

export interface Dashboard {
  name: string;
  type: string;
  shares: Shares;
  priceCents: Cents | null;
  priceYear: number | null;
  valueCents: Cents | null;
  costBasisCents: Cents;
  /** Set for employees who are not eligible yet. */
  eligibleOn: string | null;
  eligible: boolean;
  eligibilityYears: number;
  credit: CreditSummary;
  /** Share movements, oldest first, without reversed entries or their corrections. */
  movements: Movement[];
  /** Every board-approved price, oldest first. */
  prices: (PricePoint & { year: number })[];
  /** The holder's position at each valuation date. */
  history: ValuePoint[];
}

const SELF = "self";
const COUNTERPARTY = "counterparty";

/** Everything the holder dashboard shows, computed from the ledgers. */
export async function getDashboard(ctx: DbContext, today: string): Promise<Dashboard | null> {
  return withContext(ctx, async (tx) => {
    const person = (
      await tx.query<{ name: string; type: string; hire_date: string | null; status: string }>(
        "SELECT name, type, hire_date, status FROM people WHERE id = app.current_person_id()",
      )
    ).rows[0];
    if (!person) return null;

    const rows = (
      await tx.query<{
        id: string;
        entry_date: string;
        type: MovementKind;
        direction: "in" | "out";
        shares: string;
        price_cents: string;
        reverses_entry_id: string | null;
      }>(
        "SELECT id::text, entry_date, type, direction, shares::text, price_cents::text, reverses_entry_id::text FROM app.my_share_entries()",
      )
    ).rows;

    // my_share_entries hides the counterparty, so model each movement as self ↔ "counterparty".
    const ledger: LedgerEntry[] = rows.map((e) => ({
      id: e.id,
      date: e.entry_date,
      from: e.direction === "in" ? COUNTERPARTY : SELF,
      to: e.direction === "in" ? SELF : COUNTERPARTY,
      shares: BigInt(e.shares),
      priceCents: BigInt(e.price_cents),
      reversesId: e.reverses_entry_id,
    }));
    const kindById = new Map(rows.map((r) => [r.id, r.type]));
    const movements: Movement[] = withoutReversed(ledger).map((l) => ({
      id: l.id,
      date: l.date,
      kind: kindById.get(l.id)!,
      direction: l.to === SELF ? "in" : "out",
      shares: l.shares,
      priceCents: l.priceCents,
      amountCents: valueCents(l.shares, l.priceCents),
    }));
    const shares = BigInt((await tx.query<{ b: string }>("SELECT app.my_share_balance()::text AS b")).rows[0]!.b);

    const prices = (
      await tx.query<{ year: number; settlement_date: string; price_per_share_cents: string }>(
        "SELECT year, settlement_date, price_per_share_cents::text FROM cycles WHERE locked_at IS NOT NULL ORDER BY year",
      )
    ).rows.map((c) => ({ year: c.year, date: c.settlement_date, priceCents: BigInt(c.price_per_share_cents) }));
    const latest = prices.at(-1) ?? null;

    const credit = creditSummary(
      (
        await tx.query<{ id: string; type: CreditType; amount_cents: string; reverses_entry_id: string | null }>(
          "SELECT id::text, type, amount_cents::text, reverses_entry_id::text FROM credit_ledger WHERE person_id = app.current_person_id()",
        )
      ).rows.map(
        (r): CreditEntry => ({ id: r.id, type: r.type, amountCents: BigInt(r.amount_cents), reversesId: r.reverses_entry_id }),
      ),
    );

    const years = (
      await tx.query<{ int_value: string }>("SELECT int_value::text FROM current_settings WHERE key = 'eligibility_years'")
    ).rows[0];
    if (!years) throw new Error("Setting eligibility_years is missing");
    const eligibilityYears = Number(years.int_value);

    let eligibleOn: string | null = null;
    let eligible = person.type !== "employee";
    if (person.type === "employee" && person.hire_date) {
      eligible = isEligible(person.hire_date, today, eligibilityYears);
      if (!eligible) eligibleOn = eligibilityDate(person.hire_date, eligibilityYears);
    }

    return {
      name: person.name,
      type: person.type,
      shares,
      priceCents: latest?.priceCents ?? null,
      priceYear: latest?.year ?? null,
      valueCents: latest ? valueCents(shares, latest.priceCents) : null,
      costBasisCents: costBasisCents(ledger, SELF),
      eligibleOn,
      eligible,
      eligibilityYears,
      credit,
      movements,
      prices,
      history: valueHistory(ledger, SELF, prices),
    };
  });
}

/** Today's date in Vancouver, where MDT's program dates apply. */
export function todayInVancouver(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
