"use client";
import { useActionState } from "react";
import { Alert, Button, Card, Field, FileField } from "@/components/ui";
import { reviewAction, sendAgreementAction, uploadSignedAction, type DocState } from "../../agreements/actions";

export interface AgreementDoc {
  id: string;
  version: string;
  status: string;
  signedOn: string | null;
  sentAt: string | null;
  returnedAt: string | null;
  note: string | null;
  signedFileId: string | null;
  templateFileId: string | null;
}

function fmt(ts: string | null) {
  return ts ? ts.slice(0, 10) : "";
}

const statusLabel: Record<string, string> = {
  sent: "Sent, waiting for their signed copy",
  signed: "Signed copy returned, needs your review",
  complete: "Signed",
  superseded: "Replaced",
  void: "Withdrawn",
};

export function AgreementSection({ personId, docs, today }: { personId: string; docs: AgreementDoc[]; today: string }) {
  const [sendState, send, sending] = useActionState<DocState, FormData>(sendAgreementAction, {});
  const [upState, upload, uploading] = useActionState<DocState, FormData>(uploadSignedAction, {});
  const [revState, review, reviewing] = useActionState<DocState, FormData>(reviewAction, {});
  const open = docs.find((d) => d.status === "sent" || d.status === "signed");
  const signed = docs.find((d) => d.status === "complete");

  return (
    <Card className="space-y-4" >
      <div>
        <h2 className="font-semibold">Shareholder agreement</h2>
        <p className="text-sm" data-testid="agreement-status">
          {signed ? (
            <>
              Signed on <strong>{signed.signedOn}</strong> (version {signed.version}).{" "}
              <a className="underline" href={`/admin/files/${signed.signedFileId}`}>
                View signed copy
              </a>
            </>
          ) : open ? (
            statusLabel[open.status]
          ) : (
            <span className="text-muted">No signed agreement on file.</span>
          )}
        </p>
      </div>

      {[sendState, upState, revState].map((s, i) =>
        s.error ? <Alert key={`e${i}`}>{s.error}</Alert> : s.ok ? <Alert key={`o${i}`} tone="ok">{s.ok}</Alert> : null,
      )}

      {open?.status === "signed" && (
        <form action={review} className="space-y-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="documentId" value={open.id} />
          <p className="text-sm">
            Returned {fmt(open.returnedAt)}.{" "}
            <a className="underline" href={`/admin/files/${open.signedFileId}`} target="_blank" rel="noreferrer">
              Open their signed copy
            </a>{" "}
            and check it&apos;s complete.
          </p>
          <div className="w-48">
            <Field label="Date signed" name="signedOn" type="date" defaultValue={today} />
          </div>
          <Field label="If something's wrong, tell them what to fix" name="note" maxLength={300} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="intent" value="confirm" disabled={reviewing}>
              Confirm signed agreement
            </Button>
            <Button type="submit" name="intent" value="reject" variant="secondary" disabled={reviewing}>
              Send back to fix
            </Button>
          </div>
        </form>
      )}

      {open?.status === "sent" && (
        <form action={review} className="text-sm">
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="documentId" value={open.id} />
          Sent {fmt(open.sentAt)} (version {open.version}).{open.note ? ` Your note: “${open.note}”.` : ""}{" "}
          <button name="intent" value="cancel" className="text-danger hover:underline" disabled={reviewing}>
            Withdraw request
          </button>
        </form>
      )}

      {!open && (
        <form action={send}>
          <input type="hidden" name="personId" value={personId} />
          <Button type="submit" variant={signed ? "secondary" : "primary"} disabled={sending}>
            {signed ? "Send the current agreement to sign again" : "Send agreement to sign"}
          </Button>
        </form>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Signed on paper or elsewhere? Upload the signed copy</summary>
        <form action={upload} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="personId" value={personId} />
          <Field label="Version" name="version" placeholder="v1 — March 2027" required />
          <Field label="Date signed" name="signedOn" type="date" defaultValue={today} required />
          <div className="sm:col-span-2">
            <FileField label="Signed agreement (PDF)" name="file" accept="application/pdf,.pdf" required />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={uploading}>
              {uploading ? "Uploading…" : "Save signed agreement"}
            </Button>
          </div>
        </form>
      </details>

      {docs.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">History</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {docs.map((d) => (
              <li key={d.id}>
                {d.version}: {statusLabel[d.status] ?? d.status}
                {d.signedOn ? `, signed ${d.signedOn}` : ""}
                {d.sentAt ? `, sent ${fmt(d.sentAt)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
