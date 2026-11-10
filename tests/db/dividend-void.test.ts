import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPerson, createTestDb, type TestDb } from "./setup";

let db: TestDb;
let alice: string, bob: string, admin: string, dividend: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await addPerson(db, { name: "Alice" });
  bob = await addPerson(db, { name: "Bob" });
  admin = await addPerson(db, { name: "Admin" });
  await db.owner.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin')", [admin]);
  // A past dividend entered by hand: Bob held nothing on the ledger at the record date.
  dividend = (
    await db.owner.query<{ id: string }>(
      `INSERT INTO dividends (declaration_date, record_date, total_cents, input_mode) VALUES ('2024-12-15','2024-12-01',15000,'manual') RETURNING id`,
    )
  ).rows[0]!.id;
  for (const [p, amt, shares] of [[alice, 10000, 2605], [bob, 5000, 0]] as const) {
    await db.owner.query(
      "INSERT INTO dividend_allocations (dividend_id, person_id, shares_on_record_date, amount_cents) VALUES ($1,$2,$3,$4)",
      [dividend, p, shares, amt],
    );
    await db.owner.query(
      "INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents, dividend_id) VALUES ('2024-12-15',$1,'dividend',$2,$3)",
      [p, amt, dividend],
    );
  }
  // Alice's was paid out.
  await db.owner.query(
    "INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents, dividend_id) VALUES ('2025-01-10',$1,'payout',-10000,$2)",
    [alice, dividend],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("past dividends", () => {
  it("accepts a manual dividend for someone with no shares on the ledger at the record date", async () => {
    const r = await db.owner.query("SELECT input_mode FROM dividends WHERE id = $1", [dividend]);
    expect(r.rows[0]!.input_mode).toBe("manual");
  });

  it("holders can't void a dividend", async () => {
    await expect(db.as({ personId: alice }, (c) => c.query("SELECT app.void_dividend($1, 'x')", [dividend]))).rejects.toThrow(/only admins/);
  });

  it("voiding reverses every cash entry, payouts first, and leaves balances at zero", async () => {
    const r = await db.as({ personId: admin, isAdmin: true }, (c) =>
      c.query<{ n: number }>("SELECT app.void_dividend($1, 'Entered wrong') AS n", [dividend]),
    );
    expect(r.rows[0]!.n).toBe(3);
    const b = await db.owner.query("SELECT person_id, balance_cents::text FROM credit_balances WHERE balance_cents <> 0");
    expect(b.rows).toEqual([]);
    const d = await db.owner.query("SELECT voided_at IS NOT NULL AS voided, voided_by FROM dividends WHERE id = $1", [dividend]);
    expect(d.rows[0]).toEqual({ voided: true, voided_by: admin });
  });

  it("can't be voided twice", async () => {
    await expect(db.as({ personId: admin, isAdmin: true }, (c) => c.query("SELECT app.void_dividend($1, 'x')", [dividend]))).rejects.toThrow(
      /already voided/,
    );
  });
});
