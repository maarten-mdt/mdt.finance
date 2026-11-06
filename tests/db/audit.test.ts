import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPerson, createTestDb, type TestDb } from "./setup";

let db: TestDb;
let admin: string;

beforeAll(async () => {
  db = await createTestDb();
  admin = await addPerson(db, { name: "Admin" });
  await db.owner.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin')", [admin]);
});

afterAll(async () => {
  await db?.close();
});

describe("audit_log", () => {
  it("records actor, action, table, record, before and after for an update", async () => {
    const id = await db.as({ personId: admin, isAdmin: true }, async (c) => {
      const r = await c.query(
        `INSERT INTO people (type, name, email, hire_date, status)
         VALUES ('employee', 'Carol', 'carol@example.com', '2021-05-01', 'active') RETURNING id`,
      );
      const newId = r.rows[0]!.id as string;
      await c.query("UPDATE people SET name = 'Carol B' WHERE id = $1", [newId]);
      return newId;
    });
    const log = await db.owner.query(
      "SELECT actor, action, table_name, record_id, before, after FROM audit_log WHERE record_id = $1 ORDER BY id",
      [id],
    );
    expect(log.rows.map((r) => r.action)).toEqual(["INSERT", "UPDATE"]);
    const upd = log.rows[1]!;
    expect(upd).toMatchObject({ actor: admin, table_name: "people", record_id: id });
    expect(upd.before.name).toBe("Carol");
    expect(upd.after.name).toBe("Carol B");
  });

  it("never copies ciphertext into the log", async () => {
    const r = await db.as({ personId: admin, isAdmin: true }, (c) =>
      c.query("UPDATE people SET sin_ciphertext = 'v1:secret', sin_last4 = '4321' WHERE id = $1 RETURNING id", [admin]),
    );
    const log = await db.owner.query(
      "SELECT after FROM audit_log WHERE record_id = $1 AND action = 'UPDATE' ORDER BY id DESC LIMIT 1",
      [r.rows[0]!.id],
    );
    expect(log.rows[0]!.after.sin_ciphertext).toBe("[encrypted]");
    expect(JSON.stringify(log.rows[0])).not.toContain("v1:secret");
  });

  it("records app events such as a field reveal", async () => {
    await db.as({ personId: admin, isAdmin: true }, (c) =>
      c.query("SELECT app.log_event('reveal.sin', 'people', $1)", [admin]),
    );
    const log = await db.owner.query("SELECT actor FROM audit_log WHERE action = 'reveal.sin'");
    expect(log.rows).toEqual([{ actor: admin }]);
  });

  it("holders cannot read the audit log", async () => {
    const holder = await addPerson(db, { name: "Dan" });
    const r = await db.as({ personId: holder }, (c) => c.query("SELECT * FROM audit_log"));
    expect(r.rowCount).toBe(0);
  });
});
