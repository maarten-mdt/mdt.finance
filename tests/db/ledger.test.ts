import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPerson, createTestDb, type TestDb } from "./setup";

let db: TestDb;
let vrh: string, opening: string, alice: string, bob: string, admin: string;
let saleId: string;

const insertShare = (
  c: { query: TestDb["owner"]["query"] },
  type: string,
  from: string,
  to: string,
  shares: number,
  price = 5000,
  reverses: string | null = null,
) =>
  c.query(
    `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, reverses_entry_id)
     VALUES ('2026-07-01', $1, $2, $3, $4, $5, $6) RETURNING id`,
    [type, from, to, shares, price, reverses],
  );

beforeAll(async () => {
  db = await createTestDb();
  opening = await addPerson(db, { name: "Opening balance (pre-system)", type: "system", key: "opening_balance" });
  vrh = await addPerson(db, { name: "VRH", type: "entity", key: "vrh" });
  alice = await addPerson(db, { name: "Alice" });
  bob = await addPerson(db, { name: "Bob" });
  admin = await addPerson(db, { name: "Admin" });
  await db.owner.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin')", [admin]);
  await insertShare(db.owner, "opening_balance", opening, vrh, 1000, 1000);
  saleId = (await insertShare(db.owner, "vrh_sale", vrh, alice, 100)).rows[0]!.id as string;
  await db.owner.query(
    "INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents) VALUES ('2026-07-01', $1, 'leftover_cash', 500)",
    [alice],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("ledgers are append-only, enforced by triggers", () => {
  // Run as the database owner (a superuser locally): grants don't stop it, only the triggers do.
  it.each([
    ["share_ledger", "memo = 'edited'"],
    ["credit_ledger", "memo = 'edited'"],
    ["audit_log", "actor = 'someone-else'"],
  ])("%s rejects UPDATE", async (t, set) => {
    await expect(db.owner.query(`UPDATE ${t} SET ${set}`)).rejects.toThrow(/append-only/);
  });

  it.each(["share_ledger", "credit_ledger", "audit_log"])("%s rejects DELETE", async (t) => {
    await expect(db.owner.query(`DELETE FROM ${t}`)).rejects.toThrow(/append-only/);
  });

  it.each(["share_ledger", "credit_ledger", "audit_log"])("%s rejects TRUNCATE", async (t) => {
    await expect(db.owner.query(`TRUNCATE ${t} CASCADE`)).rejects.toThrow(/append-only/);
  });

  it("app_user has no UPDATE or DELETE privilege on the ledgers at all", async () => {
    await expect(
      db.as({ personId: admin, isAdmin: true }, (c) => c.query("UPDATE share_ledger SET shares = 1")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.as({ personId: admin, isAdmin: true }, (c) => c.query("DELETE FROM credit_ledger")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("share movement rules", () => {
  it("a correction exactly reverses an entry and restores balances", async () => {
    const before = await db.owner.query("SELECT shares FROM holdings WHERE holder_id = $1", [alice]);
    expect(before.rows[0]!.shares).toBe("100");
    await db.as({ personId: admin, isAdmin: true }, (c) => insertShare(c, "correction", alice, vrh, 100, 5000, saleId));
    const after = await db.owner.query("SELECT coalesce((SELECT shares FROM holdings WHERE holder_id = $1), 0) AS s", [alice]);
    expect(after.rows[0]!.s).toBe("0");
  });

  it("an entry can only be reversed once", async () => {
    await expect(insertShare(db.owner, "correction", alice, vrh, 100, 5000, saleId)).rejects.toThrow(/already been reversed/);
  });

  it("a correction that doesn't mirror the original is rejected", async () => {
    const id = (await insertShare(db.owner, "vrh_sale", vrh, bob, 50)).rows[0]!.id as string;
    await expect(insertShare(db.owner, "correction", bob, vrh, 49, 5000, id)).rejects.toThrow(/exactly reverse/);
    await expect(insertShare(db.owner, "correction", vrh, bob, 50, 5000, id)).rejects.toThrow(/exactly reverse/);
  });

  it("nobody can transfer more shares than they hold", async () => {
    await expect(insertShare(db.owner, "vrh_sale", vrh, alice, 1_000_000)).rejects.toThrow(/cannot transfer/);
  });

  it("entry types must match their counterparties", async () => {
    await expect(insertShare(db.owner, "vrh_sale", bob, alice, 1)).rejects.toThrow(/sold by VRH/);
    await expect(insertShare(db.owner, "opening_balance", vrh, alice, 1)).rejects.toThrow(/Opening balance/);
    await expect(insertShare(db.owner, "holder_transfer", vrh, alice, 1)).rejects.toThrow(/individual holders/);
  });

  it("shares and money are integers; fractional values are rejected", async () => {
    await expect(insertShare(db.owner, "vrh_sale", vrh, alice, 1.5)).rejects.toThrow(/bigint/);
  });

  it("all balances always sum to zero", async () => {
    const r = await db.owner.query("SELECT sum(shares)::bigint AS total FROM holdings");
    expect(r.rows[0]!.total).toBe("0");
  });

  it("credit balances cannot go negative", async () => {
    await expect(
      db.owner.query(
        "INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents) VALUES ('2026-07-02', $1, 'payout', -501)",
        [alice],
      ),
    ).rejects.toThrow(/negative/);
  });
});
