import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPerson, createTestDb, type TestDb } from "./setup";

let db: TestDb;
let opening: string, vrh: string, alice: string, bob: string, admin: string;

beforeAll(async () => {
  db = await createTestDb();
  opening = await addPerson(db, { name: "Opening", type: "system", key: "opening_balance" });
  vrh = await addPerson(db, { name: "VRH", type: "entity", key: "vrh" });
  alice = await addPerson(db, { name: "Alice" });
  bob = await addPerson(db, { name: "Bob" });
  admin = await addPerson(db, { name: "Admin" });
  await db.owner.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin')", [admin]);
  // Issue → sell on → resell, so undoing in the wrong order would make someone go negative.
  await db.owner.query(
    `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents) VALUES
       ('2022-02-01', 'opening_balance', $1, $2, 10000, 0, 0),
       ('2024-10-01', 'vrh_sale', $2, $3, 2605, 95972, 2500000),
       ('2025-01-01', 'holder_transfer', $3, $4, 2605, 38873, 1012642)`,
    [opening, vrh, alice, bob],
  );
  // One entry already reversed by hand: it must not be reversed twice.
  const extra = await db.owner.query<{ id: string }>(
    `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents)
     VALUES ('2026-01-01', 'vrh_sale', $1, $2, 100, 1, 1) RETURNING id`,
    [vrh, alice],
  );
  await db.owner.query(
    `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents, reverses_entry_id)
     VALUES ('2026-01-02', 'correction', $1, $2, 100, 1, 1, $3)`,
    [alice, vrh, extra.rows[0]!.id],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("reverse all share entries (start over)", () => {
  it("holders can't do it", async () => {
    await expect(db.as({ personId: alice }, (c) => c.query("SELECT app.reverse_all_share_entries('x')"))).rejects.toThrow(/only admins/);
  });

  it("reverses every live entry newest first and brings every balance to zero", async () => {
    const r = await db.as({ personId: admin, isAdmin: true }, (c) => c.query<{ n: number }>("SELECT app.reverse_all_share_entries('Start over') AS n"));
    expect(r.rows[0]!.n).toBe(3); // the hand-reversed entry is skipped
    const h = await db.owner.query<{ shares: string }>("SELECT shares::text FROM holdings WHERE shares <> 0");
    expect(h.rows).toEqual([]);
    const audit = await db.owner.query("SELECT count(*)::int AS n FROM audit_log WHERE table_name = 'share_ledger' AND actor = $1", [admin]);
    expect(audit.rows[0]!.n).toBe(3);
  });

  it("running it again does nothing", async () => {
    const r = await db.as({ personId: admin, isAdmin: true }, (c) => c.query<{ n: number }>("SELECT app.reverse_all_share_entries('again') AS n"));
    expect(r.rows[0]!.n).toBe(0);
  });

  it("new entries can be recorded afterwards", async () => {
    await db.owner.query(
      `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents)
       VALUES ('2022-02-01', 'opening_balance', $1, $2, 7548100, 0, 0)`,
      [opening, vrh],
    );
    const h = await db.owner.query<{ shares: string }>("SELECT shares::text FROM holdings WHERE holder_id = $1", [vrh]);
    expect(h.rows[0]!.shares).toBe("7548100");
  });
});

describe("holdings on past dates after starting over", () => {
  it("count re-entered history once, even though the reversals are dated today", async () => {
    // State after the tests above: everything reversed today, then VRH's 75,481 re-entered with its 2022 date.
    const r = await db.as({ personId: admin, isAdmin: true }, (c) =>
      c.query<{ holder_id: string; shares: string }>("SELECT holder_id, shares::text FROM app.holdings_at('2025-06-30')"),
    );
    expect(r.rows).toEqual([{ holder_id: vrh, shares: "7548100" }]);
  });
});
