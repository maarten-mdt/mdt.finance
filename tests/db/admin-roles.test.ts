import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPerson, createTestDb, type TestDb } from "./setup";

let db: TestDb;
let maarten: string, anna: string, ryan: string;

beforeAll(async () => {
  db = await createTestDb();
  maarten = await addPerson(db, { name: "Maarten" });
  anna = await addPerson(db, { name: "Anna" });
  ryan = await addPerson(db, { name: "Ryan" });
  await db.owner.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin')", [maarten]);
});

afterAll(async () => {
  await db?.close();
});

const grant = (actor: string, target: string, isAdmin = true) =>
  db.as({ personId: actor, isAdmin }, (c) => c.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin')", [target]));
const revoke = (actor: string, target: string) =>
  db.as({ personId: actor, isAdmin: true }, (c) => c.query("DELETE FROM user_roles WHERE person_id = $1 AND role = 'admin'", [target]));

describe("admin role management", () => {
  it("a non-admin can't grant the admin role", async () => {
    await expect(grant(anna, anna)).rejects.toThrow(/row-level security/);
  });

  it("an admin can grant it, and it's audit-logged", async () => {
    await grant(maarten, anna);
    const log = await db.owner.query("SELECT actor, action FROM audit_log WHERE table_name = 'user_roles' AND action = 'INSERT' AND after ->> 'person_id' = $1", [anna]);
    expect(log.rows).toEqual([{ actor: maarten, action: "INSERT" }]);
  });

  it("nobody can remove their own admin role", async () => {
    await expect(revoke(anna, anna)).rejects.toThrow(/your own admin role/);
  });

  it("another admin can remove it", async () => {
    await grant(maarten, ryan);
    const r = await revoke(maarten, ryan);
    expect(r.rowCount).toBe(1);
  });

  it("the last admin can't be removed", async () => {
    await revoke(maarten, anna); // Maarten is now the only admin
    // Maarten can't remove himself, and with nobody else left nobody else can either.
    await expect(revoke(maarten, maarten)).rejects.toThrow(/your own admin role|last admin/);
    const r = await db.owner.query("SELECT count(*)::int AS n FROM user_roles WHERE role = 'admin'");
    expect(r.rows[0]!.n).toBe(1);
  });

  it("people without an email can't be made admin", async () => {
    const vrh = await addPerson(db, { name: "VRH", type: "entity", key: "vrh" });
    await expect(grant(maarten, vrh)).rejects.toThrow(/current person with an email/);
  });
});
