import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPerson, createTestDb, type TestDb } from "./setup";

let db: TestDb;
let vrh: string, opening: string, alice: string, bob: string, admin: string;

beforeAll(async () => {
  db = await createTestDb();
  opening = await addPerson(db, { name: "Opening balance (pre-system)", type: "system", key: "opening_balance" });
  vrh = await addPerson(db, { name: "Van Ruitenburg Holdings Ltd.", type: "entity", key: "vrh" });
  alice = await addPerson(db, { name: "Alice" });
  bob = await addPerson(db, { name: "Bob" });
  admin = await addPerson(db, { name: "Admin" });
  await db.owner.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin')", [admin]);

  await db.owner.query(
    `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents) VALUES
       ('2026-01-01', 'opening_balance', $1, $2, 100000, 1000),
       ('2026-07-01', 'vrh_sale', $2, $3, 100, 5000),
       ('2026-07-01', 'vrh_sale', $2, $4, 250, 5000)`,
    [opening, vrh, alice, bob],
  );
  await db.owner.query(
    `INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents) VALUES
       ('2026-07-01', $1, 'leftover_cash', 1234), ('2026-07-01', $2, 'leftover_cash', 5678)`,
    [alice, bob],
  );
  await db.owner.query(
    `UPDATE people SET sin_ciphertext = 'v1:xxx', sin_last4 = '1234' WHERE id = $1`,
    [bob],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("row-level security: holder A cannot read holder B", () => {
  it("people: Alice sees only her own row", async () => {
    const rows = await db.as({ personId: alice }, (c) => c.query("SELECT id FROM people"));
    expect(rows.rows.map((r) => r.id)).toEqual([alice]);
  });

  it("people: Alice cannot fetch Bob's row even by id", async () => {
    const rows = await db.as({ personId: alice }, (c) =>
      c.query("SELECT sin_ciphertext, sin_last4 FROM people WHERE id = $1", [bob]),
    );
    expect(rows.rowCount).toBe(0);
  });

  it("credit_ledger: Alice sees only her own entries", async () => {
    const rows = await db.as({ personId: alice }, (c) => c.query("SELECT person_id, amount_cents FROM credit_ledger"));
    expect(rows.rows).toEqual([{ person_id: alice, amount_cents: "1234" }]);
  });

  it("share_ledger: holders get no direct access (it names counterparties)", async () => {
    const rows = await db.as({ personId: alice }, (c) => c.query("SELECT * FROM share_ledger"));
    expect(rows.rowCount).toBe(0);
    const h = await db.as({ personId: alice }, (c) => c.query("SELECT * FROM holdings"));
    expect(h.rowCount).toBe(0);
  });

  it("my_share_entries returns only Alice's movements, without counterparties", async () => {
    const rows = await db.as({ personId: alice }, (c) => c.query("SELECT * FROM app.my_share_entries()"));
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ direction: "in", shares: "100", price_cents: "5000" });
    expect(Object.keys(rows.rows[0]!)).not.toContain("from_holder_id");
    const bal = await db.as({ personId: alice }, (c) => c.query("SELECT app.my_share_balance() AS b"));
    expect(bal.rows[0]!.b).toBe("100");
  });

  it("with no signed-in person, nothing is readable", async () => {
    const p = await db.as({ personId: null }, (c) => c.query("SELECT * FROM people"));
    const s = await db.as({ personId: null }, (c) => c.query("SELECT * FROM app.my_share_entries()"));
    const st = await db.as({ personId: null }, (c) => c.query("SELECT * FROM settings"));
    expect([p.rowCount, s.rowCount, st.rowCount]).toEqual([0, 0, 0]);
  });

  it("a holder cannot promote themselves by claiming to be admin", async () => {
    const rows = await db.as({ personId: alice, isAdmin: true }, (c) => c.query("SELECT id FROM people"));
    expect(rows.rows.map((r) => r.id)).toEqual([alice]);
  });

  it("holders cannot write: inserts and updates are rejected or affect nothing", async () => {
    await expect(
      db.as({ personId: alice }, (c) =>
        c.query("INSERT INTO people (type, name, email, hire_date, status) VALUES ('employee','X','x@x.co','2020-01-01','active')"),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await db.as({ personId: alice }, (c) => c.query("UPDATE people SET name = 'Hacked' WHERE id = $1", [alice]));
    expect(upd.rowCount).toBe(0);
    await expect(
      db.as({ personId: alice }, (c) =>
        c.query(
          "INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents) VALUES ('2026-08-01','vrh_sale',$1,$2,1,1)",
          [vrh, alice],
        ),
      ),
    ).rejects.toThrow();
  });

  it("app_user has no access to auth tables", async () => {
    await expect(db.as({ personId: alice }, (c) => c.query('SELECT * FROM "account"'))).rejects.toThrow(/permission denied/);
    await expect(db.as({ personId: admin, isAdmin: true }, (c) => c.query('SELECT * FROM "session"'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("an admin sees everyone", async () => {
    const people = await db.as({ personId: admin, isAdmin: true }, (c) => c.query("SELECT count(*)::int AS n FROM people"));
    expect(people.rows[0]!.n).toBe(5);
    const ledger = await db.as({ personId: admin, isAdmin: true }, (c) => c.query("SELECT count(*)::int AS n FROM share_ledger"));
    expect(ledger.rows[0]!.n).toBe(3);
  });
});
