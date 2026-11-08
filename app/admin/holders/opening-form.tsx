"use client";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { openingBalanceAction, type FormState } from "../actions";

export function OpeningBalanceForm({ holders }: { holders: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(openingBalanceAction, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {state.error && (
        <div className="sm:col-span-2">
          <Alert>{state.error}</Alert>
        </div>
      )}
      {state.ok && (
        <div className="sm:col-span-2">
          <Alert tone="ok">{state.ok}</Alert>
        </div>
      )}
      <label className="block sm:col-span-2">
        <span className="text-sm font-medium">Holder</span>
        <select name="holderId" required className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-3 text-base">
          <option value="">Choose…</option>
          {holders.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
      </label>
      <Field label="Shares" name="shares" inputMode="numeric" pattern="[0-9,]+" required />
      <Field label="Price per share ($)" name="price" inputMode="decimal" placeholder="12.50" required />
      <Field label="Date acquired" name="entryDate" type="date" required />
      <Field label="Note (optional)" name="memo" maxLength={200} />
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record opening balance"}
        </Button>
      </div>
    </form>
  );
}
