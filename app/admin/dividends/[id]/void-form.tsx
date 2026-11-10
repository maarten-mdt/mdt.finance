"use client";
import { useActionState } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { voidDividendAction, type PayState } from "../actions";

export function VoidForm({ dividendId }: { dividendId: string }) {
  const [state, action, pending] = useActionState<PayState, FormData>(voidDividendAction, {});
  return (
    <Card>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Entered this wrong? Void the dividend</summary>
        <form action={action} className="mt-3 space-y-3">
          <p className="text-sm text-muted">
            Reverses everything this dividend added to cash balances, including payouts, so you can declare it again with the right
            amounts. Nothing is deleted; the void is recorded in the audit log.
          </p>
          {state.error && <Alert>{state.error}</Alert>}
          {state.ok && <Alert tone="ok">{state.ok}</Alert>}
          <input type="hidden" name="dividendId" value={dividendId} />
          <Field label="Reason" name="reason" required maxLength={200} placeholder="Entered the wrong amounts" />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Type VOID to confirm" name="confirm" autoComplete="off" required />
            </div>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Voiding…" : "Void dividend"}
            </Button>
          </div>
        </form>
      </details>
    </Card>
  );
}
