"use client";
import { useActionState } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { reverseAllAction, type FormState } from "../actions";

export function StartOver({ live }: { live: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reverseAllAction, {});
  return (
    <Card className="space-y-3 border-danger/30">
      <h2 className="font-semibold">Start over</h2>
      <p className="text-sm text-muted">
        Reverses all {live} share movement{live === 1 ? "" : "s"} on the ledger (opening balances, sales and imports), bringing every
        holder back to zero so you can re-enter them. Nothing is deleted: each reversal is recorded, and the audit log shows you did
        it. Dividends, cash balances, valuations and people are not touched.
      </p>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Field label="Type REVERSE ALL to confirm" name="confirm" autoComplete="off" required />
        </div>
        <Button type="submit" variant="danger" disabled={pending || live === 0}>
          {pending ? "Reversing…" : "Reverse all share movements"}
        </Button>
      </form>
    </Card>
  );
}
