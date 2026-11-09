import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPerson, createTestDb, type TestDb } from "./setup";

let db: TestDb;
let opening: string, vrh: string, maarten: string;

beforeAll(async () => {
  db = await createTestDb();
  opening = await addPerson(db, { name: "Opening", type: "system", key: "opening_balance" });
  vrh = await addPerson(db, { name: "Van Ruitenburg Holdings Ltd.", type: "entity", key: "vrh" });
  maarten = await addPerson(db, { name: "Maarten Van Ruitenburg", email: "maarten@example.com" });
  await db.owner.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin')", [maarten]);
  await db.owner.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "updatedAt", "personId") VALUES ('u1', 'Maarten', 'maarten@example.com', true, now(), $1)`,
    [maarten],
  );
  await db.owner.query(
    `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents) VALUES
       ('2022-02-01', 'opening_balance', $1, $2, 7548100, 0, 0), ('2022-02-01', 'opening_balance', $1, $3, 1234, 0, 0)`,
    [opening, vrh, maarten],
  );
  await db.owner.query("SELECT app.merge_person_into($1, $2)", [maarten, vrh]);
});

afterAll(async () => {
  await db?.close();
});

describe("merging a person into the company they sign in for", () => {
  it("moves the login and admin role to the company record", async () => {
    const u = await db.owner.query(`SELECT "personId" FROM "user" WHERE id = 'u1'`);
    expect(u.rows[0]!.personId).toBe(vrh);
    const roles = await db.owner.query("SELECT person_id FROM user_roles");
    expect(roles.rows).toEqual([{ person_id: vrh }]);
  });

  it("gives the company the email and contact name, and marks the person merged", async () => {
    const r = await db.owner.query("SELECT id, email, contact_name, merged_into FROM people WHERE id IN ($1, $2) ORDER BY name", [maarten, vrh]);
    expect(r.rows).toContainEqual({ id: vrh, email: "maarten@example.com", contact_name: "Maarten Van Ruitenburg", merged_into: null });
    expect(r.rows).toContainEqual({ id: maarten, email: null, contact_name: null, merged_into: vrh });
  });

  it("moves shares held personally to the company", async () => {
    const h = await db.owner.query("SELECT holder_id, shares::text FROM holdings WHERE holder_id IN ($1, $2)", [maarten, vrh]);
    expect(h.rows).toContainEqual({ holder_id: vrh, shares: "7549334" });
    expect(h.rows).toContainEqual({ holder_id: maarten, shares: "0" });
  });

  it("is idempotent", async () => {
    await db.owner.query("SELECT app.merge_person_into($1, $2)", [maarten, vrh]);
    const n = await db.owner.query("SELECT count(*)::int AS n FROM share_ledger WHERE memo LIKE 'Account merge%'");
    expect(n.rows[0]!.n).toBe(1);
  });
});
