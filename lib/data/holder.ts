import "server-only";
import { withContext, type DbContext } from "@/lib/db";
import {
  costBasisCents,
  eligibilityDate,
  isEligible,
  valueCents,
  type Cents,
  type LedgerEntry,
  type Shares,
} from "@/lib/calc";

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
}

const SELF = "self";
const COUNTERPARTY = "counterparty";

/** Everything the read-only holder dashboard shows, computed from the ledger. */
export async function getDashboard(ctx: DbContext, today: string): Promise<Dashboard | null> {
  return withContext(ctx, async (tx) => {
    const person = (
      await tx.query<{ name: string; type: string; hire_date: string | null; status: string }>(
        "SELECT name, type, hire_date, status FROM people WHERE id = app.current_person_id()",
      )
    ).rows[0];
    if (!person) return null;

    const entries = (
      await tx.query<{ id: string; entry_date: string; direction: "in" | "out"; shares: string; price_cents: string; reverses_entry_id: string | null }>(
        "SELECT id::text, entry_date, direction, shares::text, price_cents::text, reverses_entry_id::text FROM app.my_share_entries()",
      )
    ).rows;

    // my_share_entries hides the counterparty, so model each movement as self ↔ "counterparty".
    const ledger: LedgerEntry[] = entries.map((e) => ({
      id: e.id,
      date: e.entry_date,
      from: e.direction === "in" ? COUNTERPARTY : SELF,
      to: e.direction === "in" ? SELF : COUNTERPARTY,
      shares: BigInt(e.shares),
      priceCents: BigInt(e.price_cents),
      reversesId: e.reverses_entry_id,
    }));
    const shares = BigInt((await tx.query<{ b: string }>("SELECT app.my_share_balance()::text AS b")).rows[0]!.b);

    const cycle = (
      await tx.query<{ year: number; price_per_share_cents: string }>(
        "SELECT year, price_per_share_cents::text FROM cycles WHERE locked_at IS NOT NULL ORDER BY year DESC LIMIT 1",
      )
    ).rows[0];
    const priceCents = cycle ? BigInt(cycle.price_per_share_cents) : null;

    const years = (
      await tx.query<{ int_value: string }>("SELECT int_value::text FROM current_settings WHERE key = 'eligibility_years'")
    ).rows[0];
    if (!years) throw new Error("Setting eligibility_years is missing");

    let eligibleOn: string | null = null;
    let eligible = person.type !== "employee";
    if (person.type === "employee" && person.hire_date) {
      eligible = isEligible(person.hire_date, today, Number(years.int_value));
      if (!eligible) eligibleOn = eligibilityDate(person.hire_date, Number(years.int_value));
    }

    return {
      name: person.name,
      type: person.type,
      shares,
      priceCents,
      priceYear: cycle?.year ?? null,
      valueCents: priceCents === null ? null : valueCents(shares, priceCents),
      costBasisCents: costBasisCents(ledger, SELF),
      eligibleOn,
      eligible,
      eligibilityYears: Number(years.int_value),
    };
  });
}

/** Today's date in Vancouver, where MDT's program dates apply. */
export function todayInVancouver(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
