import "server-only";
import { createHash } from "node:crypto";
import { withContext, type DbContext, type Tx } from "@/lib/db";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export interface PdfUpload {
  fileName: string;
  bytes: Buffer;
}

/** Accept only real PDFs up to 10 MB. Throws a readable error otherwise. */
export async function readPdf(file: unknown): Promise<PdfUpload> {
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a PDF file.");
  if (file.size > MAX_PDF_BYTES) throw new Error("That file is over 10 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("That file isn't a PDF.");
  const fileName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document.pdf";
  return { fileName, bytes };
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function insertFile(tx: Tx, f: PdfUpload): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO files (file_name, content_type, size_bytes, sha256, content) VALUES ($1, 'application/pdf', $2, $3, $4) RETURNING id`,
    [f.fileName, f.bytes.length, sha256(f.bytes), f.bytes],
  );
  return r.rows[0]!.id;
}

// ---- Templates --------------------------------------------------------------------------------

export interface TemplateRow {
  id: string;
  version: string;
  is_current: boolean;
  created_at: string;
  file_id: string;
  file_name: string;
  sent: number;
  complete: number;
}

export async function listTemplates(ctx: DbContext): Promise<TemplateRow[]> {
  const r = await withContext(ctx, (tx) =>
    tx.query<TemplateRow>(
      `SELECT t.id, t.version, t.is_current, t.created_at::text, t.file_id, f.file_name,
              (SELECT count(*)::int FROM documents d WHERE d.template_id = t.id AND d.status IN ('sent','signed')) AS sent,
              (SELECT count(*)::int FROM documents d WHERE d.template_id = t.id AND d.status = 'complete') AS complete
       FROM agreement_templates t JOIN files f ON f.id = t.file_id
       ORDER BY t.created_at DESC`,
    ),
  );
  return r.rows;
}

export async function addTemplate(ctx: DbContext, version: string, pdf: PdfUpload, makeCurrent: boolean): Promise<void> {
  await withContext(ctx, async (tx) => {
    const fileId = await insertFile(tx, pdf);
    if (makeCurrent) await tx.query("UPDATE agreement_templates SET is_current = false WHERE type = 'shareholder_agreement' AND is_current");
    await tx.query("INSERT INTO agreement_templates (version, file_id, is_current) VALUES ($1, $2, $3)", [version, fileId, makeCurrent]);
  });
}

export async function makeTemplateCurrent(ctx: DbContext, id: string): Promise<void> {
  await withContext(ctx, async (tx) => {
    await tx.query("UPDATE agreement_templates SET is_current = false WHERE type = 'shareholder_agreement' AND is_current AND id <> $1", [id]);
    await tx.query("UPDATE agreement_templates SET is_current = true WHERE id = $1", [id]);
  });
}

// ---- A person's agreements --------------------------------------------------------------------

export interface DocumentRow {
  id: string;
  version: string;
  status: "draft" | "sent" | "signed" | "complete" | "superseded" | "void";
  signed_on: string | null;
  sent_at: string | null;
  returned_at: string | null;
  reviewed_at: string | null;
  note: string | null;
  has_template: boolean;
  has_signed: boolean;
  signed_file_id: string | null;
  template_file_id: string | null;
}

const DOC_COLUMNS = `d.id, d.version, d.status, d.signed_on, d.sent_at::text, d.returned_at::text, d.reviewed_at::text, d.note,
  d.template_id IS NOT NULL AS has_template, d.signed_file_id IS NOT NULL AS has_signed, d.signed_file_id,
  t.file_id AS template_file_id`;

export async function listDocumentsFor(ctx: DbContext, personId: string): Promise<DocumentRow[]> {
  const r = await withContext(ctx, (tx) =>
    tx.query<DocumentRow>(
      `SELECT ${DOC_COLUMNS} FROM documents d LEFT JOIN agreement_templates t ON t.id = d.template_id
       WHERE d.person_id = $1 AND d.type = 'shareholder_agreement' ORDER BY d.created_at DESC`,
      [personId],
    ),
  );
  return r.rows;
}

/** The signed-in holder's own agreements (RLS limits documents to their rows). */
export async function listMyDocuments(ctx: DbContext): Promise<DocumentRow[]> {
  const r = await withContext(ctx, (tx) =>
    tx.query<DocumentRow>(
      `SELECT d.id, d.version, d.status, d.signed_on, d.sent_at::text, d.returned_at::text, d.reviewed_at::text, d.note,
              d.template_id IS NOT NULL AS has_template, d.signed_file_id IS NOT NULL AS has_signed,
              NULL::uuid AS signed_file_id, NULL::uuid AS template_file_id
       FROM documents d
       WHERE d.person_id = app.current_person_id() AND d.type = 'shareholder_agreement' AND d.status <> 'void'
       ORDER BY d.created_at DESC`,
    ),
  );
  return r.rows;
}

/** Send the current agreement to a person to sign and return. */
export async function sendAgreement(ctx: DbContext, personId: string): Promise<void> {
  await withContext(ctx, async (tx) => {
    const t = (
      await tx.query<{ id: string; version: string }>(
        "SELECT id, version FROM agreement_templates WHERE type = 'shareholder_agreement' AND is_current",
      )
    ).rows[0];
    if (!t) throw new Error("Upload the shareholder agreement and mark it current first (Agreements page).");
    const open = await tx.query(
      "SELECT 1 FROM documents WHERE person_id = $1 AND type = 'shareholder_agreement' AND status IN ('sent','signed')",
      [personId],
    );
    if (open.rowCount) throw new Error("This person already has an agreement waiting to be signed or confirmed.");
    await tx.query(
      `INSERT INTO documents (person_id, type, version, status, template_id, sent_at)
       VALUES ($1, 'shareholder_agreement', $2, 'sent', $3, now())`,
      [personId, t.version, t.id],
    );
  });
}

/** Record an agreement signed outside the portal (e.g. on paper): stored as complete. */
export async function uploadSignedAgreement(
  ctx: DbContext,
  personId: string,
  input: { version: string; signedOn: string; pdf: PdfUpload },
): Promise<void> {
  await withContext(ctx, async (tx) => {
    const fileId = await insertFile(tx, input.pdf);
    // A pending request for the same person is settled by this upload.
    await tx.query(
      "UPDATE documents SET status = 'superseded', note = 'Settled by a signed copy uploaded by an admin' WHERE person_id = $1 AND type = 'shareholder_agreement' AND status IN ('sent','signed')",
      [personId],
    );
    await tx.query(
      `INSERT INTO documents (person_id, type, version, status, signed_file_id, signed_on, reviewed_by, reviewed_at)
       VALUES ($1, 'shareholder_agreement', $2, 'complete', $3, $4, app.current_actor(), now())`,
      [personId, input.version, fileId, input.signedOn],
    );
  });
}

/** Accept a signed copy the holder returned, recording the date it was signed. */
export async function confirmReturned(ctx: DbContext, documentId: string, signedOn: string): Promise<void> {
  await withContext(ctx, async (tx) => {
    const r = await tx.query(
      `UPDATE documents SET status = 'complete', signed_on = $2, reviewed_by = app.current_actor(), reviewed_at = now(), note = NULL
       WHERE id = $1 AND status = 'signed'`,
      [documentId, signedOn],
    );
    if (r.rowCount !== 1) throw new Error("That agreement isn't waiting for review.");
  });
}

/** Send a returned copy back to the holder to try again (e.g. unsigned page, wrong file). */
export async function rejectReturned(ctx: DbContext, documentId: string, note: string): Promise<void> {
  await withContext(ctx, async (tx) => {
    const r = await tx.query(
      `UPDATE documents SET status = 'sent', note = $2, reviewed_by = app.current_actor(), reviewed_at = now()
       WHERE id = $1 AND status = 'signed'`,
      [documentId, note],
    );
    if (r.rowCount !== 1) throw new Error("That agreement isn't waiting for review.");
  });
}

/** Withdraw a request that hasn't been completed. */
export async function cancelRequest(ctx: DbContext, documentId: string): Promise<void> {
  await withContext(ctx, (tx) =>
    tx.query("UPDATE documents SET status = 'void', note = 'Request withdrawn by an admin' WHERE id = $1 AND status IN ('sent','signed')", [
      documentId,
    ]),
  );
}

// ---- Holder side ------------------------------------------------------------------------------

export async function returnSigned(ctx: DbContext, documentId: string, pdf: PdfUpload): Promise<void> {
  await withContext(ctx, (tx) =>
    tx.query("SELECT app.return_signed_agreement($1, $2, $3, $4, $5)", [documentId, pdf.fileName, pdf.bytes.length, sha256(pdf.bytes), pdf.bytes]),
  );
}

export interface FileBody {
  fileName: string;
  content: Buffer;
}

export async function myFile(ctx: DbContext, documentId: string, which: "template" | "signed"): Promise<FileBody | null> {
  const r = await withContext(ctx, (tx) =>
    tx.query<{ file_name: string; content: Buffer }>("SELECT file_name, content FROM app.my_document_file($1, $2)", [documentId, which]),
  );
  const row = r.rows[0];
  return row ? { fileName: row.file_name, content: row.content } : null;
}

export async function adminFile(ctx: DbContext, fileId: string): Promise<FileBody | null> {
  const r = await withContext(ctx, (tx) =>
    tx.query<{ file_name: string; content: Buffer }>("SELECT file_name, content FROM files WHERE id = $1", [fileId]),
  );
  const row = r.rows[0];
  return row ? { fileName: row.file_name, content: row.content } : null;
}

/** Agreement status across everyone who can sign in, for the people list. */
export async function agreementStatusByPerson(ctx: DbContext): Promise<Map<string, { status: string; signed_on: string | null }>> {
  const r = await withContext(ctx, (tx) =>
    tx.query<{ person_id: string; status: string; signed_on: string | null }>(
      `SELECT DISTINCT ON (person_id) person_id, status, signed_on FROM documents
       WHERE type = 'shareholder_agreement' AND status IN ('sent','signed','complete')
       ORDER BY person_id, (status = 'complete') DESC, created_at DESC`,
    ),
  );
  return new Map(r.rows.map((x) => [x.person_id, { status: x.status, signed_on: x.signed_on }]));
}
