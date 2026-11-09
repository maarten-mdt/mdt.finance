"use client";
import { useActionState } from "react";
import { Alert, Button, Card } from "@/components/ui";
import { returnSignedAction, type ReturnState } from "./actions";

export interface MyAgreement {
  id: string;
  version: string;
  status: string;
  signedOn: string | null;
  note: string | null;
}

/** "Sign your shareholder agreement" task, and the signed agreement once it's on file. */
export function AgreementCard({ docs }: { docs: MyAgreement[] }) {
  const [state, action, pending] = useActionState<ReturnState, FormData>(returnSignedAction, {});
  const todo = docs.find((d) => d.status === "sent");
  const waiting = docs.find((d) => d.status === "signed");
  const signed = docs.find((d) => d.status === "complete");
  if (!todo && !waiting && !signed) return null;

  return (
    <Card className={todo ? "space-y-3 border-accent/50 bg-accent/5" : "space-y-2"}>
      <h2 className="font-semibold">{todo ? "Action needed: sign your shareholder agreement" : "Shareholder agreement"}</h2>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}

      {todo && !state.ok && (
        <>
          {todo.note && <Alert tone="info">From MDT: {todo.note}</Alert>}
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              <a className="font-medium underline" href={`/dashboard/documents/${todo.id}/template`} target="_blank" rel="noreferrer">
                Download the agreement
              </a>{" "}
              (version {todo.version}) and read it.
            </li>
            <li>Sign it, digitally or on paper, and save the signed copy as a PDF (a phone scan works).</li>
            <li>Upload the signed copy here.</li>
          </ol>
          <form action={action} className="space-y-3">
            <input type="hidden" name="documentId" value={todo.id} />
            <input type="file" name="file" accept="application/pdf,.pdf" required className="block w-full text-sm" />
            <Button type="submit" disabled={pending}>
              {pending ? "Uploading…" : "Upload signed agreement"}
            </Button>
          </form>
        </>
      )}

      {(waiting || state.ok) && !signed && (
        <p className="text-sm text-muted" data-testid="agreement-waiting">
          Thanks. Your signed copy is with MDT for review.
        </p>
      )}

      {signed && (
        <p className="text-sm" data-testid="agreement-signed">
          Signed on <strong>{signed.signedOn}</strong> (version {signed.version}).{" "}
          <a className="underline" href={`/dashboard/documents/${signed.id}/signed`} target="_blank" rel="noreferrer">
            View your signed copy
          </a>
        </p>
      )}
    </Card>
  );
}
