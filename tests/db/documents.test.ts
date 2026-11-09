import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPerson, createTestDb, type TestDb } from "./setup";

let db: TestDb;
let admin: string, alice: string, bob: string;
let templateId: string, aliceDoc: string, bobDoc: string;

const PDF = Buffer.from("%PDF-1.4 test");

beforeAll(async () => {
  db = await createTestDb();
  admin = await addPerson(db, { name: "Admin" });
  alice = await addPerson(db, { name: "Alice" });
  bob = await addPerson(db, { name: "Bob" });
  await db.owner.query("INSERT INTO user_roles (person_id, role) VALUES ($1, 'admin')", [admin]);

  await db.as({ personId: admin, isAdmin: true }, async (c) => {
    const f = await c.query(
      "INSERT INTO files (file_name, content_type, size_bytes, sha256, content) VALUES ('sha.pdf','application/pdf',$1,'x',$2) RETURNING id",
      [PDF.length, PDF],
    );
    templateId = (
      await c.query("INSERT INTO agreement_templates (version, file_id, is_current) VALUES ('v1', $1, true) RETURNING id", [f.rows[0]!.id])
    ).rows[0]!.id;
    for (const p of [alice, bob]) {
      const d = await c.query(
        `INSERT INTO documents (person_id, type, version, status, template_id, sent_at)
         VALUES ($1, 'shareholder_agreement', 'v1', 'sent', $2, now()) RETURNING id`,
        [p, templateId],
      );
      if (p === alice) aliceDoc = d.rows[0]!.id;
      else bobDoc = d.rows[0]!.id;
    }
  });
});

afterAll(async () => {
  await db?.close();
});

const returnSigned = (who: string, doc: string) =>
  db.as({ personId: who }, (c) =>
    c.query("SELECT app.return_signed_agreement($1, 'signed.pdf', $2, 'abc', $3)", [doc, PDF.length, PDF]),
  );

describe("agreements and files", () => {
  it("holders can't read the files table directly", async () => {
    const r = await db.as({ personId: alice }, (c) => c.query("SELECT id FROM files"));
    expect(r.rowCount).toBe(0);
  });

  it("a holder can download the agreement they were sent, but not someone else's", async () => {
    const own = await db.as({ personId: alice }, (c) => c.query("SELECT file_name FROM app.my_document_file($1, 'template')", [aliceDoc]));
    expect(own.rows).toEqual([{ file_name: "sha.pdf" }]);
    const other = await db.as({ personId: alice }, (c) => c.query("SELECT * FROM app.my_document_file($1, 'template')", [bobDoc]));
    expect(other.rowCount).toBe(0);
  });

  it("a holder can return a signed copy of their own agreement only", async () => {
    await expect(returnSigned(alice, bobDoc)).rejects.toThrow(/not found/);
    await returnSigned(alice, aliceDoc);
    const d = await db.owner.query("SELECT status, signed_file_id IS NOT NULL AS has_file FROM documents WHERE id = $1", [aliceDoc]);
    expect(d.rows[0]).toEqual({ status: "signed", has_file: true });
  });

  it("an agreement can't be marked complete without a signed file and date", async () => {
    await expect(
      db.as({ personId: admin, isAdmin: true }, (c) => c.query("UPDATE documents SET status = 'complete' WHERE id = $1", [bobDoc])),
    ).rejects.toThrow(/documents_complete_has_signature/);
  });

  it("files can never be changed or deleted", async () => {
    await expect(db.owner.query("UPDATE files SET file_name = 'x'")).rejects.toThrow(/append-only/);
    await expect(db.owner.query("DELETE FROM files")).rejects.toThrow(/append-only/);
  });

  it("file contents never reach the audit log", async () => {
    const r = await db.owner.query("SELECT after FROM audit_log WHERE table_name = 'files'");
    expect(r.rowCount).toBeGreaterThan(0);
    for (const row of r.rows) expect(row.after.content).toBe("[file contents]");
  });
});

describe("holdings_at", () => {
  it("returns balances as of the end of a date", async () => {
    const opening = await addPerson(db, { name: "Opening", type: "system", key: "opening_balance" });
    const vrh = await addPerson(db, { name: "VRH", type: "entity", key: "vrh" });
    await db.owner.query(
      `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, amount_cents) VALUES
         ('2026-01-01','opening_balance',$1,$2,1000,0,0), ('2026-07-01','vrh_sale',$2,$3,100,2590,2590)`,
      [opening, vrh, alice],
    );
    const before = await db.as({ personId: admin, isAdmin: true }, (c) =>
      c.query("SELECT holder_id, shares::text FROM app.holdings_at('2026-06-30') ORDER BY shares"),
    );
    expect(before.rows).toEqual([{ holder_id: vrh, shares: "1000" }]);
    const after = await db.as({ personId: admin, isAdmin: true }, (c) =>
      c.query("SELECT shares::text FROM app.holdings_at('2026-07-01') WHERE holder_id = $1", [alice]),
    );
    expect(after.rows).toEqual([{ shares: "100" }]);
  });
});
